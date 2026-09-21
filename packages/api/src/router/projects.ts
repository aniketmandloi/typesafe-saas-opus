import { insertProjectSchema, project, updateProjectSchema } from "@repo/schema";
import { TRPCError } from "@trpc/server";
import { eq } from "drizzle-orm";
import { z } from "zod";

import { orgProcedure, router } from "../trpc.ts";

// The worked example a cloner replaces with their own domain. Every procedure
// here reaches the database only through `ctx.tenant`, which is already bound
// to one Organization — there is no unscoped call to forget.
export const projectsRouter = router({
  list: orgProcedure({ project: ["read"] }).query(({ ctx }) => ctx.tenant.select(project)),

  create: orgProcedure({ project: ["create"] })
    .input(insertProjectSchema)
    .mutation(({ ctx, input }) =>
      ctx.mutate({
        work: async (tenant) => {
          const [created] = await tenant.insert(project, {
            id: crypto.randomUUID(),
            name: input.name,
            description: input.description ?? null,
            createdBy: ctx.actor.userId,
          });
          if (!created) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });
          return created;
        },
        audit: (created) => ({
          action: "project.created",
          subjectType: "project",
          subjectId: created.id,
          subjectDisplay: created.name,
        }),
      }),
    ),

  update: orgProcedure({ project: ["update"] })
    .input(updateProjectSchema)
    .mutation(({ ctx, input }) =>
      ctx.mutate({
        work: async (tenant) => {
          const { id, ...changes } = input;
          const [updated] = await tenant.update(
            project,
            {
              ...(changes.name === undefined ? {} : { name: changes.name }),
              ...(changes.description === undefined
                ? {}
                : { description: changes.description ?? null }),
            },
            eq(project.id, id),
          );
          // Zero rows means the id belongs to another tenant or to nothing at
          // all, and the two are indistinguishable from here by construction.
          if (!updated) throw new TRPCError({ code: "NOT_FOUND" });
          return updated;
        },
        audit: (updated) => ({
          action: "project.updated",
          subjectType: "project",
          subjectId: updated.id,
          subjectDisplay: updated.name,
        }),
      }),
    ),

  delete: orgProcedure({ project: ["delete"] })
    .input(z.object({ id: z.string().min(1) }))
    .mutation(({ ctx, input }) =>
      ctx.mutate({
        work: async (tenant) => {
          const [deleted] = await tenant.delete(project, eq(project.id, input.id));
          if (!deleted) throw new TRPCError({ code: "NOT_FOUND" });
          return deleted;
        },
        audit: (deleted) => ({
          action: "project.deleted",
          subjectType: "project",
          subjectId: deleted.id,
          // Captured now because the row is gone: an entry that outlives its
          // subject has to carry enough to still read (ADR-0007).
          subjectDisplay: deleted.name,
        }),
      }),
    ),
});
