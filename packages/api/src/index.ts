import { membersRouter } from "./router/members.ts";
import { organizationsRouter } from "./router/organizations.ts";
import { projectsRouter } from "./router/projects.ts";
import { uploadsRouter } from "./router/uploads.ts";
import { router } from "./trpc.ts";

export const appRouter = router({
  members: membersRouter,
  organizations: organizationsRouter,
  projects: projectsRouter,
  uploads: uploadsRouter,
});

/**
 * The one shared artifact between the server and both clients.
 *
 * Not a shared data layer — there isn't one (#9). Web and mobile consume this
 * as a type and never at runtime, and with `verbatimModuleSyntax` on, a missing
 * `type` keyword in `apps/mobile` becomes a genuine runtime import of the whole
 * server and fails at bundle time rather than shipping one.
 */
export type AppRouter = typeof appRouter;

export { ORGANIZATION_HEADER } from "@repo/core";
export * from "./audit.ts";
export * from "./context.ts";
export * from "./deps.ts";
export { INVITATION_EMAIL_TEMPLATE } from "./router/members.ts";
export type { OrgContext } from "./trpc.ts";
export {
  createCallerFactory,
  orgProcedure,
  protectedProcedure,
  publicProcedure,
  router,
} from "./trpc.ts";
