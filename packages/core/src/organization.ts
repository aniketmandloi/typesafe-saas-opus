import type { organization } from "@repo/schema";

import { type OrgRole, parseRoles } from "./permissions.ts";

type OrganizationRow = typeof organization.$inferSelect;

// A Dark Organization is soft-deleted and inside its grace window (ADR-0007).
// One nullable column says so, and nothing else changes — which is what makes
// the deletion reversible right up until purge.
export const isDark = (org: Pick<OrganizationRow, "deletedAt">): boolean => org.deletedAt !== null;

export const GRACE_WINDOW_DAYS = 30;

const DAY_MS = 24 * 60 * 60 * 1000;

export const purgeDueAt = (deletedAt: Date): Date =>
  new Date(deletedAt.getTime() + GRACE_WINDOW_DAYS * DAY_MS);

export const isPurgeDue = (org: Pick<OrganizationRow, "deletedAt">, now: Date): boolean =>
  org.deletedAt !== null && purgeDueAt(org.deletedAt).getTime() <= now.getTime();

// The T-7 warning goes to owners only; the deletion notice goes to all members.
// A Dark Organization receives no other mail at all (#16).
export const PURGE_WARNING_DAYS_BEFORE = 7;

export const isPurgeWarningDue = (org: Pick<OrganizationRow, "deletedAt">, now: Date): boolean => {
  if (org.deletedAt === null) return false;
  const warnAt = purgeDueAt(org.deletedAt).getTime() - PURGE_WARNING_DAYS_BEFORE * DAY_MS;
  return warnAt <= now.getTime();
};

type MemberRoles = { userId: string; role: string | null };

// The last-owner rule. Better Auth's own member routes are fenced off the
// public surface precisely so this can be true (#16) — `removeMember` upstream
// has no idea an Organization needs an owner.
export const owners = (members: MemberRoles[]): string[] =>
  members
    .filter((member) => parseRoles(member.role).includes("owner"))
    .map((member) => member.userId);

export const wouldStrandOrganization = (
  members: MemberRoles[],
  removingUserId: string,
): boolean => {
  const current = owners(members);
  return current.length === 1 && current[0] === removingUserId;
};

export const wouldStrandOnRoleChange = (
  members: MemberRoles[],
  userId: string,
  nextRoles: OrgRole[],
): boolean => {
  if (nextRoles.includes("owner")) return false;
  return wouldStrandOrganization(members, userId);
};
