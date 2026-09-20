# Cloudflare Workers is not a deployment target

The kit supports containers, AWS Lambda and Vercel. Cloudflare Workers is out, and the kit does not pay its constraints. Hono stays regardless — a Fetch-native framework is the natural fit for tRPC's Fetch adapter, and the HTTP layer is thin enough that switching would buy nothing.

This is recorded because it is genuinely surprising from the inside: the server is built on the framework most associated with Workers, and a reader will reasonably assume Workers was intended and then broke.

## Considered options

Workers was in the stack implicitly, arriving with the Hono choice rather than by decision. Priced explicitly (2026-09-20), keeping it would have meant:

- **Owning password hashing.** Better Auth has no first-party Workers guide, and its default pure-JS scrypt exceeds the Workers CPU limit on email/password sign-up. The documented workaround is supplying custom hash and verify functions. Security-critical code written to keep one deployment target alive.
- **A third queue driver.** Workers has no long-lived process and pg-boss's listener holds a persistent database connection, so the two are structurally incompatible. Workers would need Cloudflare Queues behind the job seam, which is scoped to pg-boss and SQS.
- **Hyperdrive**, a Cloudflare-specific piece of infrastructure, in a kit whose reference deployment is AWS.
- **A 10 MB compressed bundle ceiling** the other targets do not have, and a fourth OpenTelemetry registration shape.

Against that, the benefit was never identified: no cloner in the kit's audience — self-serve B2B SaaS, micro through mid-market — needs edge placement. A tenant-scoped request spends its budget on a Postgres round-trip in one region, so moving compute to the edge relocates latency rather than removing it.

The tiebreaker that originally justified Hono over Fastify has also weakened independently: Cloudflare now documents Express on Workers via its Node HTTP shim, so "only a Fetch-native framework reaches Workers" is no longer strictly true.

## Consequences

`apps/server` has three entrypoints, not four, and wrangler leaves the set of bundlers that must swallow the workspace's raw TypeScript.

The two constraints Workers imposed on *all* code are restated rather than dropped, because Lambda and Vercel impose weaker versions of both:

- **Filesystem**: `/tmp` is the only writable path and nothing may persist between requests. The justification changes from "there is no disk" to "the disk is per-invocation scratch" — and the second half is the dangerous one, since code that works on a container silently breaks on Lambda under scale-out.
- **Native modules**: permitted in adapters and server-only packages, never in `universal` ones, and built for linux-x64 and linux-arm64. The carve-out protects Metro and the mobile app, not any deployment target.

Re-adding Workers later is a fresh effort, not a resumption: it would reopen password hashing, the job seam and the bundle budget together.
