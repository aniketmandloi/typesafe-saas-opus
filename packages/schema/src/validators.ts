import { createInsertSchema, createSelectSchema } from "drizzle-zod";
import { z } from "zod";

import { project, upload } from "./project.ts";

// Derived, never hand-written: the table is the single declaration and these
// infer from it. A validator that restates a column's shape is a bug.
//
// Constraints are supplied as whole overrides rather than through drizzle-zod's
// `(schema) => schema.min(1)` refinement callbacks. Those are the documented
// form and they do not typecheck here: drizzle-zod 0.8.3 hands the callback a
// `ZodType<Buffer>` for a `text()` column, under TypeScript 6 and 7 alike, with
// the column's own `data`/`columnType` inferring correctly as `string`/`PgText`.
// The fix is on the unreleased 1.0.0 beta line, which the kit will not adopt.
// Revisit when drizzle-zod 1.0 ships; until then an override is the only form
// that types, and it is narrowly worse — it names the primitive a second time.
export const selectProjectSchema = createSelectSchema(project);

// The columns a caller may supply. Everything omitted is the server's to
// decide — organization_id above all: it comes from the request's org context
// via TenantDb, never from the client, or the tenant boundary would be a
// client-supplied value.
export const insertProjectSchema = createInsertSchema(project, {
  name: z.string().min(1).max(200),
  description: z.string().max(2000).nullish(),
}).pick({ name: true, description: true });

export const updateProjectSchema = insertProjectSchema.partial().extend({
  id: z.string().min(1),
});

export const selectUploadSchema = createSelectSchema(upload);

// The client asks for an upload; the server mints the object key, so it is not
// here. A client-chosen key would let one tenant name another tenant's object.
export const requestUploadSchema = createInsertSchema(upload, {
  contentType: z.string().min(1),
  byteSize: z.number().int().positive(),
  projectId: z.string().min(1).nullish(),
}).pick({ contentType: true, byteSize: true, projectId: true });

export type Project = z.infer<typeof selectProjectSchema>;
export type NewProject = z.infer<typeof insertProjectSchema>;
export type ProjectUpdate = z.infer<typeof updateProjectSchema>;
export type Upload = z.infer<typeof selectUploadSchema>;
export type UploadRequest = z.infer<typeof requestUploadSchema>;
