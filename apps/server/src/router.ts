import { initTRPC, TRPCError } from "@trpc/server";
import { createProjectInput } from "@repo/schema";
import { canRename, slugify } from "@repo/core";
import type { TenantDb } from "@repo/db";
import type { Storage } from "@repo/storage";
import { z } from "zod";

export type Ctx = { db: TenantDb; storage: Storage; organizationId: string };

const t = initTRPC.context<Ctx>().create();

export const appRouter = t.router({
  projects: t.router({
    list: t.procedure.query(({ ctx }) => ctx.db.listProjects()),
    create: t.procedure
      .input(createProjectInput)
      .mutation(({ ctx, input }) => ctx.db.createProject({ name: slugify(input.name) })),
    presignUpload: t.procedure
      .input(z.object({ projectId: z.string(), contentType: z.string() }))
      .mutation(async ({ ctx, input }) => {
        const [project] = await ctx.db.findProject(input.projectId);
        if (!project || !canRename(project, ctx.organizationId)) {
          throw new TRPCError({ code: "NOT_FOUND" });
        }
        return ctx.storage.presignUpload(`${project.id}/upload`, input.contentType);
      }),
  }),
});

export type AppRouter = typeof appRouter;
