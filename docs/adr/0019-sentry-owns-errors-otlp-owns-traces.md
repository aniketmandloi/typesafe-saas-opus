# Sentry owns errors, OTLP owns traces

The kit runs **two telemetry paths on purpose**. Errors go to Sentry through Sentry's own SDK, on the server and in both clients. Traces leave as OTLP to whatever endpoint the deployment names. **Sentry is never the trace backend**, even though it can be.

Splitting by signal looks like indecision, and it is the opposite. The two signals have different shapes, different consumers and — decisively — different vendor risk.

## Why Sentry does not also take the traces

Sentry's OTLP ingest is real, needs no Sentry SDK and is in open beta, so "point the exporter at Sentry" is a genuine option. It fails on a specific weakness that lands exactly where this kit hurts: **span links are ingested but cannot be searched, filtered or aggregated**. [ADR-0020](./0020-trace-context-rides-the-job-envelope.md) makes links the structure joining a Job to the request that enqueued it, because the messaging semantic conventions say links are the only consistent structure available. So the single most valuable query this kit's tracing exists to answer — *which request enqueued the Job that failed* — is the one Sentry's OTLP path indexes worst. It also **drops span events entirely** and **supports no metrics**.

## Why not OpenTelemetry-native only, with no Sentry at all

Because there is no vendor-neutral equivalent of the thing Sentry is actually good at. Error grouping, release health, breadcrumbs, symbolication and a real mobile client are product, not protocol. Emitting errors as OTLP log records would surrender all of it and buy only consistency.

## Why this makes Sentry's OpenTelemetry reversal a non-event

Sentry v10 is built on OpenTelemetry and automatically adopts any span created through `@opentelemetry/api`. **v11 undoes that** — the SDK owns the span lifecycle, produces native Sentry spans, *ignores* spans from `@opentelemetry/api` unless explicitly opted in, and the primitives for routing your own provider's spans into Sentry were **removed outright**, with the migration guide stating there is no longer a way to do it.

Had the kit relied on "instrument with the OTel API, let Sentry collect it", that reversal would be a migration. Because Sentry never carries traces here, **it does not matter to this kit whether Sentry adopts OpenTelemetry spans or not**. That durability is a large part of why the split is worth its cost. (v11 was at RC when this was decided, not GA; `@sentry/nextjs` is one of two packages where the OpenTelemetry path stays on by default.)

**That default has a name and a consequence on v11**: `enableOpenTelemetrySetup` defaults to `true` on `@sentry/nextjs` and `@sentry/sveltekit` and `false` everywhere else, so the **web Entrypoint must set it `false` and leave `tracesSampleRate` unset** — v11 emits HTTP and fetch spans whenever tracing is on, regardless of that flag. `@sentry/node` already defaults it to `false`, so the server and worker Entrypoints need no opt-out.

## What the split actually costs

**Two configurations on the server**, and **the trace id has to be stitched onto Sentry errors by hand** so an error links to the trace that produced it. Nothing does this for us on v10 — v11's `openTelemetryIntegration()` attaches errors, logs, metrics and crons to the active OTel span, which retires this cost **server-side only**, leaving the web half of it standing — and an error with no trace id is the failure mode that makes people ask why there are two systems.

## Per-target facts this decision inherits

**Vercel**: `@vercel/otel` plus `registerOTel()` is the supported path, and **manual OpenTelemetry SDK setup loses Session Tracing and Trace Drains** — so the Entrypoint for Vercel is not free to hand-roll its registration the way the Node one is. Trace drains are Pro and Enterprise only, billed at **$0.50/GB of uncompressed JSON regardless of delivery encoding**, which makes the 1.0 sampling default of [ADR-0018](./0018-telemetry-is-not-an-adapter.md) a cost decision there and not only a fidelity one. OTLP/gRPC is not supported; HTTP JSON or protobuf only.

**AWS Lambda**: use the **upstream `opentelemetry-lambda` layers, not ADOT**. AWS now marks the embedded-collector layers "not recommended" and steers to Application Signals layers that export to CloudWatch, which is the wrong direction for a kit whose whole posture here is a pluggable endpoint. `@opentelemetry/instrumentation-aws-lambda` force-flushes the providers before the handler completes, so `BatchSpanProcessor` is safe **under the wrapper** — unwrapped Lambda code needs `SimpleSpanProcessor` or an explicit `forceFlush`, and gets silent span loss otherwise.

## Two live risks this decision carries

**~~`@sentry/nextjs` on Next.js 16 is unverified.~~ Resolved: it is supported, and has been since `10.20.0` (2025-10-15).** The "Next.js 15+" wording in the manual-setup docs is a floor, not a ceiling — `10.75.1` peers `^16.0.0-0`, and the SDK repo carries a `nextjs-16` e2e application at that tag which calls `withSentryConfig` under both the Turbopack default and `--webpack`. `instrumentation.ts`, `onRequestError` and `instrumentation-client.ts` are unchanged on 16. Two quality caveats survive, neither threatening this decision: function names stay mangled in Turbopack stack traces ([#18248](https://github.com/getsentry/sentry-javascript/issues/18248)), and Next 16's rename of middleware to proxy left proxy-thrown errors as the one capture path with no coverage in the SDK's own CI ([#23945](https://github.com/getsentry/sentry-javascript/issues/23945)). Established by [#42](https://github.com/aniketmandloi/typesafe-saas-opus/issues/42).

**Expo source-map upload fails silently.** `@sentry/react-native` has an open bug where the config plugin is not applied during EAS *cloud* prebuild, so source maps and debug symbols never upload. The build is green and the crashes are unsymbolicated, which is the worst shape a failure can take. The kit's CI needs a check that an uploaded bundle actually has its Debug ID, not merely that the build passed.

## Consequences

**Neither path may leak into a `@repo/*` package.** Sentry's SDK and the OTLP exporter both belong to Entrypoints and app-level configuration; packages see only `@opentelemetry/api` per [ADR-0018](./0018-telemetry-is-not-an-adapter.md). A Sentry DSN a client needs is declared in `publicSchema` and reaches the bundle through that app's access map — it is **app config, not adapter config**, as [#15](https://github.com/aniketmandloi/typesafe-saas-opus/issues/15) already ruled.

**Someone will try to collapse this to one vendor.** Two telemetry systems in an otherwise aggressively opinionated kit reads as a decision nobody finished making. It was finished; this ADR is the reason.
