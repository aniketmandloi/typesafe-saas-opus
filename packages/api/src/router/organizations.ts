import { membershipsOf } from "@repo/db";

import { protectedProcedure, router } from "../trpc.ts";

export const organizationsRouter = router({
  /**
   * Which Organizations the caller belongs to.
   *
   * Not an `orgProcedure`, because it is the question asked *before* one is
   * named. Both clients need it for the same reason: routes are slug-shaped
   * (`/o/:slug/…`, #3) while the contract is id-shaped, and nothing else
   * bridges the two. It is also what the org switcher reads, and what tells a
   * solo user their only Organization is personal so the switcher can stay
   * hidden.
   */
  list: protectedProcedure.query(({ ctx }) => membershipsOf(ctx.deps.db, ctx.actor.userId)),
});
