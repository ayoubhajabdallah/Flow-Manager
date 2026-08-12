import { createInsertSchema } from "drizzle-zod";
import {
  integer,
  pgTable,
  serial,
  text,
  timestamp,
} from "drizzle-orm/pg-core";
import { z } from "zod/v4";

export const requestsTable = pgTable("flowops_requests", {
  id: serial("id").primaryKey(),
  title: text("title").notNull(),
  description: text("description").notNull(),
  requester: text("requester").notNull(),
  category: text("category").notNull(),
  priority: text("priority").notNull(),
  status: text("status").notNull(),
  system: text("system").notNull(),
  summary: text("summary").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date()),
});

export const insertRequestSchema = createInsertSchema(requestsTable).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

export type InsertRequest = z.infer<typeof insertRequestSchema>;
export type Request = typeof requestsTable.$inferSelect;

export const requestCountSchema = z.object({
  count: z.number().int(),
});