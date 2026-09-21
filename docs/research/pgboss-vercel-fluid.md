# Does pg-boss survive Vercel Fluid shared-process concurrency?

Research for [#30](https://github.com/aniketmandloi/typesafe-saas-opus/issues/30), feeding the topology decision in [#31](https://github.com/aniketmandloi/typesafe-saas-opus/issues/31).

Read against primary sources on 2026-09-22: Vercel's own docs, and pg-boss `12.33.3` — the npm tarball and the repo at `timgit/pg-boss@81d3a8d` (same version). Line references are to that commit's `src/`.

## Answer

**A long-lived `boss.start()` does not survive Fluid, and does not need to.** Concurrency is not the problem — pg-boss is ordinary async Node and Fluid runs many invocations in one process without touching that. The problem is that every pg-boss subsystem that matters is a **timer**, an instance is **suspended between requests and scaled to zero after five idle minutes**, and no timer is a request, so the passes those timers drive simply do not run.

What replaces it is not a hack: pg-boss 12 exposes the maintenance pass as a public method (`supervise()`), every recurring pass is rate-limited by a **server-side interval claim** shared across instances, and `send()`/`fetch()` through a supplied `db` adapter need no `start()` and no pg-boss-owned pool at all. So the viable Vercel shape is `supervise: false, schedule: false, migrate: false` plus a cron-triggered endpoint that drains and maintains. The cost is job latency floored at the cron period — **one minute on Pro, once a day on Hobby** — and one correctness obligation: **if nothing calls `supervise()`, jobs abandoned mid-handler are never reclaimed.**

## 1. What `start()` starts, and what a freeze or a kill costs

`PgBoss.#doStart()` ([`src/index.ts:156`](https://github.com/timgit/pg-boss/blob/master/src/index.ts)) starts subsystems behind four constructor flags, each defaulting to `true` except notify (`src/attorney.ts:503-507`):

| Flag | Default | What it starts |
| --- | --- | --- |
| `migrate` | `true` | `contractor.start()` — installs or migrates the schema under `pg_advisory_xact_lock()`; then `bam.start()` (async index builds), a `ClaimTimer` at `bamIntervalSeconds` (60) |
| `supervise` | `true` | `boss.start()` — a `ClaimTimer` at `superviseIntervalSeconds` (60); `navigator.start()` — flow resolution, an immediate `setImmediate` pass plus a `ClaimTimer` at `flowIntervalSeconds` (5) |
| `schedule` | `true` | `timekeeper.start()` — clock-skew caching, a cron `ClaimTimer` at `cronMonitorIntervalSeconds` (30), a polling worker at `cronWorkerIntervalSeconds` (5), and a skew re-check every `clockMonitorIntervalSeconds` (600) |
| `useListenNotify` | **`false`** | `notifier.start()` — one dedicated session-pinned connection holding `LISTEN` |

`manager.start()` always runs and adds two plain `setInterval`s: the queue-stats cache (`queueCacheIntervalSeconds`, 60) and a work-in-progress emitter (`src/manager.ts:849-850`).

The supervise pass is where the load-bearing work lives. `supervise()`'s own docs describe it as "monitoring (backlog warnings, expired and heartbeat-abandoned jobs, cached stats), deletion of jobs past their retention, warning and queue-stat pruning, and the index bloat check" ([`docs/api/ops.md`](https://github.com/timgit/pg-boss/blob/master/docs/api/ops.md)). Steps inside it are individually rate-limited: `monitorIntervalSeconds` (60), `maintenanceIntervalSeconds` (**1 day**), `reindexIntervalSeconds` (1 day) (`src/attorney.ts:747-819`, [`docs/api/constructor.md`](https://github.com/timgit/pg-boss/blob/master/docs/api/constructor.md)).

**Two facts decide the whole question.**

*First, no recurring pass runs at start.* `ClaimTimer.start()` arms a `setTimeout` for the full period and nothing else ([`src/claimTimer.ts`](https://github.com/timgit/pg-boss/blob/master/src/claimTimer.ts)); `Boss.start()` is that and only that (`src/boss.ts:178-189`). The first supervise pass is therefore 60 seconds after `start()`, the first cron pass 30 seconds after it. An invocation that starts a boss, does its work and returns inside a few seconds runs **no** maintenance and **no** cron evaluation, however many times it happens. Only the navigator's flow pass fires immediately (`src/navigator.ts:64`).

*Second, the intervals are claimed server-side, not held locally.* A pass is gated on "a conditional UPDATE that only goes through when the row it stamps is at least `seconds` old by the server's clock, so exactly one instance in a deployment runs the pass per interval" (`src/claimTimer.ts` doc comment). That is what makes many short-lived instances safe rather than a thundering herd: `supervise()`'s docs state the limits "are shared across instances, so calling `supervise()` in a loop does not run everything on every call".

What breaks when the process is frozen or killed:

- **Frozen between invocations** — timers do not fire, so the passes are late rather than lost; the interval claim then lets whichever instance is awake take the pass. Damage is latency, not corruption. What genuinely dies is anything the instance was mid-way through: Fluid logs an uncaught error and "lets current requests finish before stopping the process" ([Fluid compute](https://vercel.com/docs/fluid-compute)), and a `work()` handler running outside any request is not a current request.
- **Killed mid-handler** — the job stays `active` until `expireInSeconds` (default **15 minutes**) or a stale `heartbeatSeconds` is noticed, and either way it is **a monitor pass that notices**: "Actual detection time is `heartbeatSeconds` + up to `monitorIntervalSeconds` (default 60s), since the monitor must run to observe a stale heartbeat" ([`docs/api/queues.md`](https://github.com/timgit/pg-boss/blob/master/docs/api/queues.md)). With nothing running supervise, an abandoned job is stuck `active` forever. **This is the correctness item, and it is invisible until a handler is killed.**
- **`useListenNotify`** is unusable here regardless: it "holds one dedicated database connection open for listening" and needs a session-pinned connection (`docs/api/constructor.md`). It is off by default, so this costs nothing as long as nobody turns it on. Without it, worker latency is `pollingIntervalSeconds` (default 2s, floor 500ms) ([`docs/api/workers.md`](https://github.com/timgit/pg-boss/blob/master/docs/api/workers.md)).

## 2. Is a per-invocation boss viable?

Yes, and cheaper than expected, with one required piece of wiring.

**Enqueue needs no `start()` and no pg-boss pool.** The `db` constructor option lets you "bring your own database connection"; anything implementing `executeSql` qualifies, and pg-boss ships a Drizzle adapter (`fromDrizzle`) (`docs/api/constructor.md`, [`docs/api/adapters.md`](https://github.com/timgit/pg-boss/blob/master/docs/api/adapters.md)). The only `opened` guard in the data path is `Manager.assertDb`, which checks it **solely for pg-boss's own pool** (`if (this.db._pgbdb)`, `src/manager.ts:2548-2556`). With a supplied adapter, `send()`, `insert()` and `fetch()` are plain SQL over the caller's connection — which also means a boss on Vercel can share the app's existing pool rather than opening a second one.

**`start()` itself is two queries when `migrate: false`.** `Contractor.check()` is `isInstalled()` plus `schemaVersion()`, throwing if either is wrong (`src/contractor.ts:271-283`). Leaving `migrate: true` in a per-invocation boss is the thing to avoid: it puts a schema check — and, on a version bump, a migration under an advisory lock — on the hot path of every cold start.

**The maintenance work is a public method.** `supervise(name?, options?)` "runs one maintenance pass immediately instead of waiting for the next background cycle… Call it directly when you have set `supervise: false` and drive maintenance yourself" (`docs/api/ops.md`). Because the inner steps hold their own shared interval claims, calling it every cron tick is safe and mostly cheap: the once-a-day steps (`maintenanceIntervalSeconds`, `reindexIntervalSeconds`) refuse the claim on all but one call a day.

**What has no public equivalent is the cron pass.** Scheduling is a `schedule: false` / `schedule: true` switch with no "run one cron evaluation now" method; `previewSchedule()` only reads. A schedule evaluated only while some instance happens to be running passes will miss occurrences: "A pass sends the occurrences of the preceding 60 seconds, so an occurrence that came due while no instance was running a pass is not sent at all" ([`docs/api/scheduling.md`](https://github.com/timgit/pg-boss/blob/master/docs/api/scheduling.md)). The mitigation is per-schedule `missed: 'once'`, which sends one job for the most recent missed occurrence, however many were missed — explicitly not one per occurrence. Under a drain endpoint whose instances live seconds, `missed: 'once'` is not a nicety; it is the only thing that makes a pg-boss schedule fire at all, and it degrades every schedule to "at least once per cron tick, coalesced".

Also available and worth knowing about for #31: [`@pg-boss/proxy`](https://github.com/timgit/pg-boss/blob/master/docs/proxy.md), a first-party HTTP proxy "exposing pg-boss methods over a simple JSON API… useful for platform compatibility (calling pg-boss from non-Node runtimes or serverless functions) and for connection pooling". It runs `schedule: false` by default, so it is a connection-pooling front end, not a worker.

## 3. What Vercel documents about lifetime, freezing and background work

- **One process, many invocations.** "Instead of using a microVM for each function invocation, multiple invocations can share the same physical instance (a global state/process) concurrently" ([Fluid compute](https://vercel.com/docs/fluid-compute)). Errors are isolated: an uncaught exception is logged and Fluid "lets current requests finish before stopping the process".
- **Instances are suspended between requests.** The docs say this most plainly in the API reference for `attachDatabasePool`, which exists to "ensure that idle pool clients are properly released **before functions suspend**" ([@vercel/functions reference](https://vercel.com/docs/functions/functions-api-reference/vercel-functions-package)). Billing agrees: "Active CPU… Billing pauses while your code waits on external services… you pay nothing between requests" ([What is Compute?](https://vercel.com/docs/fundamentals/what-is-compute)).
- **Idle instances go away.** "Functions that receive no traffic for five minutes in production (30 seconds in preview) scale down automatically", and container-based functions "are stateless. Each instance takes a request, returns a response, and keeps nothing between calls. That's what lets Vercel add instances when traffic arrives and scale to zero when it stops" ([Does Vercel support Docker deployments?](https://vercel.com/kb/guide/does-vercel-support-docker-deployments)). **There is no always-on worker shape on Vercel, container images included.** Deploying a container does not buy a resident process.
- **`waitUntil` extends a request, it does not outlive one.** It "extends the lifetime of the request handler for the lifetime of the given Promise… Promises passed to `waitUntil()` will have the same timeout as the function itself. If the function times out, the promises will be cancelled." `getDeadline()` returns the shared invocation deadline, "includ[ing] request processing and asynchronous `waitUntil` tasks" — useful for a drain loop that must stop itself before the platform does.
- **Duration** (Fluid, Node.js): Hobby 300 s default **and** maximum; Pro/Enterprise 300 s default, **800 s** maximum GA, **1800 s** extended maximum in beta and only configurable per function ([Functions limits](https://vercel.com/docs/functions/limitations)). Secure Compute and Static IPs do not support above 800 s during the beta.
- Other limits that bear on a drain endpoint: 4.5 MB request/response body, 1,024 file descriptors shared across concurrent executions, 2 GB memory on Hobby.

## 4. Can Vercel Cron stand in for a drain loop?

It can, within a hard latency floor, and it is best-effort delivery rather than a guarantee.

| Plan | Cron jobs/project | Minimum interval | Scheduling precision |
| --- | --- | --- | --- |
| Hobby | 100 | **Once per day** | Per-hour (±59 min) |
| Pro | 100 | Once per minute | Per-minute |
| Enterprise | 100 | Once per minute | Per-minute |

([Cron usage & pricing](https://vercel.com/docs/cron-jobs/usage-and-pricing).) On Hobby a more frequent expression **fails at deploy**: "Hobby accounts are limited to daily cron jobs. This cron expression would run more than once per day." Timezone is always UTC and `MON`/`JAN`-style expressions are unsupported ([Cron jobs](https://vercel.com/docs/cron-jobs)).

So the job-latency floor is:

- **Hobby: ~24 h, ±59 minutes.** Not background processing in any useful sense.
- **Pro/Enterprise: 60 s**, plus whatever the drain itself takes. Within one invocation a worker can of course drain continuously — `maxDuration` 800 s, or 1800 s in beta — so the floor is *time-to-first-attempt*, not throughput.

Four properties of Vercel Cron shape the endpoint ([Managing cron jobs](https://vercel.com/docs/cron-jobs/manage-cron-jobs)):

- **Delivery is best effort.** "Most invocations run as scheduled, but occasional transient network errors can prevent a request from reaching your function… Cron delivery can also occasionally invoke the same scheduled run more than once." Missed *and* duplicated.
- **No retries.** "Vercel will not retry an invocation if a cron job fails."
- **No concurrency control.** A run that overruns its interval gets a second one on top of it; Vercel's advice is an external lock. pg-boss already answers this: job claims are atomic and the maintenance passes hold interval claims, so overlap wastes a round trip rather than double-processing.
- **Auth is a bearer token** from `CRON_SECRET`, and crons hit only the **production** deployment URL over GET, do not follow redirects, and are not triggered by `vercel dev`.

The catch-up story therefore has two independent layers, and both need setting: Vercel's (missed cron invocation, unrecoverable, next tick catches up) and pg-boss's (`missed: 'once'` per schedule, see §2).

## Implications for decisions already recorded

**ADR-0015's Vercel paragraph is still right, and two of its numbers should be refreshed.** "Fluid compute allows a cron-triggered bounded drain endpoint (300 s, 800 s on Pro)" — 300 s is now the *default on every plan* and also Hobby's maximum; Pro's GA maximum is 800 s with a 1800 s beta above it. The Hobby cron claim ("once a day, ±59 minutes of jitter, more frequent expressions fail at deploy") is verbatim correct as of today. So is "Vercel has no worker process": containers run as request-triggered functions that scale to zero, so nothing on the platform changes that conclusion.

**One thing ADR-0015 implies is now avoidable.** "pg-boss's schedules would have to migrate into `vercel.json`, breaking the single-declaration rule" — this is only forced if the deployment has no pg-boss cron pass at all. With `schedule: false` plus `missed: 'once'` on each schedule, pg-boss's own schedule table stays the single declaration and the Vercel cron entry is one drain endpoint rather than one entry per schedule. The cost is that a schedule fires with up-to-one-cron-period lateness and coalesces its misses, which is exactly the "documented degraded mode" the ADR already describes — but the *declaration* need not move.

**A new obligation the ADR does not state:** on Vercel the drain endpoint must call `supervise()`, not merely `fetch()`/`work()`. Expiry, heartbeat reclamation and retention deletion are all inside that pass, and with `supervise: false` and instances that live seconds, nothing else will ever run it. A drain endpoint that only pulls jobs looks healthy and quietly leaks `active` rows.

**Out of scope here but relevant to #31 and to the seam:** [Vercel Queues](https://vercel.com/docs/queues) is now in public beta — durable topics, at-least-once delivery, push consumers wired through `experimentalTriggers` in `vercel.json`, and a poll mode. It is the platform-native answer to "Vercel has no worker process" and it is *not* in the seam: ADR-0015 scopes the seam to pg-boss and SQS, and adding it would be a third driver whose consumers are declared in `vercel.json` (the same single-declaration tension as above). Worth naming in #31 so the option is rejected on purpose rather than by omission. Note also that ADR-0015 read BullMQ's Postgres backend as "seven weeks old"; pg-boss itself is now at 12.33.3 with a v12 line that is a TypeScript rewrite, so the pg-boss side of that comparison has moved too.

## Sources

Vercel (all fetched 2026-09-22):

- https://vercel.com/docs/fluid-compute (page dated 2026-08-24)
- https://vercel.com/docs/fundamentals/what-is-compute (2026-08-11)
- https://vercel.com/docs/functions/limitations (2026-08-24)
- https://vercel.com/docs/functions/functions-api-reference/vercel-functions-package (2026-09-03)
- https://vercel.com/docs/functions/concurrency-scaling (2026-08-11)
- https://vercel.com/docs/cron-jobs (2026-09-16)
- https://vercel.com/docs/cron-jobs/usage-and-pricing (2026-07-15)
- https://vercel.com/docs/cron-jobs/manage-cron-jobs (2026-08-11)
- https://vercel.com/docs/queues (2026-09-03)
- https://vercel.com/kb/guide/does-vercel-support-docker-deployments

pg-boss 12.33.3 (npm tarball; repo `timgit/pg-boss@81d3a8d`, 2026-09-21):

- `src/index.ts`, `src/attorney.ts`, `src/boss.ts`, `src/claimTimer.ts`, `src/contractor.ts`, `src/manager.ts`, `src/navigator.ts`, `src/timekeeper.ts`
- `docs/api/constructor.md`, `docs/api/ops.md`, `docs/api/queues.md`, `docs/api/scheduling.md`, `docs/api/workers.md`, `docs/api/adapters.md`, `docs/proxy.md`, `docs/introduction.md`
