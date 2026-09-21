import {
  type InvitationRefusal,
  invitationExpiresAt,
  invitationRefusal,
  sameEmail,
} from "@repo/core";
import { invitation, member } from "@repo/schema";
import { TRPCError } from "@trpc/server";
import { eq } from "drizzle-orm";
import { z } from "zod";

import { mutate } from "../audit.ts";
import { orgProcedure, protectedProcedure, router } from "../trpc.ts";

export const INVITATION_EMAIL_TEMPLATE = "organization-invitation";

// Owner is absent on purpose. Handing someone ownership is a transfer, not an
// invitation, and it has its own rules about not stranding the Organization.
const invitableRole = z.enum(["admin", "member"]);

const refusalCode: Record<InvitationRefusal, "NOT_FOUND" | "FORBIDDEN"> = {
  // An expired or already-used invitation reads as gone rather than as
  // forbidden: the id arrived by email and is a bearer token, so the answer
  // should not describe an invitation to whoever is holding the link.
  "not-pending": "NOT_FOUND",
  expired: "NOT_FOUND",
  "wrong-recipient": "NOT_FOUND",
};

export const membersRouter = router({
  list: orgProcedure({ member: ["read"] }).query(({ ctx }) => ctx.tenant.members()),

  invite: orgProcedure({ member: ["invite"] })
    .input(z.object({ email: z.email(), role: invitableRole }))
    .mutation(async ({ ctx, input }) => {
      const existing = await ctx.tenant.members();
      if (existing.some((one) => sameEmail(one.email, input.email))) {
        throw new TRPCError({ code: "CONFLICT", message: "Already a member." });
      }

      const now = new Date();
      const created = await ctx.mutate({
        work: async (tenant) => {
          // A re-invite replaces rather than races a second row — the unique
          // index on (organization_id, email) would reject the insert anyway,
          // and replacing mints a fresh id, which retires the old link.
          await tenant.delete(invitation, eq(invitation.email, input.email));

          const [row] = await tenant.insert(invitation, {
            id: crypto.randomUUID(),
            email: input.email,
            role: input.role,
            status: "pending",
            inviterId: ctx.actor.userId,
            expiresAt: invitationExpiresAt(now),
            createdAt: now,
          });
          if (!row) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });

          // #3's growth path: the first invite promotes the inviter's personal
          // Organization in place. Nothing is created and nothing moves, which
          // is the whole reason there is no org-less mode to graduate out of.
          const [org] = await tenant.organization();
          const promoted = org?.isPersonal === true;
          if (promoted) await tenant.updateOrganization({ isPersonal: false });

          return { row, promoted };
        },
        audit: ({ row }) => ({
          action: "member.invited",
          subjectType: "invitation",
          subjectId: row.id,
          subjectDisplay: row.email,
        }),
      });

      // Enqueued after the commit, never inside it. The seam has no
      // transactional enqueue — pg-boss could join our transaction, SQS cannot
      // — so one of the two failures has to be chosen. A crash here leaves an
      // invitation with no mail sent, which a re-invite fixes; the other order
      // mails a link to an invitation that was rolled away, which nothing fixes.
      await ctx.deps.queue.enqueue("email.send", {
        to: created.row.email,
        template: INVITATION_EMAIL_TEMPLATE,
        variables: {
          invitationId: created.row.id,
          organizationId: ctx.organizationId,
          inviterName: ctx.actor.name,
        },
      });

      return created.row;
    }),

  /**
   * Accept an invitation.
   *
   * Deliberately *not* an orgProcedure: this is the mutation that creates the
   * membership every orgProcedure is built on, so it cannot be behind one. It
   * is the only use case in the kit that holds the raw handle.
   *
   * An invited address with no account gets UNAUTHORIZED here, which is the
   * signal for the client to route through signup carrying the invitation id
   * and come back. The server has no business in that routing: on web it is a
   * redirect, on mobile a deep link, and both are UI.
   */
  accept: protectedProcedure
    .input(z.object({ invitationId: z.string().min(1) }))
    .mutation(async ({ ctx, input }) => {
      // Unscoped, and only to discover which tenant this is. It decides
      // nothing: the check that matters runs again below, inside the
      // transaction and through a TenantDb.
      const [found] = await ctx.deps.db
        .select({ organizationId: invitation.organizationId })
        .from(invitation)
        .where(eq(invitation.id, input.invitationId))
        .limit(1);
      if (!found) throw new TRPCError({ code: "NOT_FOUND" });

      const actor = ctx.actor;
      return mutate(ctx.deps.db, found.organizationId, actor, {
        work: async (tenant) => {
          const [row] = await tenant.select(invitation, eq(invitation.id, input.invitationId));
          if (!row) throw new TRPCError({ code: "NOT_FOUND" });

          const refusal = invitationRefusal(row, actor.email, new Date());
          if (refusal) throw new TRPCError({ code: refusalCode[refusal] });

          // Not locked, because the seam has no row lock and pretending
          // otherwise would be worse than saying so. Double acceptance is
          // rejected by the unique index on member(organization_id, user_id),
          // which is the real guarantee here.
          await tenant.insert(member, {
            id: crypto.randomUUID(),
            userId: actor.userId,
            role: row.role ?? "member",
            createdAt: new Date(),
          });
          await tenant.update(
            invitation,
            { status: "accepted" },
            eq(invitation.id, input.invitationId),
          );

          return row;
        },
        audit: (row) => ({
          action: "member.invitation.accepted",
          subjectType: "invitation",
          subjectId: row.id,
          subjectDisplay: row.email,
        }),
      });
    }),
});
