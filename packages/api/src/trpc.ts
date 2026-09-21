import { hasOrgPermission, type OrgPermissions, type OrgRole } from "@repo/core";
import {
  DarkOrganizationError,
  NotAMemberError,
  openTenantSession,
  type TenantDb,
  UnknownOrganizationError,
} from "@repo/db";
import { initTRPC, TRPCError } from "@trpc/server";

import { type AuditDraft, mutate } from "./audit.ts";
import { type Actor, ORGANIZATION_HEADER, type RequestContext } from "./context.ts";

const t = initTRPC.context<RequestContext>().create();

export const router = t.router;
export const createCallerFactory = t.createCallerFactory;
export const publicProcedure = t.procedure;

export const protectedProcedure = t.procedure.use(({ ctx, next }) => {
  if (!ctx.actor) throw new TRPCError({ code: "UNAUTHORIZED" });
  return next({ ctx: { ...ctx, actor: ctx.actor } });
});

type OrgPermissionQuery = {
  [TResource in keyof OrgPermissions]?: OrgPermissions[TResource];
};

export type OrgContext = RequestContext & {
  actor: Actor;
  organizationId: string;
  roles: OrgRole[];
  tenant: TenantDb;
  /** Bound to this request's Organization and actor, so a use case cannot audit into the wrong tenant. */
  mutate: <TResult>(args: {
    work: (tenant: TenantDb) => Promise<TResult>;
    audit: (result: TResult) => AuditDraft;
  }) => Promise<TResult>;
};

/**
 * A procedure scoped to one Organization, declaring the permission it needs.
 *
 * The permission is checked here rather than in the use case so an
 * unauthorized call dies before a transaction opens. The row-dependent half —
 * "delete *any* project" versus "delete *your own*" — stays in the use case,
 * because that check needs the row (#3).
 */
export const orgProcedure = (permission: OrgPermissionQuery) =>
  protectedProcedure.use(async ({ ctx, next }) => {
    const organizationId = ctx.organizationId;
    if (!organizationId) {
      throw new TRPCError({
        code: "BAD_REQUEST",
        message: `Missing ${ORGANIZATION_HEADER}.`,
      });
    }

    let session: Awaited<ReturnType<typeof openTenantSession>>;
    try {
      session = await openTenantSession(ctx.deps.db, organizationId, ctx.actor.userId);
    } catch (error) {
      // All three refusals answer NOT_FOUND on purpose. FORBIDDEN would confirm
      // that an Organization exists to a caller who only guessed its id, which
      // turns the header into a probe. A member of a Dark Organization gets the
      // same answer: ADR-0007 says no tenant-scoped code reaches it, and the
      // owner's view of the grace window is a different surface, not this one.
      if (
        error instanceof NotAMemberError ||
        error instanceof UnknownOrganizationError ||
        error instanceof DarkOrganizationError
      ) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Organization not found." });
      }
      throw error;
    }

    if (!hasOrgPermission(session.roles, permission)) {
      throw new TRPCError({ code: "FORBIDDEN" });
    }

    const orgCtx: OrgContext = {
      ...ctx,
      actor: ctx.actor,
      organizationId,
      roles: session.roles,
      tenant: session.tenant,
      mutate: (args) => mutate(ctx.deps.db, organizationId, ctx.actor, args),
    };
    return next({ ctx: orgCtx });
  });
