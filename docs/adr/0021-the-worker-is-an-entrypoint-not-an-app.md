# The worker is an Entrypoint, not an app

Background work runs as a **second Entrypoint of `apps/server`** — same deployment profile, same composed env schema, same adapters, draining instead of serving. What varies per target is the artifact and who fires the daily sweep, never the composition.

[ADR-0012](./0012-migrations-are-a-deploy-step-under-their-own-profile.md) already named the two independent axes: the migrator is *different entrypoint, different profile*; the worker is **different entrypoint, same profile**. A worker needing a different profile would mean the queue driver was not really an Adapter.

`createRuntime` therefore splits. A shared core builds `db`, `auth`, `adapters` and `deps`; `app` and `handlers` are built on top of it by whichever Entrypoint needs them. Without the split the two artifacts are separated only by which imports happen not to be reached, which is not a boundary.

## Per target

| Target | Worker | Daily sweep trigger |
| --- | --- | --- |
| Container | `entrypoints/worker.ts` draining pg-boss, its own concurrency constant, `SIGTERM` → graceful `stop()` | pg-boss's schedule table, `missed: 'once'` |
| AWS | One SQS queue, one `SQSHandler` shim dispatching on job name and returning `batchItemFailures`; pool `max: 1` | EventBridge Scheduler → the worker Lambda |
| Vercel | A **second function**, `worker.func`, own bundle, owns the `/internal/jobs/*` routes; drains **and** calls `supervise()` | Two `vercel.json` crons — per-minute drain, daily sweep-enqueue |
| Local | A real second process against pg-boss on the dev Postgres, started beside the server | pg-boss's schedule table |

AWS takes one queue and one Lambda rather than one per job name. `jobPayloads` has three entries, and moving to per-job queues later is a routing decision at enqueue plus Terraform — not a change to anything this ADR fixes.

Concurrency is a **container-only constant held by that Entrypoint**, not a field on `TargetConfig`. On Lambda it is the event-source mapping's batch size and reserved concurrency; on Vercel it is bounded by the function deadline. A field two of three Entrypoints must supply a meaningless value for is a field that lies — and `TargetConfig` justifies `pool` precisely by how differently each target is *invoked*, which is the reasoning that excludes this.

## Vercel is supported and degraded, on purpose

Pro's latency floor is the 60s cron period. **Hobby has no background processing at all**: its crons fire once a day with ±59 minutes of jitter and more frequent expressions fail at deploy. That is a documented degraded mode, not a supported one, and [ADR-0007](./0007-organization-soft-delete-and-purge.md)'s 30-day grace window was already made indifferent to exactly this jitter.

The drain endpoint **must call `supervise()`**, not merely `fetch()`/`work()`. Expiry, heartbeat reclamation and retention deletion all live in that pass, so a drain-only endpoint looks healthy while quietly leaking `active` rows.

**Vercel Queues is rejected rather than overlooked.** Its push-consumer topic model, wired through `experimentalTriggers`, is not the seam's shape — the seam's unit is a job a driver hands to a handler, not a subscription the platform delivers to a route. It is also in beta, and a fork-and-go kit inherits its defaults into every cloned project, which is the wrong place for that bet.

## Why Vercel gets a second function

[#14](https://github.com/aniketmandloi/typesafe-saas-opus/issues/14) promised the worker is the only Entrypoint reaching the native module, so the HTTP bundles stay free of it. That held only while Vercel had one function: mounting the drain route on `api.func` puts every handler dependency into the bundle that serves requests. A second function restores the property on all three targets, and gives the drain cron and the HTTP surface independent scaling and independent failure.

It does **not** make `sharp` run on Vercel. A Build Output API function ships `index.js` and a `package.json`, so an `external` native dependency has no `node_modules` to resolve against. That is [#38](https://github.com/aniketmandloi/typesafe-saas-opus/issues/38)'s problem to decide, and naming it here is what stops it being mistaken for an oversight.

## Nothing new enters the seam

**No dedupe key.** Vercel cron is best effort, can invoke the same run twice and offers no overlap control. Overlapping drains are harmless — pg-boss claims atomically — but a double-fired sweep enqueues two purge jobs per due Organization. pg-boss has `singletonKey`; SQS standard queues have no deduplication and FIFO's window is five minutes. An option one driver has, one cannot honour and the fake must pretend at is the shaping-around-one-driver [ADR-0015](./0015-background-jobs-are-a-queue-seam.md) refuses. So **handler idempotency is an obligation of every handler**, stated rather than left as a property that happens to hold.

## A dark Organization's jobs are dropped, not failed

`TenantDb` construction throws a distinct error type; the worker's runner treats **that error** as drop-and-complete and everything else as failure. Left alone, a job for a dark Organization throws, retries and reaches a dead-letter queue for behaving correctly.

The rule keys off "the handler could not open a tenant", never "the Organization is dark". Inverting it would stop `organization.purge` running at all — purge is the one job that must run *against* a dark Organization.

A drop is recorded as an attribute on the Process span [ADR-0020](./0020-trace-context-rides-the-job-envelope.md) already creates, plus a log line, and is **never an Audit entry**. [ADR-0008](./0008-audit-events-written-by-use-cases.md) has audit entries written by use cases, and a drop is the absence of one; auditing it would also write a row for a tenant that darkness exists to put out of reach.

## Consequences

**pg-boss's schema is a migration.** `migrate: false` on every target, installed by `entrypoints/migrate.ts` beside Drizzle's, so a pg-boss version bump is a migration like any other. Leaving it true puts a schema check on every cold start and, on a version bump, a locked migration — on Vercel, one running inside a cron invocation. If pg-boss exposes no install-only call, this is `start({ supervise: false, schedule: false })` followed by `stop()`: an install-only invocation that reads like ceremony and is not.

**The fake queue is no longer something a Deployment profile composes.** It is what a *test* constructs, which is how `FakeQueue.drain(handlers)` was always written. The `local` profile's queue is pg-boss on the dev Postgres, so `pnpm dev` runs the driver a cloner actually ships with, and [ADR-0010](./0010-dev-runs-raw-source-on-bare-node.md)'s bare-Node worker constraint means something.

This closed a live hole rather than merely tidying: the profile wired an in-memory queue that by design does not drain itself, nothing called `drain`, and a second `node --watch` process could not have seen the first's memory — so **on a clean checkout the invite email was enqueued and never sent**. The fake's stated justification, that a clean checkout could run the slice with no Postgres, was never true either: `databaseFragment` makes `DATABASE_URL` required.

**Job handler implementations stay in `apps/server`**, `organization.purge`'s full orchestration included. [ADR-0007](./0007-organization-soft-delete-and-purge.md)'s two halves therefore live apart — the deletion request in `@repo/api` beside the org router, the purge in the app beside its handler. The cost is that purge is callable from nowhere but a job, which for purge is the point; the gain is that a use case which never touches the Contract stays out of the package named for it.

**The daily sweep's schedule is declared once per target** — pg-boss's schedule table, EventBridge, two `vercel.json` crons. [ADR-0015](./0015-background-jobs-are-a-queue-seam.md) already put cron outside the interface as a deploy-time declaration, so what repeats is the *schedule*; the Job is declared once in `@repo/jobs`.
