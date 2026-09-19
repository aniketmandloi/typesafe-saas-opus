# Hono + tRPC across container, Lambda and Vercel

Research for issue [#7](https://github.com/aniketmandloi/typesafe-saas-opus/issues/7). Verified 2026-09-19 against
primary sources only (Hono docs + published package source, tRPC docs + published package manifest, AWS docs,
Vercel docs, Cloudflare docs, npm registry). Every substantive claim carries its source. Claims I could not verify
are marked **[unverified]**.

The deliverable is the **constraints list** in the last section. Everything before it is the evidence for it.

---

## 1. Current stable versions and compatibility

All read from the npm registry on 2026-09-19 (`npm view <pkg> version time.modified`):

| Package | Version | Last published |
| --- | --- | --- |
| `hono` | 4.13.8 | 2026-09-15 |
| `@hono/node-server` | 2.1.1 | 2026-08-14 |
| `@hono/trpc-server` | 0.4.2 | 2026-01-12 |
| `@trpc/server` | 11.19.0 | 2026-09-17 |
| `@trpc/client` | 11.19.0 | 2026-09-17 |

Engine and peer constraints, read from the published `package.json` of each tarball:

- `hono@4.13.8` → `engines.node: ">=16.9.0"`.
- `@hono/node-server@2.1.1` → `engines.node: ">=20"`, `peerDependencies: { hono: "^4" }`. This is the binding
  Node floor for the kit, not Hono's own.
- `@hono/trpc-server@0.4.2` → `peerDependencies: { "@trpc/server": "^10.10.0 || >11.0.0-rc", "hono": ">=4.0.0" }`.
  tRPC 11.19.0 satisfies it.
- `@trpc/server@11.19.0` → `peerDependencies: { typescript: ">=5.7.2" }`, no Node engine constraint declared.

**tRPC↔Hono adapter story.** `@hono/trpc-server` is a first-party Hono middleware
([honojs/middleware, `packages/trpc-server`](https://github.com/honojs/middleware/tree/main/packages/trpc-server)).
Its entire implementation is a thin wrapper over tRPC's runtime-agnostic Fetch adapter — from the published
`dist/index.js` of 0.4.2:

```js
import { fetchRequestHandler } from "@trpc/server/adapters/fetch";
// ...
return await fetchRequestHandler({
  ...rest,
  createContext: async (opts) => ({
    ...(createContext ? await createContext(opts, c) : {}),
    env: c.env,                       // <-- see §5, this is target-divergent
  }),
  endpoint: resolvedEndpoint,
  req: /* c.req.raw, or a Proxy that re-reads the body through Hono */,
});
```

Two consequences:

1. **tRPC itself is not a portability risk.** `fetchRequestHandler` only needs `Request`, `Response`, `Headers`,
   `URL` and `fetch` ([tRPC Fetch adapter docs](https://trpc.io/docs/server/adapters/fetch)) — all present on every
   target under consideration. tRPC also ships `@trpc/server/adapters/aws-lambda`,
   `/adapters/express`, `/adapters/fastify`, `/adapters/node-http`, `/adapters/standalone`, `/adapters/ws`
   (from the 11.19.0 export map), but **the kit should never use them**: going through Hono means one adapter
   (`fetch`) everywhere.
2. `@hono/trpc-server` is 8 months stale relative to `hono` and `@trpc/server`. It is ~40 lines and depends on
   nothing target-specific, so the staleness is low-risk, but it is a single small dependency the kit could
   inline if it ever blocks a tRPC major.

`@hono/trpc-server` has no runtime-specific code path, so **by construction** it works identically on every target
Hono runs on. **[unverified]** — I did not execute it on Lambda/Vercel/Workers; this is read from source.

---

## 2. Per-target adapters: what the entrypoint looks like, and what else diverges

Hono 4.13.8's export map (read from the tarball's `package.json`) includes `./cloudflare-workers`,
`./cloudflare-pages`, `./aws-lambda`, `./vercel`, `./netlify`, `./lambda-edge`, `./deno`, `./bun`,
`./service-worker`. Node is the only major target whose adapter lives in a separate package.

### Node container

```ts
import { serve } from '@hono/node-server'
const server = serve({ fetch: app.fetch, port: 8787 })
process.on('SIGINT', () => { server.close(); process.exit(0) })
```

`@hono/node-server` wraps `node:http`; Hono's Node guide notes that unlike Bun and Deno, **you manage server
shutdown yourself** ([Hono Node.js guide](https://hono.dev/docs/getting-started/nodejs)). Raw Node objects are
reachable via `c.env.incoming` / `c.env.outgoing` typed as `HttpBindings`. HTTP/2 is supported by passing
`createServer` / `createSecureServer`. `serveStatic` from `@hono/node-server/serve-static` resolves `root`
**relative to the process CWD**, which the docs explicitly flag as a footgun.

### AWS Lambda

```ts
import { handle } from 'hono/aws-lambda'          // or streamHandle for response streaming
export const handler = handle(app)
```

From the published `dist/adapter/aws-lambda/handler.js`, `handle` calls
`app.fetch(req, { event, requestContext, lambdaContext })`. So `c.env` is the Lambda event triple, typed via a
`Bindings` generic of `{ event: LambdaEvent, lambdaContext: LambdaContext }`
([Hono AWS Lambda guide](https://hono.dev/docs/getting-started/aws-lambda)). The adapter base64-encodes bodies
whose `Content-Type` looks binary, and imports `node:stream/promises` — it is Node-only by construction.
`streamHandle` wraps `awslambda.streamifyResponse`, a **global injected by the Lambda Node runtime**, so that path
only exists on Lambda.

(A third-party `hono-adapter-aws-lambda@1.4.0` also exists — `peerDependencies: { hono: ">=4.7.11" }`,
[namesmt/hono-adapter-aws-lambda](https://github.com/namesmt/hono-adapter-aws-lambda). The kit should stay on the
built-in `hono/aws-lambda`; noted only so a future session doesn't mistake it for the official one.)

### Vercel

```ts
// index.ts or src/index.ts
export default app
```

Vercel has **zero-config, framework-detected Hono support**
([Hono Vercel guide](https://hono.dev/docs/getting-started/vercel);
[Vercel changelog: Deploy Hono backends with zero configuration](https://vercel.com/changelog/deploy-hono-backends-with-zero-configuration);
Hono is listed under [Vercel's zero-config backends](https://vercel.com/docs/frameworks/backend)). The
`hono/vercel` `handle()` export still exists and is literally `(app) => (req) => app.fetch(req)` (from
`dist/adapter/vercel/handler.js`) — it passes **no second argument**, so `c.env` is `undefined` on Vercel. The
default export is now the documented path.

### Cloudflare Workers

```ts
export default app
// or: export default { fetch: app.fetch, scheduled: async (batch, env) => {} }
```

`c.env` here is the **Workers bindings object** (R2 buckets, KV, secrets), not the Lambda event and not
`process.env` ([Hono Cloudflare Workers guide](https://hono.dev/docs/getting-started/cloudflare-workers)).

### What actually diverges beyond the entrypoint

The Hono app object, all middleware, all routes, and the tRPC mount are byte-identical across all four. Three
things diverge:

| | Node | Lambda | Vercel (Node/Fluid) | Workers |
| --- | --- | --- | --- | --- |
| Entrypoint | `serve({ fetch: app.fetch })` | `export const handler = handle(app)` | `export default app` | `export default app` |
| `c.env` is | `{ incoming, outgoing }` | `{ event, requestContext, lambdaContext }` | `undefined` | Workers bindings |
| `process.env` | yes | yes | yes | only with the `nodejs_compat_populate_process_env` flag |

`c.env` being four different things is the single largest portability trap in the stack, and
`@hono/trpc-server` injects it straight into every tRPC context as `ctx.env` (see §1). See constraint C2.

---

## 3. What does not survive the move

### 3.1 Warm-process assumptions

**Lambda.** "Lambda freezes the execution environment when the runtime and each extension have completed and
there are no pending events… When the function is invoked again, Lambda thaws the environment for reuse."
Objects declared outside the handler stay initialized. Critically: "Background processes or callbacks that were
initiated by your Lambda function and did not complete when the function ended **resume if Lambda reuses the
execution environment**. Make sure that any background processes or callbacks in your code are complete before the
code exits." And: "Lambda terminates execution environments every few hours… You should not assume that the
execution environment will persist indefinitely."
([Lambda execution environment lifecycle](https://docs.aws.amazon.com/lambda/latest/dg/lambda-runtime-environment.html))

So fire-and-forget after the response is not merely unreliable on Lambda — it is *non-deterministically deferred*,
which is worse than failing.

One standard Lambda execution environment serves **one invocation at a time** (invocation limit is
"10 requests per second per instance", i.e. serialized) — so N in-process connections × concurrency is the DB
connection count. ([Lambda quotas](https://docs.aws.amazon.com/lambda/latest/dg/gettingstarted-limits.html))

**Vercel Fluid compute is the opposite shape.** Fluid is the default for new projects and allows "multiple
invocations to share a single function instance"; isolation is "a global state/process" shared between concurrent
requests, and an uncaught exception "lets current requests finish before stopping the process"
([Vercel Fluid compute](https://vercel.com/docs/fluid-compute)). Post-response work is supported but only via
`waitUntil()` from `@vercel/functions` (or `after()` in Next 15.1+), and "promises passed to `waitUntil()` will
have the same timeout as the function itself"
([@vercel/functions reference](https://vercel.com/docs/functions/functions-api-reference/vercel-functions-package)).

**Net:** module-scope singletons are safe on Node and Vercel-Fluid, semi-safe on Lambda (survive thaw, vanish on
recycle), and on Workers are per-isolate with no guarantees at all. Any in-memory counter, rate-limit bucket,
cache, or `setInterval` is wrong on at least two of the four.

### 3.2 Postgres connection pooling — the Lambda problem in detail

This is the sharpest per-target difference and the one most likely to bite the kit.

**Why it breaks.** AWS states it plainly: "A database proxy manages a pool of shared database connections which
enables your function to reach high concurrency levels without exhausting database connections. We recommend using
Amazon RDS Proxy for Lambda functions that make frequent short database connections, or open and close large
numbers of database connections."
([Lambda + RDS](https://docs.aws.amazon.com/lambda/latest/dg/configuration-database.html)). Default Lambda
concurrency is 1,000 ([quotas](https://docs.aws.amazon.com/lambda/latest/dg/gettingstarted-limits.html)); a
`postgres.js` client defaults to `max: 10` ([porsager/postgres README](https://github.com/porsager/postgres)), so
an untuned pool at full concurrency asks Postgres for up to 10,000 backends.

**The trap inside the fix.** Putting a pooler in front does not make the ORM layer portable, because both common
poolers run **transaction mode** and transaction mode forbids session state:

- *Neon* uses PgBouncer with `pool_mode=transaction` behind the `-pooler` hostname, accepting up to 10,000 client
  connections. Transaction mode does **not** support `SET`/`RESET`, SQL-level `PREPARE`/`DEALLOCATE`,
  `LISTEN`/`NOTIFY`, session-lifetime temporary tables, or session-level advisory locks. Migrations, `pg_dump` and
  logical replication must use the **direct, non-pooled** endpoint.
  ([Neon connection pooling](https://neon.com/docs/connect/connection-pooling))
- *RDS Proxy* pins a client connection to a backend — destroying multiplexing — on, for PostgreSQL specifically:
  `SET` commands; `PREPARE`/`DISCARD`/`DEALLOCATE`/`EXECUTE`; creating temporary sequences, tables or views;
  declaring cursors; discarding session state; `LISTEN`; loading a library module; `nextval`/`setval`;
  `pg_advisory_lock`/`pg_try_advisory_lock` (transaction-scoped `pg_advisory_xact_lock*` does **not** pin).
  Any statement over 16 KB pins, on every engine. And: "**RDS Proxy doesn't support session pinning filters for
  PostgreSQL**" — the MySQL escape hatch does not exist here.
  ([Avoiding pinning](https://docs.aws.amazon.com/AmazonRDS/latest/UserGuide/rds-proxy-pinning.html),
  [RDS Proxy limitations](https://docs.aws.amazon.com/AmazonRDS/latest/UserGuide/rds-proxy.html))
  Also relevant to a connection-pool library: "If you use connection pooling libraries with `DISCARD ALL` query
  configured as a reset query, RDS Proxy pins your client connection on release."

**The driver-level consequence.** `postgres.js` creates prepared statements automatically — `prepare` defaults to
`true` ([README](https://github.com/porsager/postgres)). Against a transaction-mode pooler that must be
`prepare: false`; Drizzle's own Supabase guide says exactly this: with Transaction pool mode "ensure to turn off
prepare… `postgres(process.env.DATABASE_URL, { prepare: false })`"
([Drizzle — Supabase](https://orm.drizzle.team/docs/connect-supabase)). The README notes PgBouncer ≥1.21 supports
protocol-level named prepared statements when `max_prepared_statements` is configured — so this is
deployment-config-dependent, not a flat rule. RDS Proxy pins on PostgreSQL prepared statements regardless.

**Vercel's own answer** is different again: `attachDatabasePool(pool)` from `@vercel/functions`, called right after
creating the pool, "ensures that idle pool clients are properly released before functions suspend" (supports `pg`,
`mysql2`, MongoDB, ioredis, cassandra-driver)
([@vercel/functions reference](https://vercel.com/docs/functions/functions-api-reference/vercel-functions-package)).
Vercel documents this as the recommended pattern for backends
([Backends on Vercel](https://vercel.com/docs/frameworks/backend)).

**Workers** cannot be served by any of the above: Cloudflare's documented path is Hyperdrive, which "maintains the
underlying database connection pool, so creating a new client is fast," used with the ordinary `pg` driver
([Hyperdrive](https://developers.cloudflare.com/hyperdrive/)). **[unverified]** whether a Worker can open a raw TCP
Postgres connection without Hyperdrive — I did not confirm the `cloudflare:sockets` path.

**Bottom line for the kit:** the DB module must take the connection string *and* a per-target driver/pool policy
from configuration, and the query layer must never use session state. That is constraints C4–C6.

### 3.3 Timeouts and request ceilings

| Target | Ceiling | Source |
| --- | --- | --- |
| Node container | none intrinsic | — |
| Lambda (function) | 900 s (15 min). Managed Instances: 5,400 s for async/ESM invocations only | [Lambda quotas](https://docs.aws.amazon.com/lambda/latest/dg/gettingstarted-limits.html) |
| Lambda behind API Gateway REST | **29 s default integration timeout**; increasable for Regional/private REST APIs, but "this might require a reduction in your account-level throttle quota" | [AWS: integration timeout beyond 29s](https://aws.amazon.com/about-aws/whats-new/2024/06/amazon-api-gateway-integration-timeout-limit-29-seconds/), [REST API quotas](https://docs.aws.amazon.com/apigateway/latest/developerguide/api-gateway-execution-service-limits-table.html) |
| Vercel Fn (Fluid, Node) | 300 s default. Hobby max 300 s; Pro/Ent max 800 s; 1800 s extended max in beta | [Vercel Functions limits](https://vercel.com/docs/functions/limitations) |
| Vercel Edge runtime | must start responding within 25 s; may stream up to 300 s | same |
| Workers (paid) | CPU time 30 s default, 300 s max; **wall clock unlimited for HTTP while the client stays connected** | [Workers limits](https://developers.cloudflare.com/workers/platform/limits/) |

The binding number for a target-agnostic server is **29 seconds**, if API Gateway REST is in the picture. Note that
Workers bills *CPU* time, not wall time, so the same handler is measured differently.

### 3.4 Payload ceilings

| Target | Request | Response |
| --- | --- | --- |
| Lambda sync | 6 MB | 6 MB buffered; **200 MB** streamed |
| Lambda async | 1 MB | — |
| Vercel Function | **4.5 MB** | **4.5 MB** (413 `FUNCTION_PAYLOAD_TOO_LARGE`) |
| Workers | 100 MB (Free/Pro), 200 MB (Business), 5 GB (Ent) — a *Cloudflare plan* limit, not a Workers-plan limit | no enforced limit |
| Node container | none intrinsic | none intrinsic |

Sources: [Lambda quotas](https://docs.aws.amazon.com/lambda/latest/dg/gettingstarted-limits.html),
[Vercel limits](https://vercel.com/docs/functions/limitations),
[Workers limits](https://developers.cloudflare.com/workers/platform/limits/).

**4.5 MB is the binding number**, and it lands squarely on the map's open "File upload flow" question: any
server-proxied upload path is capped at 4.5 MB on Vercel and 6 MB on Lambda. Presigned direct-to-storage uploads
are the only shape that is target-agnostic.

Also: Lambda request line + headers combined are capped at 1 MB; Workers caps URLs at 16 KB and headers at 128 KB
each way. Large cookies / `Authorization` headers are a portability hazard.

### 3.5 Streaming

Streaming works everywhere but through four different mechanisms:

- **Lambda** requires `streamHandle` instead of `handle` (different entrypoint), and streaming is only available
  via Function URLs, `InvokeWithResponseStream`, or the API Gateway proxy response-transfer-mode integration.
  Bandwidth is uncapped for the first 6 MB then **2 MB/s**. "Lambda function URLs do not support response
  streaming within a VPC environment" — which collides directly with the VPC requirement for RDS.
  Streamed responses "are not interrupted or stopped when the invoking client connection is broken. Customers are
  billed for the full function duration."
  ([Lambda response streaming](https://docs.aws.amazon.com/lambda/latest/dg/configuration-response-streaming.html))
- **Vercel / Node / Workers** stream from a plain `Response` body with no entrypoint change.

Hono's `hono/streaming` helpers are the same API in all four cases; only the Lambda entrypoint changes.

### 3.6 WebSockets

`upgradeWebSocket` exists for exactly four adapters — Cloudflare Workers/Pages (`hono/cloudflare-workers`), Deno
(`hono/deno`), Bun (`hono/bun`), and Node (`@hono/node-server`, requires the `ws` package and a
`WebSocketServer({ noServer: true })` passed to `serve()`)
([Hono WebSocket helper](https://hono.dev/docs/helpers/websocket)). There is **no** `hono/aws-lambda`
`upgradeWebSocket`.

Vercel now supports WebSockets on Fluid compute, but through a Vercel-specific API —
`experimental_upgradeWebSocket()` from `@vercel/functions`, which "only works on the Vercel platform"
([@vercel/functions reference](https://vercel.com/docs/functions/functions-api-reference/vercel-functions-package),
[Backends on Vercel](https://vercel.com/docs/frameworks/backend)).

So there is no portable websocket. This is consistent with realtime already being **out of scope** on the map.

### 3.7 Filesystem and Node built-ins

- **Lambda**: `/tmp` is 512 MB–10,240 MB, writable, and **persists across invocations in the same environment** —
  a transient cache, not a clean slate. The Lambda reset after an invoke failure "does not clear the `/tmp`
  directory content before the next init phase."
  ([lifecycle](https://docs.aws.amazon.com/lambda/latest/dg/lambda-runtime-environment.html))
- **Workers**: `node:fs` exists under `nodejs_compat` but is a memory-backed VFS. Only `/tmp` is writable;
  "the contents of `/tmp` are not persistent and are unique to each request"; 128 MB per file; all operations are
  synchronous even via the async APIs; temp files count against the Worker's memory
  ([Workers node:fs](https://developers.cloudflare.com/workers/runtime-apis/nodejs/fs/)). Worker isolates have
  **128 MB memory shared across all concurrent requests in that isolate**
  ([Workers limits](https://developers.cloudflare.com/workers/platform/limits/)).
- **Workers node built-ins**: with `nodejs_compat`, Cloudflare lists assert, async_hooks, buffer, crypto, errors,
  events, fs, globals, http, https, net, path, process, querystring, stream, string_decoder, timers, url, util,
  zlib as supported; console, dns, module, os, perf_hooks, test runner, and tls as *partial*; and
  `node:child_process`, `node:cluster`, `node:worker_threads`, `node:http2` as **non-functional stubs** that
  import successfully but do not work
  ([Workers Node.js APIs](https://developers.cloudflare.com/workers/runtime-apis/nodejs/)).
  That last group is the dangerous one: a transitive dependency probing for `worker_threads` will load and then
  misbehave rather than fail loudly.
- **Vercel** claims "Full Node.js coverage" for the Node runtime, with **1,024 file descriptors shared across all
  concurrent executions** including the runtime's own — an explicit warning about connection-heavy code
  ([Vercel limits](https://vercel.com/docs/functions/limitations)). Lambda has the same 1,024 FD limit.

---

## 4. Build and bundling: one server, four build outputs

There is **no single build config that serves all four targets**, because each target's platform tooling owns the
bundling step and they disagree about what "external" means.

### How each target builds

- **Node container.** No bundling required. `pnpm deploy --filter` / `pnpm --prod install` into the image, ship
  `node_modules`. Workspace packages resolve through pnpm's symlinks. This is the only target where "external"
  can mean "resolve at runtime."
- **AWS Lambda (CDK).** `aws-lambda-nodejs.NodejsFunction` bundles with **esbuild**. Defaults exclude the
  AWS SDK v3 (`@aws-sdk/*`) on Node 18+; `bundling.externalModules` adjusts that; `bundling.nodeModules` installs
  specific packages into `node_modules` instead of bundling them, using the detected lock file
  (`pnpm-lock.yaml` supported), and `forceDockerBundling: true` is the documented route for native modules.
  `depsLockFilePath` is the monorepo knob, and the directory containing the lock file becomes the Docker mount
  root ([CDK aws-lambda-nodejs](https://docs.aws.amazon.com/cdk/api/v2/docs/aws-cdk-lib.aws_lambda_nodejs-readme.html)).
- **Vercel.** Framework-detected for Hono; Vercel owns the build. Bundle cap is 250 MB uncompressed
  (500 MB Python; 5 GB "large functions" beta behind `VERCEL_SUPPORT_LARGE_FUNCTIONS`), and Vercel notes these
  "limits are enforced by AWS" ([Vercel limits](https://vercel.com/docs/functions/limitations)).
  `@vercel/nft@1.11.0` is Vercel's file-tracing package. **[unverified]** — I did not confirm end-to-end how
  `@vercel/nft` traces a pnpm-workspace server that imports `@repo/*` packages; that is the one bundling question
  that needs a prototype, not a doc read.
- **Cloudflare Workers.** `wrangler@4.135.0` owns the build and bundles by default; cap is 64 MiB **uncompressed**
  per Worker ([Workers limits](https://developers.cloudflare.com/workers/platform/limits/)).

### What this means for workspace imports

The server importing `@repo/db`, `@repo/contract`, `@repo/env` etc. is fine on all four **only if those packages
are bundled, not externalized**, because they are never published to a registry and cannot be `npm install`ed at
the target. Concretely:

- On Lambda/Workers/Vercel the bundler must follow the pnpm symlink into the workspace package and inline it.
  That works when the workspace package exposes TypeScript/ESM source or a built ESM entry with correct
  `exports` — and breaks when a package only ships CJS with conditional requires, or relies on
  `__dirname`-relative file reads.
- Anything listed as `external` must be genuinely present at the target: only `@aws-sdk/*` on Lambda
  (provided by the runtime), and Node built-ins. Nothing else is safe to externalize.
- Native/binary modules (`sharp`, `bcrypt`, `argon2`, `libsql`) cannot be bundled by esbuild and must go through
  `bundling.nodeModules` + `forceDockerBundling` on Lambda, and **cannot run on Workers at all**. Choosing
  pure-JS/WASM implementations of hashing and image processing is what keeps one build config *close to*
  serving all targets.

### Which bundler for the shared packages

Registry state on 2026-09-19 (`npm view <pkg> version time.modified`):

| Tool | Version | Last published |
| --- | --- | --- |
| `esbuild` | 0.28.2 | 2026-08-08 |
| `rolldown` | 1.2.9 | 2026-09-16 |
| `tsdown` | 0.23.0 | 2026-09-03 |
| `tsup` | 8.5.1 | **2025-11-12** |
| `unbuild` | 3.6.1 | 2025-08-15 |
| `@vercel/nft` | 1.11.0 | 2026-08-18 |
| `wrangler` | 4.135.0 | 2026-09-18 |

`tsup` has not published in ~10 months while `rolldown`/`tsdown` publish weekly. I am reporting publish dates as
fact; I did **not** verify any deprecation notice, so "tsup is unmaintained" is **[unverified]**. The practical
read: the *server* isn't bundled by the kit at all (each platform bundles it), so the bundler choice only affects
how workspace packages are emitted — and the cheapest answer is to emit nothing at all and let workspace packages
be consumed as TypeScript source via `exports` conditions, which sidesteps the question on every target.

---

## 5. Env and secrets per target

| Target | Where values come from | Reachable at module scope? |
| --- | --- | --- |
| Node container | `process.env` | yes |
| Lambda | function environment variables → `process.env`. **4 KB total for all env vars, in aggregate** | yes |
| Vercel (Node) | project env vars → `process.env`; system vars via `getEnv()` from `@vercel/functions` | yes |
| Workers | `c.env` bindings; `process.env` only with the `nodejs_compat_populate_process_env` flag | **no** |

Sources: [Lambda quotas](https://docs.aws.amazon.com/lambda/latest/dg/gettingstarted-limits.html),
[Hono Cloudflare Workers guide](https://hono.dev/docs/getting-started/cloudflare-workers),
[@vercel/functions reference](https://vercel.com/docs/functions/functions-api-reference/vercel-functions-package).

**Hono ships the portable accessor**: `env(c)` from `hono/adapter`
([Adapter helper](https://hono.dev/docs/helpers/adapter)). From the published
`dist/helper/adapter/index.js`, it dispatches on `getRuntimeKey()`:

```js
const runtimeEnvHandlers = {
  bun: () => globalThis.process.env,
  node: () => globalThis.process.env,
  'edge-light': () => globalThis.process.env,   // Vercel Edge
  deno: () => Deno.env.toObject(),
  workerd: () => c.env,                          // Workers bindings
  fastly: () => ({}), other: () => ({}),
};
```

`getRuntimeKey()` returns `workerd | deno | bun | node | edge-light | fastly | other`. Lambda and Vercel's Node
runtime both resolve to `node` → `process.env`.

Two consequences the kit must absorb:

1. **`env(c)` needs a request context.** On Workers there is no way to read config at module load. A typed-env
   module that does `parse(process.env)` at import time — the obvious shape for the map's "typed env" contract —
   silently yields an empty object on Workers. The env schema must be parsed **once per request (memoized)** from
   `env(c)`, not at module scope, if Workers is to stay on the table.
2. **Lambda's 4 KB aggregate env limit** rules out stuffing a full config (or a private key) into env vars. Larger
   secrets must come from Secrets Manager / SSM via an adapter, which means secret *reads* are async and
   per-target.

Also note Vercel hides a list of `AWS_*` / `LAMBDA_*` env vars when Fluid compute is enabled — they are
"not accessible and you cannot log them" ([Vercel limits](https://vercel.com/docs/functions/limitations)) — so
runtime detection must not sniff for `AWS_LAMBDA_FUNCTION_NAME`.

Finally, on identity: Vercel issues an OIDC token (`getVercelOidcToken`, `awsCredentialsProvider`) so a
Vercel-hosted server can assume an AWS role without long-lived keys
([@vercel/functions reference](https://vercel.com/docs/functions/functions-api-reference/vercel-functions-package)).
That is directly relevant to the map's "Deployment is the cloner's choice" stance — the AWS adapters (S3, SES, SQS)
can work from Vercel without static credentials.

---

## 6. Observability hooks per target

| Target | Native hook |
| --- | --- |
| Node container | anything; OTel Node SDK with full auto-instrumentation |
| Lambda | ADOT managed Lambda layer for Node 18+, exporting to X-Ray by default. "To reduce Lambda cold starts, by default only AWS SDK and HTTP instrumentations are enabled." Extensions API + Telemetry API for log/metric sidecars ([ADOT Lambda JS](https://aws-otel.github.io/docs/getting-started/lambda/lambda-js/), [Lambda lifecycle](https://docs.aws.amazon.com/lambda/latest/dg/lambda-runtime-environment.html)) |
| Vercel | `@vercel/otel` + `@opentelemetry/api`, initialized from `instrumentation.ts`. Custom metrics via `metric()` (≤100 calls/invocation, ≤50 attributes each). **"If your app uses manual OpenTelemetry SDK configuration without the usage of `@vercel/otel`, you will not be able to use Session Tracing or Trace Drains."** Custom spans are not supported on the Edge runtime ([Vercel instrumentation](https://vercel.com/docs/tracing/instrumentation)) |
| Workers | no OTel Node SDK; Cloudflare's own tail/observability plane **[unverified]** — I did not verify Workers' current OTel story |

The portable layer is thin but real: **`@opentelemetry/api` is the only thing application code should import.**
Span creation via `trace.getTracer()` works identically everywhere; only the *provider registration* is
per-target, and it belongs in the per-target entrypoint, never in shared code.

Trace propagation has a per-target gotcha worth recording: Vercel ANDs the inbound `traceparent` sampling decision
with its own — "if an upstream service marks a trace as not sampled, Vercel respects that decision"
([Vercel instrumentation](https://vercel.com/docs/tracing/instrumentation)). That directly affects the map's open
question about traces crossing web→server→job.

---

## 7. The constraints — rules the server code must obey to stay target-agnostic

Each rule is followed by the concrete per-target difference that forces it.

**C1. The app is a value; the entrypoint is a leaf.**
`createApp()` returns a configured `Hono` instance and imports nothing from `hono/aws-lambda`,
`@hono/node-server`, `hono/vercel`, `@vercel/functions` or `cloudflare:*`. Each target gets a ~5-line entrypoint
file that imports the app and adapts it.
*Why:* the four entrypoints are genuinely different (`serve({fetch})` / `handle(app)` / `export default app` /
`export default app`), and `hono/aws-lambda` imports `node:stream/promises` and touches the `awslambda` global.

**C2. Never read `c.env` — and never read `ctx.env` in a tRPC procedure.**
Use `env(c)` from `hono/adapter` for configuration.
*Why:* `c.env` is `{incoming,outgoing}` on Node, `{event,requestContext,lambdaContext}` on Lambda, `undefined` on
Vercel, and the bindings object on Workers. `@hono/trpc-server@0.4.2` injects `env: c.env` into every tRPC context
by default, so this trap is one autocomplete away.

**C3. Parse and validate typed env per-request (memoized), not at module scope.**
*Why:* on Workers, environment values only exist on `c.env` during a request; `process.env` is empty without the
`nodejs_compat_populate_process_env` flag. Additionally, Lambda caps all env vars at 4 KB in aggregate, so
anything larger must be fetched asynchronously from a secret store behind an adapter.

**C4. All Postgres access goes through a pooler, and the driver is configured by the deployment, not the code.**
The DB module accepts a connection string plus a pool policy; `max` is a config value, not a constant.
*Why:* Lambda's default concurrency of 1,000 × a `postgres.js` default `max: 10` is up to 10,000 backends. Vercel
Fluid instead shares one process across concurrent requests and wants `attachDatabasePool(pool)` from
`@vercel/functions`. Workers wants Hyperdrive. A container wants a normal long-lived pool. Same query code, four
pool policies.

**C5. Never use Postgres session state in application queries.**
No `SET` / `set_config`, no SQL `PREPARE`/`DEALLOCATE`/`EXECUTE`, no session-level advisory locks
(`pg_advisory_lock` — use `pg_advisory_xact_lock*`), no `LISTEN`/`NOTIFY`, no session-lifetime temp tables, no
cursors, no `nextval`/`setval` outside a column default, and no `DISCARD ALL` reset query. Keep statements under
16 KB.
*Why:* each of these pins an RDS Proxy session for PostgreSQL (and RDS Proxy has no session-pinning-filter escape
hatch for Postgres), and each is unsupported by Neon's PgBouncer transaction mode. This rule is what lets one
query layer run behind either pooler.
*Corollary:* `postgres.js` must be constructed with `prepare: false` unless the deployment guarantees a pooler
with protocol-level prepared statements; and **migrations must use the direct, non-pooled endpoint**, which means
the migration runner needs a second connection string.

**C6. Multi-statement work uses explicit transactions; never rely on state surviving between two calls.**
*Why:* transaction-mode poolers return the backend to the pool at each commit. Two sequential queries outside a
transaction can land on two different backends.

**C7. No warm-process state. Nothing in memory survives a request.**
No in-memory caches, rate-limit buckets, session stores, dedupe maps, or `setInterval`.
*Why:* Lambda freezes and recycles environments "every few hours"; Vercel Fluid shares one process across
*concurrent* requests (so in-memory state is also a cross-request correctness bug, not just a cache miss); Workers
isolates are per-colo with 128 MB shared across concurrent requests. This is the rule that forces the map's
rate-limiting decision toward Postgres/Redis.

**C8. No work after the response returns. Enqueue it.**
Every post-response side effect (audit write, email, analytics) goes to the background-job adapter inside the
request, not to a floating promise.
*Why:* Lambda freezes the environment when the handler settles and dangling callbacks "resume if Lambda reuses the
execution environment" — non-deterministically, possibly minutes later, attributed to a different request. Vercel
requires `waitUntil()`, Workers requires `ctx.waitUntil()`, and a container needs neither. Enqueueing is the only
shape that means the same thing in all four.

**C9. Design every handler to finish in under ~25 seconds.**
Anything longer is a background job.
*Why:* API Gateway REST integration timeout is 29 s by default (raising it costs account-level throttle quota);
Vercel Edge must start responding within 25 s. Lambda's 900 s and Vercel's 800 s are irrelevant if a gateway sits
in front.

**C10. Never send or accept a body over ~4 MB through the server.**
File transfer is presigned direct-to-storage, both directions.
*Why:* Vercel caps request **and** response bodies at 4.5 MB (413 `FUNCTION_PAYLOAD_TOO_LARGE`); Lambda caps
synchronous invocations at 6 MB each way. A server-proxied upload path is not portable at any useful file size.
Keep headers small too: Lambda caps request line + headers at 1 MB, Workers caps headers at 128 KB and URLs at
16 KB.

**C11. Stream through the Web `Response` body only; treat streaming as an entrypoint concern.**
*Why:* Lambda needs a *different entrypoint* (`streamHandle`, `awslambda.streamifyResponse`) and streaming is
unavailable on Function URLs inside a VPC — which is exactly where an RDS-backed function lives. Beyond 6 MB
Lambda throttles to 2 MB/s and bills the full duration even if the client disconnects. If a tRPC subscription or
streamed response is ever added, it must degrade to a buffered response on targets that can't stream.

**C12. No filesystem. Not even `/tmp`.**
*Why:* on Lambda `/tmp` persists across invocations in the same environment (and is not cleared after an invoke
failure), on Workers it is a per-request memory-backed VFS that counts against a 128 MB budget, and on a container
it is a real disk. Three incompatible semantics for the same path. Serve static assets from the CDN/object store,
not from the server; note that `@hono/node-server`'s `serveStatic` resolves `root` against the process CWD.

**C13. No native modules, and no dependency on the stubbed Node built-ins.**
Pure-JS or WASM for hashing and image processing. Never `child_process`, `cluster`, `worker_threads`, `http2`.
*Why:* esbuild cannot bundle native addons, so Lambda needs `bundling.nodeModules` + `forceDockerBundling`, and
Workers cannot load them at all. Workers ships those four built-ins as non-functional stubs that *import
successfully* — a dependency that feature-detects them will take the wrong branch silently.

**C14. Workspace packages must be bundle-able: ESM, correct `exports`, no `__dirname` file reads, no dynamic
`require` of computed paths.**
*Why:* `@repo/*` packages are never published, so every serverless target must inline them. esbuild (CDK),
`@vercel/nft` (Vercel) and wrangler each trace them differently, and the only externals that are genuinely safe
are Node built-ins and `@aws-sdk/*` on Lambda.

**C15. Application code imports `@opentelemetry/api` and nothing else observability-shaped.**
Provider registration lives in the per-target entrypoint.
*Why:* Lambda uses the ADOT layer (X-Ray by default, limited auto-instrumentation to protect cold starts), Vercel
requires `@vercel/otel` specifically or you lose Session Tracing and Trace Drains, and Workers has no Node OTel
SDK. `trace.getTracer()` is the only API common to all.

**C16. No websockets in the kit's core.**
*Why:* `upgradeWebSocket` exists for Node, Bun, Deno and Workers but **not** for Lambda, and Vercel's support is a
platform-specific `experimental_upgradeWebSocket()` that "only works on the Vercel platform." Consistent with
realtime already being out of scope on the map — this research confirms that call was correct.

---

## 8. Does anything here invalidate the map's Notes?

**The "Hono over Fastify/Express… portability is the only tiebreaker" claim — mostly holds, but narrower than
stated.**

- Vercel now supports **Fastify, Express, Koa, NestJS, H3, Nitro and Elysia** with zero configuration, alongside
  Hono ([Backends on Vercel](https://vercel.com/docs/frameworks/backend)). `@fastify/aws-lambda@6.4.1` (published
  2026-08-12) covers Lambda. So for the Node container / Lambda / Vercel triple, Fastify is portable too.
- Hono's real, non-substitutable advantage is **Cloudflare Workers**, where Fastify (built on `node:http`) cannot
  run, and the fact that tRPC's Fetch adapter is a direct fit for a Fetch-native framework — no
  `node-http`-shim in between.
- So the tiebreaker is sound **only if Workers stays a target**. If the kit ever formally drops Workers, the
  Hono-over-Fastify argument loses most of its force. That is worth recording as a dependency between two
  decisions, not as a reason to revisit the choice now.

**Everything else in the Notes survives.** "Deployment is the cloner's choice" is workable — the divergence is
confined to a per-target entrypoint, a per-target pool policy, a per-target OTel registration and a per-target
build step, all of which sit behind the adapter boundary the map already calls for. Vercel's OIDC support
(`awsCredentialsProvider`) even makes the AWS adapters usable from Vercel without static credentials.

**Two open map questions get sharper answers from this research:**

- *File upload flow*: the 4.5 MB Vercel body cap makes presigned direct-to-storage the only portable shape. This
  is now a constraint, not a preference.
- *Rate limiting*: C7 rules out in-memory buckets on three of four targets, so it must be backed by Postgres or
  Redis regardless of where the kit deploys.

---

## 9. What remains unverified

1. How `@vercel/nft` traces a pnpm-workspace server importing `@repo/*` packages end to end. Needs a prototype.
2. Whether a Cloudflare Worker can reach Postgres over raw TCP without Hyperdrive.
3. Cloudflare Workers' current OpenTelemetry story.
4. `tsup`'s maintenance status beyond its 2025-11-12 publish date.
5. That `@hono/trpc-server@0.4.2` actually runs unchanged on Lambda/Vercel/Workers — read from source, not executed.
