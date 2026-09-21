import type { ActorType } from "@repo/core";
import { createTenantDb, type Executor, type TenantDb } from "@repo/db";
import { auditEvent } from "@repo/schema";

import type { Actor } from "./context.ts";

/**
 * Every intent the contract can record, named after the use case that runs it.
 *
 * A closed union rather than a string: a typo in an action name is the kind of
 * thing that surfaces during an incident, when someone greps for an event that
 * was never written under the name they are searching for.
 */
export const AUDIT_ACTIONS = [
  "project.created",
  "project.updated",
  "project.deleted",
  "upload.requested",
  "member.invited",
  "member.invitation.accepted",
  "organization.promoted",
] as const;

export type AuditAction = (typeof AUDIT_ACTIONS)[number];

/**
 * What the use case says happened.
 *
 * No before/after values, by design and not by omission (ADR-0008): storing
 * them would make every platform-staff read of the log a read of tenant
 * content, against ADR-0005. `subjectDisplay` is the one denormalised copy, and
 * it exists so an entry still reads after its subject is purged.
 */
export type AuditDraft = {
  action: AuditAction;
  subjectType: string;
  subjectId: string | null;
  subjectDisplay: string | null;
};

const actorRow = (
  actor: Actor,
): { actorId: string; actorType: ActorType; actorDisplay: string } => ({
  actorId: actor.userId,
  actorType: "member",
  actorDisplay: actor.email,
});

/**
 * Run a mutation and record what it was, in one transaction.
 *
 * `audit` is a required argument, so a use case that forgets to audit does not
 * compile — which is the whole of ADR-0008's mechanism. It takes the work's
 * result because the subject usually does not exist until the work has run:
 * a created Project has no id to name beforehand.
 *
 * The entry is written through a TenantDb bound to the transaction, so it
 * commits or rolls back with the change it describes. Better Auth's own hooks
 * could not offer that — none is guaranteed to run inside its write's
 * transaction, and `after` hooks always run post-commit.
 */
export const mutate = async <TResult>(
  db: Executor,
  organizationId: string,
  actor: Actor,
  {
    work,
    audit,
  }: {
    work: (tenant: TenantDb) => Promise<TResult>;
    audit: (result: TResult) => AuditDraft;
  },
): Promise<TResult> =>
  db.transaction(async (tx) => {
    const tenant = createTenantDb(tx, organizationId);
    const result = await work(tenant);
    await tenant.insert(auditEvent, {
      id: crypto.randomUUID(),
      ...actorRow(actor),
      ...audit(result),
    });
    return result;
  });
