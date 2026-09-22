# Rate limiting is kit-owned, Postgres-backed and keyed on verified identity

Rate limiting runs as **tRPC middleware over a Postgres bucket table the kit owns outright** — not an Adapter, not Hono middleware, not the target's edge. Its key is always an identity the server has already verified, never one the caller claimed. Better Auth keeps its own path rules over the same store, through `customStorage`.

This decision started from a live defect rather than a blank page. `createAuth` passed no `rateLimit` option, and Better Auth 1.7.5 defaults `enabled` to `NODE_ENV === "production"` and `storage` to `"memory"`. **Every deployed target was already rate limiting sign-in at 3 requests per 10 seconds, per process, and nobody had decided that.**

## The key is verified, because a claimed one is free to rotate

The Organization arrives as a header and means nothing until `openTenantSession` confirms membership. Keying on it before then hands an attacker a fresh bucket per guessed org id. Keying on it after costs a session lookup and a membership query — which the request was going to pay anyway.

So there are **two nested limits, both on identity the server established**:

| Procedure | Key | What it bounds |
| --- | --- | --- |
| `protectedProcedure` | `userId` | The cost of reaching the org check at all — and org-less work: invite acceptance, org listing |
| `orgProcedure` | `organizationId`, after `openTenantSession` | The actual per-tenant quota |

Org-id rotation burns the user's bucket, so the attack pays for itself. **No IP key exists anywhere in the Contract**, because `publicProcedure` is exported and never used: every procedure in `projects`, `members`, `organizations` and `uploads` is protected or org-scoped. IP keying is Better Auth's problem alone.

## It is not an Adapter

[ADR-0004](./0004-adapter-seam-demand-shaped-and-statically-composed.md) shapes the seam around a capability a Use case *calls*. Nothing calls this; it is middleware. The billing precedent — one implementation, justified by containment — does not transfer either, because there is no provider SDK to contain, only Drizzle, which is already everywhere.

Postgres is mandatory on every deployment, so a Redis adapter would add a dependency, an env fragment and a thing every fork must provision, to replace something already present. The limiter therefore joins `db` and `auth` on `ApiDeps` as an **injected non-Adapter dependency** — fakeable in tests, constructed from `deps.db` in production, declaring no env fragment. A fork that outgrows Postgres replaces one function behind `consume(key, rule)`, which is narrow enough to stay replaceable without a seam to advertise it.

The decision is one statement: `INSERT … ON CONFLICT DO UPDATE … WHERE count < max`, returning the verdict in a single round trip, with expired rows deleted **opportunistically on that same write path**. A scheduled prune Job would make the limiter depend on the queue seam, so a deployment with a broken Worker would accrete dead rows in a hot table — and it would buy nothing, since those rows are already ignored by the `WHERE` clause that reads them.

## tRPC middleware, because `httpBatchLink` makes the HTTP request the wrong unit

All three clients use `httpBatchLink`, so one request to `/api/trpc/*` carries N procedure calls. A Hono-layer limiter counts a batch of twenty as one, and the only keys available there are an unverified header or an IP.

The price is that the limiter runs *after* `createContext` has done its `getSession`, so a flood still costs one session lookup per request. That is accepted: volumetric abuse belongs to the target's edge (API Gateway usage plans, Vercel's WAF), documented per target rather than implemented here. Building a second in-app limiter keyed on an IP this kit cannot reliably resolve would be paying complexity for a key we don't trust.

Each procedure declares an optional **cost** beside the permission it already declares — `orgProcedure({ member: ["invite"] }, { cost: 10 })`, defaulting to 1. One uniform limit can be priced for `projects.list` or for `members.invite`, which sends email through the Adapter seam, but not both. Named per-class buckets would isolate better; nothing has yet shown the shared budget to be wrong, so that waits for a workload that proves it.

Ceilings are fixed in code, with the bucket's `max` a plain column on the Organization defaulting to the code value. An operator raises one tenant with an UPDATE. **No billing lookup enters the request path** — [ADR-0017](./0017-polar-is-the-billing-provider.md) put Polar behind the seam precisely to keep plan state out of use cases, and a plan→limit mapping is what a fork writes when it has plans.

## The refusal is a payload, not a status code

tRPC 11's `getHTTPStatusCode` collects the status of every call in a batch and **returns 207 when they differ**. A batch of twenty where one call is limited responds `207 Multi-Status`: the 429 never appears as an HTTP status, and a `Retry-After` header on that response cannot say which call it describes.

So the Contract's refusal is a `TOO_MANY_REQUESTS` `TRPCError` carrying `retryAfter` seconds **in its error data**, and the clients read it from there. Better Auth's surface keeps its own `X-Retry-After` header, because it is not batched and [ADR-0009](./0009-better-auth-is-an-identity-store.md) leaves those routes opaque.

This generalises past rate limiting, and [#34](https://github.com/aniketmandloi/typesafe-saas-opus/issues/34) inherits it as a constraint: **on a batched contract, HTTP status is not a channel.** Any typed error whose meaning a client must act on carries that meaning in the payload.

## Better Auth keeps its rules and loses its store

Its `customStorage` is exactly `{ consume(key, rule) }`, so it takes the kit's store while keeping its own path matchers — `/sign-in*`, `/sign-up*`, `/change-password*`, `/change-email*` at 3 per 10s; password reset and verification email at 3 per 60s. Those encode auth knowledge the kit deliberately does not own, and `storage: "database"` would instead leave two limiters, two tables and two prune strategies. `enabled` is set explicitly to `true` rather than left to `NODE_ENV`.

**The limiter always runs, on every profile including local, and the ceiling is what varies** — the same reading [ADR-0018](./0018-telemetry-is-not-an-adapter.md) applies to instrumentation. A limiter that never executes in development is a limiter whose first execution is in production, which is the defect this ADR opens with.

## Trusted proxies are a property of the deployment

`getIPFromHeader` trusts a multi-hop `x-forwarded-for` only when `advanced.ipAddress.trustedProxies` is set. Otherwise a header with more than one value resolves to `null`, `getIP` falls back to the literal key `no-trusted-ip`, and the bucket — keyed `` `${ip}|${path}` `` — becomes **one shared bucket per path for the entire deployment**. Three sign-ins per ten seconds for everyone, announced by nothing but a logged warning.

[ADR-0003](./0003-no-server-actions-browser-proxied.md) makes this worse rather than better: browser traffic reaches the API through `apps/web`'s rewrite and the RSC client calls it server-to-server, so both arrive from the web deployment rather than from the user.

Trust is therefore a kit-owned **env fragment parsed at the Entrypoint** ([ADR-0006](./0006-entrypoints-parse-env-packages-never-do.md)), with each Deployment profile documenting its correct value, and it is handed to [#37](https://github.com/aniketmandloi/typesafe-saas-opus/issues/37) and [#39](https://github.com/aniketmandloi/typesafe-saas-opus/issues/39) as an inherited constraint. A profile that cannot produce a trustworthy client IP must say so loudly rather than silently sharing a bucket.

## Consequences

**A rate limit bucket is not an Audit entry and not tenant data Purge reaches.** [ADR-0008](./0008-audit-events-written-by-use-cases.md) has use cases write audit entries in the caller's transaction, and a refused call never reaches a use case — the same shape as a Dropped Job. The refusal is recorded as a span event carrying `organizationId` and `userId`, the two identifiers [ADR-0018](./0018-telemetry-is-not-an-adapter.md) permits, and nothing else.

The buckets themselves sit in our own Postgres, which makes them look like tenant data [ADR-0007](./0007-organization-soft-delete-and-purge.md) should sweep. **Purge does not reach them, and this is not a gap**: the grace window is thirty days and a bucket's life is seconds, so there is nothing left to destroy by the time Purge runs. Unlike the telemetry tension ADR-0018 recorded but did not resolve, this one resolves.

**The bucket table is a Drizzle table under [ADR-0012](./0012-migrations-are-a-deploy-step-under-their-own-profile.md)'s migration path**, like every other. Whether it should be `UNLOGGED` — skipping WAL for counters worthless after ten seconds — is unanswered: Neon's handling of unlogged relations across compute suspend has not been verified, and [#45](https://github.com/aniketmandloi/typesafe-saas-opus/issues/45) owns that question. The table is ordinary until that returns.

**Sign-in throttling changes behaviour on every existing deployment**, because it moves from a per-process memory map to a shared store. A deployment previously running three instances was permitting three times the documented limit.
