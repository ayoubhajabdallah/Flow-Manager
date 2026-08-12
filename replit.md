# FlowOps

FlowOps turns plain-language internal support requests into searchable, prioritized workflow records for an operations team.

## Run & Operate

- `pnpm --filter @workspace/api-server run dev` — run the API server (port 5000)
- `pnpm run typecheck` — full typecheck across all packages
- `pnpm run build` — typecheck + build all packages
- `pnpm --filter @workspace/api-spec run codegen` — regenerate API hooks and Zod schemas from the OpenAPI spec
- `pnpm --filter @workspace/db run push` — push DB schema changes (dev only)
- Required env: `DATABASE_URL` — Postgres connection string

## Stack

- pnpm workspaces, Node.js 24, TypeScript 5.9
- API: Express 5
- DB: PostgreSQL + Drizzle ORM
- Validation: Zod (`zod/v4`), `drizzle-zod`
- API codegen: Orval (from OpenAPI spec)
- Build: esbuild (CJS bundle)

## Where things live

- `artifacts/flowops` — responsive React dashboard and request workflow UI.
- `artifacts/api-server` — live preview API service.
- `backend/flowops_api` — standalone FastAPI + SQLAlchemy reference backend.
- `lib/api-spec/openapi.yaml` — source-of-truth REST contract.
- `lib/db/src/schema/requests.ts` — workspace PostgreSQL schema.

## Architecture decisions

- The classifier has a deterministic local fallback so the MVP remains runnable without an LLM key.
- The OpenAPI contract is generated into the React client and Zod validators to keep the dashboard and API aligned.
- The preview uses the workspace API service, while the standalone Python backend documents the requested FastAPI architecture and Docker path.
- Sample data is seeded once on first read to make the dashboard useful immediately.

## Product

Employees can submit requests, review the classified result, search and filter the request queue, open a detailed request view, update status, and see dashboard-level request health.

## User preferences

_Populate as you build — explicit user instructions worth remembering across sessions._

## Gotchas

- Run `pnpm --filter @workspace/api-spec run codegen` after changing the OpenAPI spec.
- The live API is routed under `/api`; the frontend uses the generated client rather than hard-coded service ports.

## Pointers

- See the `pnpm-workspace` skill for workspace structure, TypeScript setup, and package details
