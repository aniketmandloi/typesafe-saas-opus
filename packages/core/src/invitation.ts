import type { invitation } from "@repo/schema";

type InvitationRow = typeof invitation.$inferSelect;

export const INVITATION_TTL_DAYS = 7;

const DAY_MS = 24 * 60 * 60 * 1000;

export const invitationExpiresAt = (issuedAt: Date): Date =>
  new Date(issuedAt.getTime() + INVITATION_TTL_DAYS * DAY_MS);

// Better Auth's own statuses, since the rows are its table (ADR-0011). The kit
// writes them, so the closed set is worth naming rather than spelling literals
// at each call site.
export const INVITATION_STATUSES = ["pending", "accepted", "rejected", "canceled"] as const;
export type InvitationStatus = (typeof INVITATION_STATUSES)[number];

export type InvitationRefusal = "not-pending" | "expired" | "wrong-recipient";

/**
 * Why this invitation cannot be accepted by this person right now, or null if
 * it can.
 *
 * One function rather than three predicates because the order matters and it is
 * not obvious: recipient is checked *last*. Answering "that invitation is not
 * yours" to someone holding a valid link for an expired invitation tells them
 * whose it is, and an invitation id is a bearer token that arrives by email.
 */
export const invitationRefusal = (
  row: Pick<InvitationRow, "status" | "expiresAt" | "email">,
  recipientEmail: string,
  now: Date,
): InvitationRefusal | null => {
  if (row.status !== "pending") return "not-pending";
  if (row.expiresAt.getTime() <= now.getTime()) return "expired";
  if (!sameEmail(row.email, recipientEmail)) return "wrong-recipient";
  return null;
};

// Addresses arrive from two directions — typed into an invite form, and read
// off an identity the user signed up with — and neither is normalised for us.
// Case is the only difference the kit folds: the local part is case-sensitive
// per RFC 5321 in theory, and in practice no provider the audience uses treats
// it that way, while a capitalised invite silently never matching is a support
// ticket nobody diagnoses.
export const sameEmail = (left: string, right: string): boolean =>
  left.trim().toLowerCase() === right.trim().toLowerCase();
