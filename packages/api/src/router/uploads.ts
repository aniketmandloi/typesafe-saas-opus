import { upload } from "@repo/schema";
import { requestUploadSchema } from "@repo/validators";
import { TRPCError } from "@trpc/server";
import { eq } from "drizzle-orm";
import { z } from "zod";

import { orgProcedure, router } from "../trpc.ts";

/**
 * The object key is minted here, never accepted from the client.
 *
 * A client-chosen key lets one tenant name another tenant's object, and the
 * tenant prefix is what makes a stray key obvious when someone is reading a
 * bucket listing during an incident.
 */
const objectKeyFor = (organizationId: string, uploadId: string) =>
  `org/${organizationId}/${uploadId}`;

export const uploadsRouter = router({
  request: orgProcedure({ project: ["update"] })
    .input(requestUploadSchema)
    .mutation(async ({ ctx, input }) => {
      const id = crypto.randomUUID();
      const objectKey = objectKeyFor(ctx.organizationId, id);

      // Presigned and direct-to-storage, because nothing else is portable:
      // Vercel caps request and response at 4.5 MB and Lambda at 6 MB, so the
      // bytes never pass through this procedure (ADR-0004).
      const presigned = await ctx.deps.storage.presignUpload({
        objectKey,
        contentType: input.contentType,
        byteSize: input.byteSize,
      });

      // The row is written before the client uploads, so purge can find the
      // object later. The gap is deliberate and documented: an upload that is
      // presigned and then abandoned leaves a row, and one that is presigned
      // outside this procedure could not — which is why the bucket carries a
      // lifecycle rule as well (ADR-0007).
      const row = await ctx.mutate({
        work: async (tenant) => {
          const [created] = await tenant.insert(upload, {
            id,
            objectKey,
            contentType: input.contentType,
            byteSize: input.byteSize,
            projectId: input.projectId ?? null,
            createdBy: ctx.actor.userId,
          });
          if (!created) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });
          return created;
        },
        audit: (created) => ({
          action: "upload.requested",
          subjectType: "upload",
          subjectId: created.id,
          subjectDisplay: created.objectKey,
        }),
      });

      return { upload: row, presigned };
    }),

  downloadUrl: orgProcedure({ project: ["read"] })
    .input(z.object({ id: z.string().min(1) }))
    .query(async ({ ctx, input }) => {
      // The row is read through the TenantDb first, so the object key reaching
      // the storage adapter has already been proved to belong to this tenant.
      // Signing a key straight from client input would hand out a URL for any
      // object whose key could be guessed.
      const [row] = await ctx.tenant.select(upload, eq(upload.id, input.id));
      if (!row) throw new TRPCError({ code: "NOT_FOUND" });
      return ctx.deps.storage.presignDownload({ objectKey: row.objectKey });
    }),
});
