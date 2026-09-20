# The Organization is soft-deleted and purged on a clock, never deleted interactively

Ending an Organization is a two-stage act. A deletion request sets `deleted_at` on the `organization` row and nothing else; the Organization is immediately **dark** (no `TenantDb` will construct for it) and stays that way for a 30-day **grace window**, after which a per-tenant **purge** job hard-deletes it for real. No interactive code path ever deletes an Organization row, and no tenant table carries a `deleted_at` of its own — tenant reads are already funnelled through a `TenantDb` bound to one org by [ADR-0001](./0001-application-level-tenant-scoping.md), so one column and one check at construction put everything beneath it out of reach.

This is recorded because the code looks like the opposite of the obvious design from two directions at once: every tenant table declares `ON DELETE CASCADE` that appears never to fire, and Better Auth ships a perfectly good `POST /organization/delete` that the kit deliberately switches off.

## Considered options

**Better Auth's own `organization.delete`** is a hard, immediate, transactional delete. Adopting it would have meant a second deletion path — owner-permissioned, invisible to our code, bypassing the grace window, and cascading `member` away inside a transaction we do not control. Losing `member` is what makes it unusable rather than merely redundant: the surviving owner membership *is* the reversal handle, the only authorisation a dark Organization can still offer. So the plugin is configured with `disableOrganizationDeletion: true`, and membership mutations are fenced off the public surface entirely.

**Soft-deleting the `user` row symmetrically** was rejected. Better Auth has no first-party soft delete, no auth path filters on status, and `user.email` is `unique`, so a soft-deleted user would keep signing in and keep their email hostage against re-registration. Account deletion is therefore hard and immediate, and is the one irreversible act in the design.

**A `deleted_at` on every tenant table** would make each query carry the check. It buys nothing that the single check at `TenantDb` construction does not already buy, and it puts the cost on every read forever.

## Consequences

**Cascade is real but has exactly one caller.** `ON DELETE CASCADE` on every tenant table's org FK fires only inside the purge job. A reader who assumes it protects interactive deletes has it backwards: interactive code cannot delete an Organization at all.

**Purge must reach outside the database, in that order.** Object storage and Polar are deleted *before* the DB transaction, because the rows being deleted are what hold the object keys and the `polarCustomerId`. Every step is idempotent so the job can retry: a missing object is a no-op, an already-deleted Polar customer returning 404 counts as success. Purge touches no new adapter method — it enumerates upload rows and calls the existing per-object `delete`, keeping the storage seam demand-shaped as [ADR-0004](./0004-adapter-seam-demand-shaped-and-statically-composed.md) requires. Objects presigned but never completed have no row and are therefore invisible to purge; they are a bucket lifecycle rule in `apps/infra`.

**The audit log outlives its subjects.** Audit rows hold org and actor ids as plain columns with no foreign key, alongside a display string captured at write time, so purge cannot cascade away the record of what happened and an erasure request can scrub the denormalised identifiers without destroying the entry.

**Deleting an account can strand its personal Organization.** The user row is hard-deleted, `member.userId` cascades, and the surviving-owner reversal handle goes with it. The personal Organization's grace window is therefore a staff data-retention window, not a self-service undo — and even staff can restore the Organization's data, never the user.

**The last-owner invariant is enforced in a transaction, not by a constraint.** Roles live in a CSV column on Better Auth's `member` table with no unique constraints, so "at least one owner" is an aggregate invariant a domain rule asserts under a row lock on the Organization. It holds only because Better Auth's own member-mutating routes are fenced; anything reaching them directly bypasses it. Better Auth's user deletion is additionally non-transactional, so the race between our check and its cascade cannot be closed from outside. Both are knowingly accepted, with a trigger available as the hedge if the invariant is ever observed to break.

**Polar retains what we cannot erase.** Purge deletes the Polar customer with `anonymize=true`, which hashes the email and name and clears the billing address, but historic orders and invoices are Polar's own records of its own sale as merchant of record and survive regardless. Polar documents the retention but not its duration.
