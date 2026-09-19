# Background jobs: Postgres queue vs SQS vs hosted

Research for [#6](https://github.com/aniketmandloi/typesafe-saas-opus/issues/6). All facts verified against
primary sources on **2026-09-19**; every substantive claim carries its URL. Where a claim could not be
verified from a first-party source it says so.

## Answer in one paragraph

Ship **pg-boss** behind a thin kit-owned seam (`defineJob` + `enqueue` + a per-target worker entrypoint),
with **AWS SQS + Lambda** as a second driver for the Terraform reference deployment. Do **not** put
Inngest or Trigger.dev behind that seam. The queue choice does *not* leak into how handlers are written
— control inversion is a wiring problem, solved the same way the kit already solves it for Hono — but
**durable multi-step execution does** leak, and that is the real fault line. Inngest and Trigger.dev are
not queues; their unit of work is a checkpointed, resumable run, and reducing them to
`(payload) => Promise<void>` throws away the entire reason to pay for them.

---

## 1. Candidates

### Maintenance status

All six are actively maintained. Checked via the GitHub and npm APIs on 2026-09-19.

| Project | Latest version | Last publish | Repo pushed | Stars | Open issues | License |
|---|---|---|---|---|---|---|
| pg-boss | 12.33.2 | 2026-09-18 | 2026-09-19 | 3,962 | 20 | MIT |
| graphile-worker | 0.18.0 | 2026-09-08 | 2026-09-13 | 2,397 | 30 | MIT |
| bullmq | 6.3.8 | 2026-09-18 | 2026-09-19 | 9,416 | 386 | MIT |
| inngest (JS SDK) | 4.20.0 | 2026-09-04 | 2026-09-17 | 1,007 | 134 | GPL-3.0 |
| inngest/inngest (server) | — | — | 2026-09-19 | 5,851 | 237 | **SSPL-1.0** |
| @trigger.dev/sdk | 4.6.3 | 2026-09-17 | 2026-09-19 | 16,342 | 335 | Apache-2.0 |

Two things worth flagging. pg-boss's very low open-issue count (20) against 4k stars is a healthy signal.
BullMQ's 386 open issues is normal for a project of its breadth, not a red flag, but it is the widest
surface area of the six.

### The headline finding: BullMQ v6 has a PostgreSQL backend

Released **2026-07-30**, BullMQ v6 replaced its Redis-only core with a datastore-agnostic
`IQueueBackend` abstraction and ships **Redis and PostgreSQL backends in-core**
([changelog](https://docs.bullmq.io/changelog), [PostgreSQL backend guide](https://docs.bullmq.io/guide/postgresql)).
Corroborated independently: `pg` is an optional peer dependency of `bullmq@6.3.8`
(`npm view bullmq peerDependenciesMeta`), and the repo carries dedicated `vitest.postgres.config.ts`
and `vitest.adapter-conformance.config.ts` suites.

```ts
import { Queue, Worker, createPostgresBackend } from 'bullmq';
const opts = { connection: 'postgres://user:pass@localhost:5432/mydb' };
const queue  = new Queue('my-queue', opts, createPostgresBackend);
const worker = new Worker('my-queue', async job => { /* identical to Redis */ },
                          opts, createPostgresBackend);
```

The docs claim full parity — "queues, workers, flows, job schedulers, rate limiting, prioritization,
delayed jobs, deduplication, metrics and events — so your application code is identical across backends."
Requires Postgres 13+ (14+ recommended); blocking dequeue is implemented with `LISTEN`/`NOTIFY` plus one
dedicated long-lived connection per backend; migrations are explicit and idempotent via `runMigrations()`
under a transaction-scoped advisory lock. Vendor's own indicative benchmarks (their laptop, no-op jobs,
explicitly "not a formal benchmark"): processing ~2,300 jobs/s at concurrency 1 and ~11,000 jobs/s at
concurrency 8–32, versus ~6,000 and ~18,000 on Redis — roughly 1.5–2× slower.
([postgresql.md](https://github.com/taskforcesh/bullmq/blob/master/docs/gitbook/guide/postgresql.md))

This matters because it removes the main reason the kit would have wanted a Postgres-vs-Redis adapter at
all: BullMQ's vendor already built that seam, and conformance-tests it. The caveat is age — the Postgres
backend is ~7 weeks old in production.

### Per-candidate detail

#### pg-boss 12.x

- **Typing.** Generics on the public API — `Job<T = object>`, `JobInsert<T = object>`,
  `WorkHandler<ReqData, ResData>` ([src/types.ts](https://github.com/timgit/pg-boss/blob/master/src/types.ts)).
  Per-call-site, with no central name→payload registry: nothing stops `send<A>('q', …)` pairing with
  `work<B>('q', …)`.
- **Cron.** `schedule(name, cron, data, options)` with cron **or** RRULE expressions, a validated `tz`
  option (unrecognised zones are rejected at `schedule()` time), `unschedule`, `getSchedules`, and a
  catch-up-after-outage policy. Instance clocks are compared to the database clock every 10 minutes and
  the skew applied as an offset so instances agree. Schedules are evaluated every 30s
  (`cronMonitorIntervalSeconds`) and **require at least one running instance**.
  ([scheduling.md](https://github.com/timgit/pg-boss/blob/master/docs/api/scheduling.md))
- **Retries.** `retryLimit` (default 2), `retryDelay` (default 0), `retryBackoff` (default false →
  `retryDelay * 2 ^ retryCount` with jitter, initial delay forced to 1s), `retryDelayMax`. Inheritable
  from queue-level defaults. ([jobs.md](https://github.com/timgit/pg-boss/blob/master/docs/api/jobs.md))
- **Dead letter.** First-class: `deadLetter` option names a target queue, and `redrive(name, options)`
  re-creates jobs on their original source queue with reset retry counts.
- **Concurrency / throttling.** `batchSize`, `pollingIntervalSeconds` (default 2), plus
  `singletonKey` / `singletonSeconds` / `singletonNextSlot` for throttle-and-debounce semantics.
  `expireInSeconds` (default 15 min, max 24 h) and `heartbeatSeconds` bound an active job.
- **Observability.** Official MIT dashboard package **`@pg-boss/dashboard`** (v1.8.0, published
  2026-09-10) with queue/job/schedule browsing, payload inspection, retry/cancel/delete actions and
  warning history. ([dashboard.md](https://github.com/timgit/pg-boss/blob/master/docs/dashboard.md))
- **Other backends.** A `backend` option supports CockroachDB, YugabyteDB, Citus and PGlite. Aurora DSQL
  and Spanner are explicitly *not* supported.
  ([database-backends.md](https://github.com/timgit/pg-boss/blob/master/docs/database-backends.md))
- **Serverless escape hatches.** `supervise: false, schedule: false` gives a pure enqueue-only client with
  no background timers — exactly what a Lambda/Vercel API route wants. `fetch()` / `complete()` / `fail()`
  are a public manual API, so a cron-driven function can drain without `work()`.
  ([constructor.md](https://github.com/timgit/pg-boss/blob/master/docs/api/constructor.md))

#### Graphile Worker 0.18

- **Typing — the strongest built-in story of the six.** A global interface augmentation gives a real
  central registry:
  ```ts
  declare global {
    namespace GraphileWorker {
      interface Tasks { myTaskIdentifier: { details: 'are'; specified: 'here' } }
    }
  }
  const task: Task<'myTaskIdentifier'> = async (payload, helpers) => { /* payload inferred */ };
  ```
  `addJob` gains autocomplete and payload checking from the same map the task reads. The docs are candid
  about the hole: jobs can be inserted by `graphile_worker.add_job()` straight from SQL, and "these APIs
  cannot check that the payloads added conform to your TypeScript types", so they recommend assertion
  functions for runtime validation. Outside the registry, payloads are typed `unknown` deliberately.
  ([typescript](https://worker.graphile.org/docs/typescript),
  [add-job](https://worker.graphile.org/docs/library/add-job))
- **Cron.** Crontab-style file or `crontab` / `crontabFile` / `parsedCronItems` options. **UTC only** —
  "We only handle timestamps in UTC." A `fill=t` option backfills missed entries from the last period `t`
  if the worker was down. ([cron](https://worker.graphile.org/docs/cron))
- **Retries.** `maxAttempts` default **25**. Backoff is the fixed formula `exp(least(10, attempt))`
  seconds; the docs page does not document a way to configure it.
  ([exponential-backoff](https://worker.graphile.org/docs/exponential-backoff))
- **Dead letter.** None. Jobs that exhaust `maxAttempts` stay as permanently-failed rows; you build your
  own sweep on top of the admin functions.
- **Concurrency.** `concurrentJobs` (default 1), `pollInterval` (default 2000 ms), `maxPoolSize`
  (default 10, "at least 2"). ([config](https://worker.graphile.org/docs/config))
- **Observability.** No official dashboard. Administrative SQL/JS functions and a `jobs` view are
  provided; a UI is yours to build. Worker Pro (`@graphile-pro/worker`) is a proprietary preset.
- **Serverless escape hatch — the cleanest of any candidate.** `runOnce()` is documented as "the function
  will run until there are no runnable jobs left, and then resolve". That is purpose-built for a
  cron-invoked function. ([library/run](https://worker.graphile.org/docs/library/run))

#### BullMQ 6.x (+ Redis or Postgres)

- **Typing.** `Queue<DataTypeOrJob = any, DefaultResultType = any, DefaultNameType extends string = string>`
  and `Worker<DataType = any, ResultType = any, NameType extends string = string, …>`
  ([queue.ts](https://github.com/taskforcesh/bullmq/blob/master/src/classes/queue.ts),
  [worker.ts](https://github.com/taskforcesh/bullmq/blob/master/src/classes/worker.ts)).
  Defaults are `any`, so an unannotated `new Queue('emails')` is entirely untyped. Like pg-boss: generics
  are per-call-site, no central registry.
- **Cron.** Job Schedulers via `upsertJobScheduler`, with `{ every: ms }` or `{ pattern: '0 15 3 * * *' }`
  and a `tz` option. Legacy repeatable jobs were removed in v6. New jobs are only generated when the
  previous one *starts processing*, so heavy load makes schedulers fire less often than configured —
  a real caveat for "every minute" work. ([job-schedulers](https://docs.bullmq.io/guide/job-schedulers))
- **Retries / DLQ.** Attempts + backoff strategies per job; failed jobs land in a `failed` set rather than
  a separate dead-letter queue. Stalled jobs (expired lock) return to `waiting`, or to `failed` once
  `maxStalledCount` (default 1) is exhausted. ([workers](https://docs.bullmq.io/guide/workers))
- **Concurrency / rate limiting.** Worker `concurrency`, plus `limiter: { max, duration }` which is
  **global across workers for a queue** — "if you have for example 10 workers for one queue with the above
  settings, still only 10 jobs will be processed by second". Group rate limiting is BullMQ Pro only.
  ([rate-limiting](https://docs.bullmq.io/guide/rate-limiting))
- **Observability.** `bullmq-otel` (v2.0.1, MIT) for OpenTelemetry, declared as an optional peer dep; and
  the third-party `@bull-board/api` (v9.10.1, MIT) dashboard.
- **Redis constraints.** Worker and QueueEvents need blocking commands and therefore duplicate
  connections; with ioredis, `maxRetriesPerRequest` **must** be `null`. Every class consumes at least one
  connection. ([connections](https://docs.bullmq.io/guide/connections)) This is why REST-only serverless
  Redis offerings do not work with BullMQ — it needs a real TCP client.
- **Manual mode.** `new Worker('q')` with no processor plus `getNextJob(token)` /
  `job.moveToCompleted|moveToFailed` works, but locks are **not auto-renewed** in manual mode; you must
  finish inside `lockDuration` (default 30 s) or call `job.extendLock()`, and start
  `worker.startStalledCheckTimer()` yourself.
  ([manually-fetching-jobs](https://github.com/taskforcesh/bullmq/blob/master/docs/gitbook/patterns/manually-fetching-jobs.md))

#### AWS SQS + Lambda

- **Typing.** None. The wire format is a string body; `event.Records[]` is typed only by
  `@types/aws-lambda` as `SQSEvent`. All payload typing must be supplied by the kit.
- **Cron.** SQS has none. You need **EventBridge Scheduler**, which is separate infrastructure declared in
  Terraform, not a runtime `schedule()` call.
- **Retries / DLQ.** Redrive policy with `maxReceiveCount` moves messages to a DLQ, which must be a
  separate queue in the same account and Region and must match the source queue's type. DLQ redrive moves
  messages back. Note the retention subtlety: for standard queues the enqueue timestamp is *not* reset on
  move, so a DLQ's retention should be set longer than the source's.
  ([sqs-dead-letter-queues](https://docs.aws.amazon.com/AWSSimpleQueueService/latest/SQSDeveloperGuide/sqs-dead-letter-queues.html))
- **Concurrency.** Event source mapping `MaximumConcurrency`, or provisioned mode with
  `MinimumPollers` (2–200, default 2) and `MaximumPollers` (2–10,000, default 200); provisioned mode
  cannot be combined with the maximum-concurrency setting. Batch size up to 10 by default with a batching
  window up to 5 minutes. Partial failures need `ReportBatchItemFailures`, otherwise a single failure
  redelivers the whole batch. Delivery is explicitly at-least-once — "make your function code idempotent".
  ([with-sqs](https://docs.aws.amazon.com/lambda/latest/dg/with-sqs.html))
- **Quotas (verified, and different from what is widely repeated).** Max message size is
  **1,048,576 bytes (1 MiB)**, not 256 KB. Retention default 4 days, min 60 s, max 14 days. Visibility
  timeout default 30 s, max 12 hours. Message timer (delay) max **15 minutes** — this is the one hard
  quota that a portable `runAt` cannot honour. Max 10 messages per batch, 10 message attributes.
  ([quotas-messages](https://docs.aws.amazon.com/AWSSimpleQueueService/latest/SQSDeveloperGuide/quotas-messages.html))
- **Lambda quotas.** Function timeout **900 s (15 min)**; 5,400 s (90 min) for Lambda Managed Instances on
  async or event-source-mapping invocations. Concurrent executions default 1,000.
  ([gettingstarted-limits](https://docs.aws.amazon.com/lambda/latest/dg/gettingstarted-limits.html))
- **Observability.** CloudWatch metrics/logs and X-Ray. No job-level UI; `ApproximateAgeOfOldestMessage`
  and DLQ depth alarms are the idiom.

#### Inngest

- **Typing — best of the six, and it changed recently.** SDK v4 **removed the centralized `EventSchemas`
  class** in favour of a decentralized `eventType()` helper defined next to the function:
  ```ts
  const userCreated = eventType('user/created', {
    schema: z.object({ userId: z.string(), email: z.string() }),
  });
  ```
  One definition types the function trigger, `inngest.send()` and `step.waitForEvent()`, with runtime
  validation via any Standard Schema library, or `staticSchema<T>()` for types only.
  ([v3-to-v4 migration](https://www.inngest.com/docs/reference/typescript/v4/migrations/v3-to-v4))
  *Anything written against v3's `EventSchemas` in older notes or training data is out of date.*
- **Execution model — the crux.** Inngest's cloud invokes *your* HTTP endpoint. "Each step in your
  function is executed as a separate HTTP request"; the function re-enters from the top each time and
  completed steps are memoized, their stored results injected. Requests up to 4 MB.
  ([how-functions-are-executed](https://www.inngest.com/docs/learn/how-functions-are-executed))
  So your code runs on your infrastructure, but the *control flow* is Inngest's.
- **Connect mode.** A persistent outbound WebSocket from a long-running worker, so "step execution is not
  bound by platform http timeouts". Explicitly: "serverless runtimes (AWS Lambda, Vercel, etc.) are not
  supported" for Connect. ([connect](https://www.inngest.com/docs/setup/connect))
- **Cron, retries, concurrency, observability.** All first-party and declarative on the function
  definition; traces and a run-history UI are the product.
- **Self-hosting.** Supported since 1.0, single binary, SQLite + in-memory Redis by default, external
  Postgres + Redis recommended for production; support is not guaranteed for self-hosted instances.
  ([self-hosting](https://www.inngest.com/docs/self-hosting)). **The server is licensed SSPL v1.0** with an
  Apache-2.0 future license ([LICENSE.md](https://github.com/inngest/inngest/blob/main/LICENSE.md)) — the
  JS SDK is GPL-3.0. For a private fork-and-go kit this is a licensing question worth a deliberate
  decision, not an accident.

#### Trigger.dev v4

- **Typing.** `task({ id, run })` with an inferred payload type, and `myTask.trigger(payload)` typed from
  the task object. Good, but only available where the task object is importable.
- **Execution model — the hardest boundary of the six.** "Deploying consists of building your tasks and
  uploading them to the Trigger.dev cloud" via `npx trigger.dev deploy`; tasks are built into container
  images and run on Trigger.dev's infrastructure, versioned per deployment. Your app's role is reduced to
  `await myTask.trigger({...})`. ([deployment](https://trigger.dev/docs/deployment))
  **The handler is a deployment artifact, not a callback you can hand to an adapter.**
- **Limits.** Max run TTL 14 days. Trigger payload ≤ 3 MB, task output ≤ 10 MB. Log retention 1 day
  (Free) / 7 (Hobby) / 30 (Pro). Schedules per project 10 / 100 / 1,000+. Queue depth per queue
  10,000 / 250,000 / 1,000,000. API rate limit 1,500 req/min.
  ([limits](https://trigger.dev/docs/limits))
- **Self-hosting.** Apache-2.0 repo, docker-compose webapp + worker split, but self-hosted **loses warm
  starts, auto-scaling and checkpoints**; checkpoints are what make long `wait.for()` calls non-blocking,
  so a self-hosted long wait occupies a worker. "You assume all responsibility and risk for your
  deployment." ([self-hosting](https://trigger.dev/docs/self-hosting/overview))
- **Discrepancy to note:** the pricing page states 20 concurrent runs on Free while `/docs/limits` states
  10. Both are first-party and they disagree; treat the lower figure as the safe planning number.

---

## 2. The portability question — does one seam fit?

**Decompose the problem into three seams, because they do not have the same answer.**

| Seam | What it is | Portable across all six? |
|---|---|---|
| **A. Enqueue** | `enqueue(jobName, payload, opts)` | **Yes**, with a narrow options core |
| **B. Handler authoring** | `defineJob(name, schema, fn)` | **Yes for queues, no for durable engines** |
| **C. Worker wiring** | who invokes the handler, and when | **No — and it should not be** |

### Seam A: enqueue is genuinely portable

Every candidate accepts "a name and a JSON payload". A common options core of
`{ delay, maxAttempts, dedupeKey, priority }` maps onto pg-boss, Graphile, BullMQ and Inngest cleanly.
It degrades in two specific, *checkable* places rather than diffusely:

- **SQS delay caps at 15 minutes**, against arbitrary `runAt` on the Postgres queues. A job scheduled for
  next Tuesday cannot be an SQS message. The adapter should reject this at enqueue time with a typed
  error, not silently clamp.
- **SQS has no priority.** Priority must either be dropped or modelled as separate queues.

Neither of these is a lowest-common-denominator collapse. They are two named capability gaps that a
driver can declare and the type system can surface.

### Seam B: handler authoring survives control inversion — but not durable steps

**The ticket's stated worry — that SQS+Lambda "inverts control entirely" — does not in fact break the
seam.** Control inversion is a *wiring* concern. A handler written as
`async (payload: T, ctx: JobContext) => void` is callable from:

- a pg-boss `work()` loop,
- a Graphile `Task`,
- a BullMQ `Worker` processor,
- **and a Lambda `SQSHandler` shim** the kit generates, which parses `event.Records`, validates each body
  against the job's schema, calls the handler, and returns `batchItemFailures`.

This is precisely the move the kit already made with Hono — the map says Hono was chosen "because tRPC
makes the HTTP framework a thin mount point, so portability across Node container / AWS Lambda / Vercel /
Workers is the only tiebreaker that matters." The same reasoning applies verbatim to job handlers. There
is no new problem here.

**What genuinely breaks the seam is durable multi-step execution.** A handler written as:

```ts
await step.run('charge', () => stripe.charge(...));
await step.sleep('cooldown', '3 days');
const reply = await step.waitForEvent('approval', { event: 'invoice/approved', timeout: '7d' });
```

is written *against Inngest's execution model*. It is re-entrant, it is replayed from the top on every
step, and it relies on Inngest persisting each step's result. Run that exact function under pg-boss and
it executes once, top to bottom, with a literal three-day `setTimeout` inside a job lock. It is not the
same program.

That leaves two choices, and both are bad:

1. **Interface = `(payload) => Promise<void>`.** Inngest and Trigger.dev become expensive dumb queues.
   You pay per-execution for step-level durability you have contractually forbidden yourself from using.
   This is the lowest-common-denominator collapse the ticket was worried about — and it lands on the
   hosted providers, not on SQS.
2. **Interface exposes steps.** Now the kit must implement checkpointed, resumable, replay-safe execution
   on top of pg-boss and SQS to make the other drivers conform. That is a durable execution engine. It is
   a project on the scale of Inngest itself, not an adapter.

**Trigger.dev fails even option 1.** You cannot hand Trigger.dev a function pointer at runtime. Tasks are
built into a container image by its CLI and deployed to its infrastructure; the handler lives in *their*
deployment unit, not in the kit's worker process. An adapter would have to code-generate a parallel
`trigger/` directory from the kit's job registry and run a second deploy pipeline. That is a code
generator, not a driver.

### The fault line, stated plainly

> One seam fits **queues** — pg-boss, Graphile Worker, BullMQ (Redis or Postgres), and SQS + Lambda.
> Control inversion is absorbed by a generated entrypoint, exactly as Hono absorbs it for HTTP.
>
> One seam does **not** fit **durable execution engines** — Inngest and Trigger.dev. Not because they are
> hosted, and not because they own the runtime, but because their unit of work is a *checkpointed,
> resumable run*, where every queue's unit of work is a *job*. Those are different abstractions and no
> honest interface spans them.

Inngest and Trigger.dev are therefore best positioned as a **replacement for the job layer**, chosen at
fork time, not a driver behind it. The kit can and should leave that door open by keeping `defineJob`
declarations data-shaped (name + schema + handler), so a cloner who wants Inngest can mechanically map
them onto `eventType()` + `createFunction()` — but that is a migration, not a runtime env var swap.

### What the seam must push out of the interface

Three things cannot live inside `enqueue`/`defineJob`, and pretending otherwise is where an adapter rots:

- **Cron.** pg-boss/Graphile/BullMQ evaluate schedules from inside a running worker. SQS has no scheduler
  at all — it needs EventBridge Scheduler declared in Terraform. So a schedule is a **declaration** the
  kit reads at deploy time and realises per-target, not a runtime `schedule()` call. Put schedules in the
  job registry as data; let each driver's deploy step consume them.
- **Dead-letter.** pg-boss has `deadLetter` + `redrive()`. SQS has a separate queue resource plus
  `maxReceiveCount`, configured in IaC. Graphile has no DLQ concept. BullMQ has a `failed` set, not a
  queue. "Dead letter" is a leaky word across these; the portable contract is "a terminal failure is
  observable and replayable", not a shared DLQ API.
- **Concurrency.** A per-process integer (pg-boss/Graphile/BullMQ) versus event-source-mapping pollers in
  Terraform (SQS) versus a billed, key-scoped declaration (Inngest). One number cannot mean all three.

---

## 3. Serverless viability: a Postgres queue on Vercel with no worker

Short answer: **workable on Vercel Pro, effectively broken on Hobby, and never the recommended shape.**

The relevant numbers moved recently and are better than the folklore:

- **Vercel Functions with Fluid compute**: max duration is **300 s default on all plans**, with **800 s
  maximum on Pro/Enterprise** and a 1800 s extended maximum in beta.
  ([functions/limitations](https://vercel.com/docs/functions/limitations))
- **Vercel Cron Jobs**: 100 jobs per project on every plan, but the minimum interval is **once per day on
  Hobby** with **per-hour (±59 min) precision** — "cron expressions that would run more frequently will
  fail during deployment". Pro and Enterprise get once-per-minute with per-minute precision.
  ([cron-jobs/usage-and-pricing](https://vercel.com/docs/cron-jobs/usage-and-pricing))

So the pattern is: a Vercel Cron hits `/api/jobs/drain` every minute; the route runs a bounded drain loop
using pg-boss `fetch()` / `complete()` / `fail()` (or Graphile's `runOnce()`, which is documented to "run
until there are no runnable jobs left, and then resolve") and returns before the 300 s ceiling.

The costs of that pattern, honestly:

1. **Hobby is a non-starter.** One drain per day, ±59 minutes. There is no background job processing on
   Vercel Hobby worth the name. This belongs in the kit's README, not in a footnote.
2. **Latency floor equals the cron period** — 60 s at best on Pro. Fine for digests, wrong for "send the
   invite email".
3. **Cron does not run.** pg-boss evaluates schedules from a running instance every 30 s and needs
   `schedule: true`; a drain function that exits cannot own recurring schedules. You would be using
   Vercel Cron as the scheduler and pg-boss purely as a work queue — which is fine, but means schedules
   live in `vercel.json`, not in the job registry, which breaks the single-declaration rule.
4. **Neon fights you.** Neon computes scale to zero after 5 minutes of inactivity and **Free plan users
   cannot disable it** ([scale-to-zero](https://neon.com/docs/introduction/scale-to-zero)). A per-minute
   drain keeps the compute permanently awake, which is the opposite of what a Neon Free user expects, and
   burns their compute-hour allowance.
5. **Idle cost.** You pay function invocations to discover an empty queue, every minute, forever.

**Recommended kit position:** Vercel is a supported target for the **web app**, which matches the map's
"Web deploys to Vercel trivially either way". Background jobs require one of: a Node worker container
(Fly/Railway/ECS/Render), the SQS + Lambda driver on the AWS reference deployment, or a hosted provider
chosen at fork time. Ship the Vercel-Cron drain as a documented degraded mode with its limitations stated,
not as a first-class target.

---

## 4. Typed payloads

**The decisive observation: none of these libraries should be the source of typing, so typing is not a
differentiator between them.**

The kit's typesafety contract says a value's shape is declared exactly once and inferred everywhere else.
No candidate satisfies that from enqueue site to handler *on its own*:

- pg-boss and BullMQ take per-call-site generics defaulting to `object` / `any` — two independent
  declarations of the same shape, which the contract calls a bug in the kit.
- Graphile Worker's `GraphileWorker.Tasks` augmentation is a real central registry and the best built-in
  of the queues, but it is type-only; its own docs warn that SQL-side `add_job()` bypasses it entirely.
- SQS has no typing at all.
- Inngest v4's `eventType()` is genuinely one declaration driving trigger, `send()` and `waitForEvent()`,
  with Standard Schema runtime validation — the best of the six, but only inside Inngest.

Since the kit is going to own a `defineJob(name, schema, handler)` registry regardless — it needs one for
the schedule declarations and the driver-neutral handler contract anyway — that registry *is* the single
declaration:

```ts
export const sendInvite = defineJob({
  name: 'org.invite.send',
  schema: z.object({ orgId: z.string().uuid(), email: z.string().email() }),
  handler: async ({ orgId, email }, ctx) => { /* payload fully inferred */ },
});

await jobs.enqueue(sendInvite, { orgId, email });   // checked against the same schema
```

The underlying driver only ever sees `(string, unknown)`. Runtime validation happens at the seam in both
directions — validate on enqueue so bad payloads never reach the queue, and validate on dequeue because
the payload may have been written by an older deployment. This also closes Graphile's documented
SQL-insert hole and SQS's total absence of typing with the same mechanism.

Consequence: **Graphile Worker's typing advantage evaporates once the kit builds this layer**, which it
must. Choose on operations, not on typing.

---

## 5. Cost and operational floor

### Micro-SaaS (one small app, a few jobs/day)

| Option | Marginal infra cost | Operational floor |
|---|---|---|
| pg-boss / Graphile / BullMQ-pg | **$0** (uses the kit's existing Postgres) + one always-on small container, ~$5/mo on Fly or Railway | One extra process to deploy and watch |
| BullMQ + Redis | Above, plus a managed Redis | A second datastore to operate, back up and secure |
| SQS + Lambda | **~$0** — 1M SQS requests/mo free, 14M EventBridge Scheduler invocations/mo free | Terraform for queue + DLQ + ESM + schedules + IAM. The bill is nothing; the **learning curve and IaC are the floor** |
| Inngest | **$0** on Hobby: 50k executions/mo, 5 concurrent steps, 24 h trace retention, 500k events/mo | Near zero, but 5 concurrent steps is genuinely tight |
| Trigger.dev | **$0** on Free: $5 of credits/mo, 10–20 concurrent runs, **1 day log retention** | Near zero to start, but a second deploy pipeline (`npx trigger.dev deploy`) forever |

### Enterprise scale

- **SQS** (us-east-1, from the AWS Price List API, `AWSQueueService/current/us-east-1`): first 1M
  requests/mo free; Standard **$0.40/M** (to 100B), $0.30/M, then $0.24/M; FIFO **$0.50/M**, $0.40/M,
  $0.35/M; "fair queue" requests $0.10/M. Billing counts **each 64 KB chunk as one request**, so a 1 MiB
  payload is 16 requests. Budget ≥3 requests per job (send, receive, delete). No charge for same-region
  data transfer. ([sqs/pricing](https://aws.amazon.com/sqs/pricing/))
- **EventBridge Scheduler**: 14M invocations/mo free, then **$1.00 per million**.
  ([eventbridge/pricing](https://aws.amazon.com/eventbridge/pricing/))
- **Inngest**: Pro from **$99/mo** with 1M executions and 100 concurrent steps (then $25 per 25), 7-day
  trace retention, span overage $3/GB. Critically, **an execution is the run plus each step** — a
  five-step function bills as six. Step-heavy workflows multiply the bill fast.
  ([inngest.com/pricing](https://www.inngest.com/pricing))
- **Trigger.dev**: Hobby $10/mo ($10 credits, 50 concurrent), Pro $50/mo ($50 credits, 200+ concurrent,
  +$10/mo per 50). Compute billed per second by machine size (Micro $0.0000169/s, Small-1x
  $0.0000338/s), plus **$0.000025 per run** invocation ($0.25 per 10k). DEV runs are free.
  ([trigger.dev/pricing](https://trigger.dev/pricing))
- **Postgres queues**: cost is your existing database's headroom. BullMQ-pg's vendor figures suggest
  low-thousands jobs/s per worker at concurrency 1 and low-tens-of-thousands with bulk enqueue — orders of
  magnitude above what this kit's target workloads need. Watch table bloat: use retention
  (`removeOnComplete`/`removeOnFail`, pg-boss archive settings) or vacuum cost becomes the real bill.

The honest read: **at micro-SaaS scale every option is effectively free, so cost is not the deciding
factor — operational floor is.** A Postgres queue adds one process to something you already run. SQS adds
five Terraform resources. Hosted adds a vendor, a second deploy pipeline and per-step billing.

---

## 6. Comparison table

| | pg-boss | Graphile Worker | BullMQ 6 (Redis/PG) | SQS + Lambda | Inngest | Trigger.dev |
|---|---|---|---|---|---|---|
| Extra infra | none | none | none (PG) / Redis | AWS acct | vendor | vendor |
| Long-running worker | required | required (or `runOnce`) | required | no — inverted | `serve` no / `connect` yes | on their infra |
| Built-in payload typing | generics, per-site | **global `Tasks` registry** | generics, default `any` | none | **`eventType()` + Standard Schema** | inferred from `task()` |
| Cron | cron + RRULE, **tz**, catch-up | crontab, **UTC only**, `fill=` | `upsertJobScheduler`, `tz` | EventBridge Scheduler (IaC) | first-class | first-class |
| Retries / backoff | `retryBackoff` exp + jitter, configurable | fixed `exp(least(10,attempt))`, default 25 attempts | per-job strategies | `maxReceiveCount` | automatic per step | automatic per step |
| Dead letter | **`deadLetter` + `redrive()`** | none | `failed` set | **DLQ + redrive (IaC)** | failed runs + replay | failed runs + replay |
| Concurrency control | `batchSize`, singleton keys | `concurrentJobs` | `concurrency` + global `limiter` | ESM `MaximumConcurrency` / pollers | declarative, keyed, billed | plan-capped concurrent runs |
| Observability | **official `@pg-boss/dashboard`** | build your own | `bullmq-otel`, bull-board (3rd party) | CloudWatch | product-grade UI + traces | product-grade UI + traces |
| Max delay / runAt | arbitrary | arbitrary | arbitrary | **15 min** | arbitrary | arbitrary (14 d TTL) |
| Payload size ceiling | Postgres row | Postgres row | backend-dependent | **1 MiB** | 4 MB (serve request) | 3 MB trigger / 10 MB output |
| Self-host license | MIT | MIT | MIT | n/a | **SSPL-1.0** server | Apache-2.0 (minus checkpoints) |
| Fits one adapter seam | **yes** | **yes** | **yes** | **yes** | **no** | **no** |

---

## 7. Recommendation

### Ship pg-boss as the default and only in-process driver; add SQS + Lambda for the AWS reference deployment; exclude Inngest and Trigger.dev from the seam.

**Why pg-boss over Graphile Worker.** Three concrete gaps decide it, none of them about typing (see §4 —
the kit's own registry neutralises Graphile's one clear advantage). pg-boss has a **real dead-letter queue
with `redrive()`**, which the kit needs for the enterprise-from-day-one posture; Graphile has none.
pg-boss has an **official MIT dashboard** (`@pg-boss/dashboard`, actively published); Graphile expects you
to build a UI over its admin functions, and "build your own ops UI" is not something a starter kit should
hand its cloner. pg-boss supports **timezones and RRULE in schedules with a documented catch-up policy**;
Graphile is UTC-only with a coarse `fill=` backfill, and a SaaS that sends "9am local" digests will hit
that wall. Graphile's fixed `exp(least(10, attempt))` backoff is the third, smaller strike.

**Why pg-boss over BullMQ v6, despite the Postgres backend being the more elegant answer.** BullMQ v6 is
strictly the better *architecture* for this kit — one library, one handler contract, Postgres at the floor
and Redis at scale, with the vendor maintaining the conformance tests instead of us. If this decision were
being made a year from now I would expect to pick it. Today the Postgres backend is **seven weeks old**
(v6.0.0 released 2026-07-30, currently 6.3.8), the docs themselves say "the Redis backend remains the
default and the most battle-tested option", and schema downgrades are explicitly unsupported. A
fork-and-go kit inherits its defaults into every project cloned from it; that is the wrong place to take a
seven-week-old datastore bet. pg-boss 12.33.2 is mature, narrowly scoped, and has 20 open issues.

**Design the seam so BullMQ is a drop-in later.** Keep the handler contract at
`(payload: T, ctx: JobContext) => Promise<void>` and the registry data-shaped. BullMQ's processor
signature is compatible; switching would mean writing one driver, not rewriting jobs. Record this as the
expected scale path.

**Why SQS + Lambda is worth building.** The map commits to "AWS implementations exist for everything AWS
can do (S3, SES, SQS, RDS)" and to one blessed Terraform reference deployment. SQS fits seam A and seam B
cleanly. Accept up front that its Terraform module owns the queue, DLQ, event source mapping, concurrency
and EventBridge schedules — the adapter interface *declares* those, the IaC *implements* them. Accept
also that `delay > 15 min` and `priority` are unsupported on this driver and must fail loudly at enqueue,
not silently.

**Why Inngest and Trigger.dev stay outside.** Behind a `(payload) => Promise<void>` interface they are
strictly worse and more expensive than pg-boss, because everything you pay for — step checkpointing,
`sleep` for days, `waitForEvent`, per-step retry and the run-history UI — is exactly what that interface
forbids. Document them as a **fork-time replacement for the job layer**, with the `defineJob` registry
kept mechanically mappable onto Inngest v4's `eventType()` + `createFunction()`. Note for whoever
evaluates that path: Inngest's self-hostable server is SSPL-1.0, and Trigger.dev self-hosted loses
checkpoints and warm starts, which is most of the reason to run it.

**Vercel.** Ship the Vercel-Cron drain endpoint as a documented degraded mode with its four limitations
stated plainly (Hobby = once/day, 60 s latency floor at best, schedules move to `vercel.json`, Neon Free
never sleeps). Do not present Vercel as a supported target for the *server*; the map already only claims
it for the web app.

### Open questions this research did not settle

- Whether pg-boss's `fetch()`/`complete()` drain loop behaves well under Vercel's Fluid compute
  concurrency model — the two vendors' docs do not address each other, and this needs a prototype rather
  than more reading.
- Actual BullMQ-pg throughput on Neon or RDS. The only published figures are the vendor's own laptop
  benchmarks, which they explicitly label "not a formal benchmark".
- Whether the kit's `ctx: JobContext` should expose a transaction handle. pg-boss supports a
  transactional work mode (`handler(jobs, tx)`); SQS cannot offer anything equivalent. If it goes in the
  interface it is a fourth capability gap.
