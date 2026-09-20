# Application-level tenant scoping, not row-level security

The Organization is the only tenancy boundary, and isolation is enforced in the application rather than by Postgres row-level security. Use cases never receive the raw database handle; they receive a `TenantDb` already bound to one Organization, so a tenant predicate cannot be omitted. Raw cross-tenant access exists as a single lint-fenced export, allowed only in the admin surface, webhook handlers, the job runner and migrations.

## Considered options

RLS was the obvious alternative and was rejected for v1 on three grounds.

It does not remove the application-side predicate. An RLS policy reading `current_setting()` is not `LEAKPROOF`, so the planner cannot push it into an index scan; the documented mitigation is to pass `where organization_id = $1` explicitly anyway and index on it. RLS therefore adds a second check rather than replacing the first.

It is not free under our deployment constraints. Pooled connections forbid session state, so tenant context must be set transaction-locally, which wraps every read in a transaction. Application queries must run as a role that is neither the table owner nor `BYPASSRLS`, splitting the migration role from the runtime role. On Neon this is straightforward; on AWS RDS Proxy it is unproven — its pinning documentation lists `set_config` as a trigger and, unlike advisory locks, carves out no exception for the transaction-local form.

Better Auth documents nothing about running its own generated tables under RLS, so that interaction would be ours to discover.

## Consequences

`organizationId` is non-null and indexed on every tenant table, which is what a policy would need, so RLS remains a pure addition later rather than a migration. The cost of this decision is concentrated in one place: if the `TenantDb` wrapper has a bug, there is no second line of defence. That is the trade accepted here — a single small surface to get right and keep reviewed, over an operational tax paid on every query and every deployment target.
