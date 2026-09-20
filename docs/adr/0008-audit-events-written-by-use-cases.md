# Org-scoped audit events are written by use cases, never by Better Auth hooks

The kit's audit log records **intents, not diffs**: one row per business action, named after the use case that ran, and an audit entry is a **required argument of the use-case transaction helper** rather than a call made inside it — so failing to audit a mutation is a compile error, not an omission discovered during an incident. An entry **never stores before/after field values**. It records that an intent occurred against a named target, and nothing about what the target contained.

Org-scoped entries are written by our own use cases, inside the caller's transaction. Better Auth's `organizationHooks` are deliberately unused, and `databaseHooks` serve only platform-scoped authentication events, which are explicitly best-effort.

Two things here will look wrong to a reader who knows Better Auth, and one will look wrong to anyone who has built an audit log before.

## Considered options

**`organizationHooks` as the capture mechanism** is the obvious design and does not survive contact with 1.7.5. Of its 26 hooks, only `beforeDeleteOrganization` and `afterDeleteOrganization` receive a `ctx` — every other hook sees plain data with no headers, no path and no session. None is guaranteed to run inside its write's transaction; `createOrganization` isn't wrapped in one at all, being three or four separate non-atomic writes with hooks interleaved. `after` hooks are queued through `queueAfterTransactionHook` and always run post-commit. An audit log built on them would be non-atomic and frequently unable to say who acted.

Routing around them costs nothing, because [ADR-0007](./0007-organization-soft-delete-and-purge.md) already fences Better Auth's member-mutating routes off the public surface to protect the last-owner invariant and the Dark rule. Extending that fence to the remaining org-mutating routes makes every org-scoped audit write an ordinary use-case write in our own transaction. The fence now carries four invariants; it is the single most load-bearing configuration line in the kit, and undoing it silently breaks all four.

**Enlisting into Better Auth's transaction** via `getCurrentAdapter` and `runWithTransaction` from `@better-auth/core/context` was rejected. The primitives are real and publicly exported but undocumented as an integration surface, and they only help for the narrow set of operations Better Auth itself transacts. Building the audit log's atomicity guarantee on an unsupported API means a minor version bump can silently degrade it.

**A diff-oriented log** captured automatically would have solved the omission problem without a compile-time rule, and was rejected for two reasons. Roles live in a CSV column on Better Auth's `member` table, so "promoted to admin" surfaces as `role: "member" → "member,admin"` with no record of why. More decisively, a diff log stores field values, which would make every staff read of the log a read of tenant content and put it in direct conflict with [ADR-0005](./0005-admin-app-reads-metadata-not-content.md).

## Consequences

**The log is tenant data with no foreign keys.** Org and actor ids are plain columns beside display strings captured at write time ([ADR-0007](./0007-organization-soft-delete-and-purge.md)), so entries outlive the purge of what they describe, and an erasure request hollows out the identifiers without destroying the record. Reads still go through `TenantDb` like any tenant data; owners and admins see their own organization's log, plain members do not.

**A null `organization_id` means platform-scoped, and that is a privacy mechanism.** A user who belongs to two organizations signs in once; stamping that event with whichever organization they happened to land in would expose their activity to the other's admins. So authentication events carry no organization and are visible to platform staff only — which the ordinary tenant predicate enforces for free, since it excludes nulls without anyone writing a rule.

**The table is append-only in the database, not by convention.** A trigger rejects every `DELETE` and any `UPDATE` touching a column other than the `*_display` fields. That makes [ADR-0007](./0007-organization-soft-delete-and-purge.md)'s erasure scrub the only mutation Postgres will accept, and it holds against the raw handle, which is the one path that could otherwise rewrite history.

**Authentication events are inferred, and inference fails silently.** There is no "password changed" event in Better Auth — it is an `account.update` whose payload happens to contain `password`. A version bump that renames a field would not break the build; the log would simply go quiet, which is the worst failure mode an audit log has. The mapping therefore lives in one module with an integration test per hook-sourced event asserting that it actually fires. These tests are a deliberate exception to the three-example-tests rule set by [Toolchain baseline](https://github.com/aniketmandloi/typesafe-saas-opus/issues/8): they are not examples, they are the tripwire.

**Two events cannot be captured at all, and the kit does not pretend otherwise.** Passkey add and remove are unobservable — `@better-auth/passkey` is a separate package in 1.7.x that calls the raw adapter directly, bypassing the hook wrappers, and `passkey` is not one of the four `databaseHooks` models. Wrapping its endpoints to recover the event would mean maintaining a proxy over a package that already bypasses its own framework's hooks, which costs more than the event is worth. Separately, an impersonation session that ends by expiry fires nothing, because expiry is passive: the end is therefore derived as `min(explicit stop, expires_at)`, with `impersonationSessionDuration` pinned in our own configuration rather than inherited from the library default.

**Session events depend on a configuration detail that fails silently.** `deleteSession` returns early when `secondaryStorage` is configured without `storeSessionInDatabase`, so sign-out and session revocation would stop being recorded with no error anywhere. The kit therefore requires one or the other.
