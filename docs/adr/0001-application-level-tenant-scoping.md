# Application-level tenant scoping, not row-level security

The Organization is the only tenancy boundary, and isolation is enforced in the application rather than by Postgres row-level security. Use cases never receive the raw database handle; they receive a `TenantDb` already bound to one Organization, so a tenant predicate cannot be omitted. Raw cross-tenant access exists as a single lint-fenced export, allowed only in the admin surface, webhook handlers, the job runner and migrations.

## Considered options

RLS was the obvious alternative and was rejected for v1 on three grounds.

It does not remove the application-side predicate. An RLS policy reading `current_setting()` is not `LEAKPROOF`, so the planner cannot push it into an index scan; the documented mitigation is to pass `where organization_id = $1` explicitly anyway and index on it. RLS therefore adds a second check rather than replacing the first.

It is not free under our deployment constraints. Pooled connections forbid session state, so tenant context must be set transaction-locally, which wraps every read in a transaction. Application queries must run as a role that is neither the table owner nor `BYPASSRLS`, splitting the migration role from the runtime role. On Neon this is straightforward; on AWS RDS Proxy it is unproven — its pinning documentation lists `set_config` as a trigger and, unlike advisory locks, carves out no exception for the transaction-local form.

Better Auth documents nothing about running its own generated tables under RLS, so that interaction would be ours to discover.

## Consequences

**The enumerated list of raw-handle callers was one short, and the slice found the missing one.** This ADR names the admin surface, webhook handlers, the job runner and migrations. It omits the path that *creates* a membership: **accepting an invitation**. That use case cannot be behind an `orgProcedure`, because the membership an `orgProcedure` validates is the thing it is about to write — so it is a fifth legitimate caller, and the one that runs on every ordinary sign-up-and-join. It is contained the same way the others are: the unscoped read serves only to discover which Organization the invitation belongs to, and the check that decides runs again inside the transaction through a `TenantDb`. The membership lookup behind `orgProcedure` itself is unscoped for the same reason and lives in `@repo/db` beside the wrapper, so every unscoped read in the request path stays in one reviewed file.

**The wrapper is single-table, and two tenant reads are not.** An Organization's own row has no `organizationId` column — its tenant key is its primary key — so it is unreachable through a seam that predicates on that column, which the first invite discovered by needing to clear `isPersonal` ([#3](https://github.com/aniketmandloi/typesafe-saas-opus/issues/3)'s growth path). The member list is worse: a member's email lives on `user`, which has no tenant column at all. Both are answered by **named operations on the `TenantDb`** — `organization()`, `updateOrganization()`, `members()` — rather than by a join or a raw escape hatch. An escape hatch takes the predicate back off, and the predicate is the entire boundary; a named operation keeps the crossings countable, and `updateOrganization` can leave `deletedAt` out by construction, so no tenant-scoped path can go dark or come back ([ADR-0007](./0007-organization-soft-delete-and-purge.md)).

`organizationId` is non-null and indexed on every tenant table, which is what a policy would need, so RLS remains a pure addition later rather than a migration. The cost of this decision is concentrated in one place: if the `TenantDb` wrapper has a bug, there is no second line of defence. That is the trade accepted here — a single small surface to get right and keep reviewed, over an operational tax paid on every query and every deployment target.
