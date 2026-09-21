import type { project } from "@repo/schema";
import { z } from "zod";

import type { Assert, KeysMatch, ShapesMatch } from "./gate.ts";

type ProjectInsert = typeof project.$inferInsert;

// The columns the server decides, and therefore the ones no client may send.
// `organizationId` above all: it comes from the request's org context via
// TenantDb, or the tenant boundary would be a client-supplied value.
//
// This list is half of the exhaustiveness gate below: adding a column to the
// table forces a choice between validating it and naming it here. Nothing can
// be added and silently left unvalidated, which `.pick()` never caught.
type ServerOwned = "id" | "organizationId" | "createdBy" | "createdAt" | "updatedAt";

type ClientSuppliable = Exclude<keyof ProjectInsert, ServerOwned>;

// Plain Zod, tied to the table by the assertions below rather than by
// `createInsertSchema` running in the bundle (ADR-0013). Every constraint here
// was already hand-written before the split: drizzle-zod 0.8.3's refinement
// callbacks do not typecheck against a `text()` column, so whole overrides were
// the only form that compiled, and the derivation contributed no runtime shape.
export const insertProjectSchema = z.object({
  name: z.string().min(1).max(200),
  description: z.string().max(2000).nullish(),
});

export const updateProjectSchema = insertProjectSchema.partial().extend({
  id: z.string().min(1),
});

export type NewProject = z.infer<typeof insertProjectSchema>;
export type ProjectUpdate = z.infer<typeof updateProjectSchema>;

export type _InsertProjectKeys = Assert<KeysMatch<NewProject, ClientSuppliable>>;
export type _InsertProjectShape = Assert<
  ShapesMatch<NewProject, Pick<ProjectInsert, ClientSuppliable>>
>;
export type _UpdateProjectKeys = Assert<KeysMatch<ProjectUpdate, ClientSuppliable | "id">>;
