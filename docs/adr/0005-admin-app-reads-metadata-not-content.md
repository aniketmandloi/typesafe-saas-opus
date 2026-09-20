# The Admin app reads metadata, not tenant content

The Admin app is the one surface permitted the raw, non-tenant-scoped database handle — the single place the `TenantDb` guarantee of [ADR-0001](./0001-application-level-tenant-scoping.md) is deliberately switched off. That permission is scoped as narrowly as it can be:

**Platform staff may read tenant *metadata* and never tenant *content*.** Metadata is the organization list, the user list, subscription state, counts, timestamps — what support needs to answer "what state is this account in?". Content is Projects, uploaded files, anything a customer authored. To see content, a staff member **impersonates** a member of that organization, which puts them back on the ordinary tenant-scoped path with `orgProcedure` and `TenantDb` behaving normally, time-boxed and audit-logged.

This is recorded because the obvious next feature is a "view this org's projects" page in the Admin app, and it would look like a small convenience rather than the removal of the kit's only tenant-isolation guarantee.

## Consequences

The raw-handle allowlist covers a **small, enumerable set of metadata queries** rather than arbitrary access, so it is reviewable and a diff adding a tenant-content query to it is conspicuous.

The audit trail answers a real question. "Staff member X impersonated user Y in organization Z for forty minutes" is meaningful to a customer; "the Admin app ran a query" is noise.

Support staff cannot glance at customer data to diagnose a problem. Every look at content costs an impersonation session with a customer-visible trail. For B2B SaaS this is usually the correct default and often a compliance requirement, but it is a genuine workflow cost, knowingly accepted.

Platform identity lives in the same Better Auth instance as customer identity, because impersonation requires both in one system. A compromised staff account is therefore inside the same auth system as every customer — paid down with mandatory 2FA on platform roles, and by this rule limiting what such an account can reach at all.
