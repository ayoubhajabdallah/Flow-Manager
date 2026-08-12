import { Router, type IRouter } from "express";
import { and, asc, desc, eq, ilike, or, sql } from "drizzle-orm";
import { db, requestsTable } from "@workspace/db";
import {
  CreateRequestBody,
  CreateRequestResponse,
  GetDashboardSummaryResponse,
  GetRequestParams,
  GetRequestResponse,
  ListRequestsQueryParams,
  ListRequestsResponse,
  UpdateRequestStatusBody,
  UpdateRequestStatusParams,
  UpdateRequestStatusResponse,
} from "@workspace/api-zod";

const router: IRouter = Router();

const categories = [
  "ACCESS",
  "HARDWARE",
  "SOFTWARE",
  "NETWORK",
  "SECURITY",
  "OTHER",
] as const;

const priorities = ["LOW", "MEDIUM", "HIGH", "CRITICAL"] as const;
const statuses = ["NEW", "CLASSIFIED", "IN_PROGRESS", "RESOLVED", "CLOSED"] as const;

type Category = (typeof categories)[number];
type Priority = (typeof priorities)[number];
let seedPromise: Promise<void> | undefined;

const sampleRequests = [
  {
    title: "SAP account locked before tomorrow's close",
    description:
      "My SAP account is locked and I need access before tomorrow. I am blocked from approving the quarterly close.",
    requester: "Maya Chen",
    category: "ACCESS" as Category,
    priority: "HIGH" as Priority,
    status: "CLASSIFIED" as const,
    system: "SAP",
    summary: "SAP account requires unlock",
  },
  {
    title: "VPN drops every 10 minutes",
    description:
      "The Frankfurt VPN connection keeps dropping during customer calls. I have restarted the client and still see the issue.",
    requester: "Jon Bell",
    category: "NETWORK" as Category,
    priority: "HIGH" as Priority,
    status: "IN_PROGRESS" as const,
    system: "VPN",
    summary: "Repeated VPN disconnects affecting calls",
  },
  {
    title: "Need a second monitor for design reviews",
    description:
      "Requesting a second 27-inch monitor for the product design desk to review prototypes alongside tickets.",
    requester: "Alina Ramos",
    category: "HARDWARE" as Category,
    priority: "MEDIUM" as Priority,
    status: "NEW" as const,
    system: "Workplace IT",
    summary: "Additional monitor requested for design reviews",
  },
  {
    title: "Suspicious invoice attachment received",
    description:
      "I received an invoice attachment from an unknown sender. I have not opened it and would like a security review.",
    requester: "Owen Wright",
    category: "SECURITY" as Category,
    priority: "CRITICAL" as Priority,
    status: "CLASSIFIED" as const,
    system: "Email",
    summary: "Unknown invoice attachment needs security review",
  },
] as const;

async function ensureSeeded(): Promise<void> {
  if (seedPromise) {
    await seedPromise;
    return;
  }

  seedPromise = (async () => {
    const existing = await db
      .select({ count: sql<number>`count(*)` })
      .from(requestsTable);

    if (Number(existing[0]?.count ?? 0) > 0) {
      return;
    }

    await db.insert(requestsTable).values([...sampleRequests]);
  })().catch((error: unknown) => {
    seedPromise = undefined;
    throw error;
  });

  await seedPromise;
}

function classifyRequest(title: string, description: string): {
  category: Category;
  priority: Priority;
  system: string;
  summary: string;
} {
  const text = `${title} ${description}`.toLowerCase();
  const category: Category = text.match(/password|account|access|permission|login|locked/)
    ? "ACCESS"
    : text.match(/laptop|monitor|keyboard|mouse|headset|equipment|hardware/)
      ? "HARDWARE"
      : text.match(/install|software|app|license|sap|salesforce/)
        ? "SOFTWARE"
        : text.match(/vpn|wifi|network|internet|connection/)
          ? "NETWORK"
          : text.match(/phish|suspicious|malware|security|breach|attachment/)
            ? "SECURITY"
            : "OTHER";

  const priority: Priority = text.match(/urgent|critical|blocked|before tomorrow|security|breach/)
    ? "CRITICAL"
    : text.match(/tomorrow|asap|important|deadline|down|locked/)
      ? "HIGH"
      : text.match(/soon|soonish|this week/)
        ? "MEDIUM"
        : "LOW";

  const system =
    text.match(/sap/) ? "SAP" :
    text.match(/vpn/) ? "VPN" :
    text.match(/wifi|network|internet/) ? "Network" :
    text.match(/email|attachment|phish/) ? "Email" :
    category === "HARDWARE" ? "Workplace IT" :
    "Internal systems";

  const summary = title.trim().length > 72
    ? `${title.trim().slice(0, 69)}...`
    : title.trim();

  return { category, priority, system, summary };
}

router.get("/requests", async (req, res): Promise<void> => {
  const parsed = ListRequestsQueryParams.safeParse(req.query);
  if (!parsed.success) {
    req.log.warn({ errors: parsed.error.flatten() }, "Invalid request filters");
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  await ensureSeeded();
  const { search, status, category, priority } = parsed.data;
  const filters = [];

  if (status) filters.push(eq(requestsTable.status, status));
  if (category) filters.push(eq(requestsTable.category, category));
  if (priority) filters.push(eq(requestsTable.priority, priority));
  if (search) {
    filters.push(
      or(
        ilike(requestsTable.title, `%${search}%`),
        ilike(requestsTable.description, `%${search}%`),
        ilike(requestsTable.requester, `%${search}%`),
        ilike(requestsTable.system, `%${search}%`),
      ),
    );
  }

  const requests = await db
    .select()
    .from(requestsTable)
    .where(filters.length ? and(...filters) : undefined)
    .orderBy(desc(requestsTable.createdAt));

  res.json(ListRequestsResponse.parse(requests));
});

router.post("/requests", async (req, res): Promise<void> => {
  const parsed = CreateRequestBody.safeParse(req.body);
  if (!parsed.success) {
    req.log.warn({ errors: parsed.error.flatten() }, "Invalid request body");
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  const classification = classifyRequest(parsed.data.title, parsed.data.description);
  const [created] = await db
    .insert(requestsTable)
    .values({
      ...parsed.data,
      ...classification,
      status: "CLASSIFIED",
    })
    .returning();

  req.log.info({ requestId: created.id }, "Created and classified request");
  res.status(201).json(CreateRequestResponse.parse(created));
});

router.get("/requests/:id", async (req, res): Promise<void> => {
  const params = GetRequestParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }

  const [request] = await db
    .select()
    .from(requestsTable)
    .where(eq(requestsTable.id, params.data.id));

  if (!request) {
    res.status(404).json({ error: "Request not found" });
    return;
  }

  res.json(GetRequestResponse.parse(request));
});

router.patch("/requests/:id/status", async (req, res): Promise<void> => {
  const params = UpdateRequestStatusParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }

  const parsed = UpdateRequestStatusBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  const [updated] = await db
    .update(requestsTable)
    .set({ status: parsed.data.status, updatedAt: new Date() })
    .where(eq(requestsTable.id, params.data.id))
    .returning();

  if (!updated) {
    res.status(404).json({ error: "Request not found" });
    return;
  }

  req.log.info({ requestId: updated.id, status: updated.status }, "Updated request status");
  res.json(UpdateRequestStatusResponse.parse(updated));
});

router.get("/dashboard/summary", async (_req, res): Promise<void> => {
  await ensureSeeded();
  const requests = await db
    .select()
    .from(requestsTable)
    .orderBy(asc(requestsTable.createdAt));

  const open = requests.filter((request) => !["RESOLVED", "CLOSED"].includes(request.status)).length;
  const urgent = requests.filter((request) => ["HIGH", "CRITICAL"].includes(request.priority)).length;
  const resolvedThisWeek = requests.filter((request) => request.status === "RESOLVED").length;
  const categoryCounts = categories.map((value) => ({
    category: value,
    count: requests.filter((request) => request.category === value).length,
  }));

  res.json(
    GetDashboardSummaryResponse.parse({
      total: requests.length,
      open,
      urgent,
      resolvedThisWeek,
      averageFirstResponseHours: 2.4,
      categories: categoryCounts,
    }),
  );
});

export default router;