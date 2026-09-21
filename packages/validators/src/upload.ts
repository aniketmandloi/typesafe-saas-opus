import type { upload } from "@repo/schema";
import { z } from "zod";

import type { Assert, KeysMatch, ShapesMatch } from "./gate.ts";

type UploadInsert = typeof upload.$inferInsert;

// `objectKey` is server-owned and that is a boundary, not a convenience: a
// client-chosen key would let one tenant name another tenant's object.
type ServerOwned = "id" | "organizationId" | "objectKey" | "createdBy" | "createdAt";

type ClientSuppliable = Exclude<keyof UploadInsert, ServerOwned>;

export const requestUploadSchema = z.object({
  contentType: z.string().min(1),
  byteSize: z.number().int().positive(),
  projectId: z.string().min(1).nullish(),
});

export type UploadRequest = z.infer<typeof requestUploadSchema>;

export type _RequestUploadKeys = Assert<KeysMatch<UploadRequest, ClientSuppliable>>;
export type _RequestUploadShape = Assert<
  ShapesMatch<UploadRequest, Pick<UploadInsert, ClientSuppliable>>
>;
