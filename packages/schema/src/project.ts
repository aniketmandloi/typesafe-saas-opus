import { bigint, index, pgTable, text, timestamp } from "drizzle-orm/pg-core";

import { organization, user } from "./auth.ts";

// The slice's tenant-scoped entity. Every tenant table follows this shape:
// a non-null organization_id that CASCADEs (fired only by purge, ADR-0007),
// and a created_by that SET NULLs, because the creator is attribution and the
// Organization owns the data.
export const project = pgTable(
  "project",
  {
    id: text("id").primaryKey(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    description: text("description"),
    createdBy: text("created_by").references(() => user.id, { onDelete: "set null" }),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at")
      .defaultNow()
      .$onUpdate(() => new Date())
      .notNull(),
  },
  (table) => [index("project_organization_id_idx").on(table.organizationId)],
);

// Uploads are rows first and objects second: purge enumerates these to delete
// the stored objects, so an object presigned but never completed has no row
// and is invisible to purge. That gap is a bucket lifecycle rule, not a
// runtime concern (ADR-0007).
export const upload = pgTable(
  "upload",
  {
    id: text("id").primaryKey(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    projectId: text("project_id").references(() => project.id, { onDelete: "cascade" }),
    objectKey: text("object_key").notNull(),
    contentType: text("content_type").notNull(),
    byteSize: bigint("byte_size", { mode: "number" }).notNull(),
    createdBy: text("created_by").references(() => user.id, { onDelete: "set null" }),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (table) => [index("upload_organization_id_idx").on(table.organizationId)],
);

// The row as the database holds it. A client never sees this type: what crosses
// the wire is the Contract's output type, where `createdAt` is an ISO string
// (ADR-0014).
export type Project = typeof project.$inferSelect;
export type Upload = typeof upload.$inferSelect;
