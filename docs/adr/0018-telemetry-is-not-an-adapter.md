# Telemetry is not an Adapter: the kit emits OpenTelemetry and Entrypoints register it

Storage, email and queue sit behind the profile-composed adapter seam. Telemetry does not join them. The kit's packages import **`@opentelemetry/api` and nothing else**, and the Entrypoint registers an SDK — or registers nothing, which is the default state of a fresh fork.

[ADR-0004](./0004-adapter-seam-demand-shaped-and-statically-composed.md) makes the seam **demand-shaped**: an Adapter exists because a Use case *calls* a capability and the interface is shaped by that call. Telemetry is ambient rather than called. Every layer emits, nothing awaits a result, and there is no meaningful fake to swap in a test — a fourth member of `Adapters` whose absence has no behavioural consequence is the opposite of how the other three earn their place. [#7](https://github.com/aniketmandloi/typesafe-saas-opus/issues/7) had already put OTel registration in the *target residue* that lives in the Entrypoint rather than the Deployment profile, and `profiles/src/profile.ts` says so in a comment written long before this decision.

`@opentelemetry/api` is not a provider SDK and that is the whole point. At 1.9.1 it has **zero dependencies and is 4.6 KB gzipped**, its methods "perform no operations by default… can be safely called whether there is an SDK registered or not", and its global-registration version check hands back a no-op on mismatch. So a `@repo/*` package that emits a span costs an unconfigured cloner nothing, and the rule that only adapter packages may import a provider SDK survives intact.

## Instrumentation always runs; export is what is conditional

An absent OTLP endpoint means "this deployment does not export", not a crash — the same reading of optional configuration that [ADR-0006](./0006-entrypoints-parse-env-packages-never-do.md) applies everywhere else. A cloner who configures nothing still gets structured logs. Turning export on is one variable, never a code change. The kit deliberately does not refuse to boot without telemetry: its posture is enterprise concerns shipped off, not enforced.

## What carries a span

**Auto-instrumentation** for inbound HTTP and for Postgres, the latter at the `pg` driver rather than by wrapping Drizzle — wrapping the ORM would couple the kit to an internal that ADR-0013's type-gate discipline deliberately keeps at arm's length.

**Kit-authored spans** at three boundaries, because at each one the span name is a domain fact rather than a URL or a SQL string: **tRPC procedures** (`projects.create`), **Job runs** (`org.purge`) and **Adapter calls** (`storage.presign`).

**Better Auth gets nothing of its own.** [ADR-0009](./0009-better-auth-is-an-identity-store.md) mounts it as an opaque route surface and [ADR-0019](./0019-sentry-owns-errors-otlp-owns-traces.md) does not change that; HTTP instrumentation already covers every request that reaches it, and reaching inside for more would be exactly the coupling [#18](https://github.com/aniketmandloi/typesafe-saas-opus/issues/18) bounded.

## Logging is a separate concern from tracing

A **stdout JSON logger**, correlated to traces by trace id and not routed through the telemetry SDK. All four targets capture stdout — CloudWatch on AWS, runtime logs on Vercel — so it is the one sink that works everywhere with zero configuration, and crucially the only telemetry that still works in the default fork-and-go state where no exporter is registered. Folding logs into the OTLP pipeline would make the unconfigured case silent, which is the case most cloners are in.

## Spans carry two identifiers and never a third

`organizationId` and `userId`. **Never an email, never a name, never a field value.** Without an org id on the span, "this tenant reports it is slow" is undebuggable, which is most of the reason to run tracing at all.

This sits in real tension with [ADR-0007](./0007-organization-soft-delete-and-purge.md), and the tension is recorded rather than resolved: **Purge does not reach telemetry.** [#17](https://github.com/aniketmandloi/typesafe-saas-opus/issues/17) already fixed that an Audit entry and a span are different things — one durable, tenant-readable and written in the caller's transaction, the other sampled, externally stored and disposable — and that separation is what stops erasure being *quietly* broken. What it cannot do is make a pseudonymous id in a third-party trace store vanish on purge. The exposure is bounded by retention the cloner configures (Vercel 12 h to 3 days, Observability Plus 30 days) and by the rule that nothing beyond the two ids is ever attached.

## Sampling is parent-based, and defaults to everything

A parent-based ratio sampler, its rate from an environment variable, defaulting to **1.0**. Parent-based is what keeps one trace whole across web → server → Job instead of half-sampling it at each hop. The default is 1.0 because a fresh fork has no traffic and a cloner debugging their first deployment wants every trace; the variable is how that becomes survivable later. Two facts make this the cloner's decision rather than a backend's: Sentry's `tracesSampleRate` **does not apply to OTLP spans**, and Vercel drops a span unless *both* the inbound `traceparent` decision and its own sampling say sample.

## Consequences

**Someone will try to make this an Adapter.** It is the fourth infrastructure capability and it sits outside the seam holding the other three, which looks like an oversight until you know the seam is demand-shaped. This ADR is what says otherwise.

**A `@repo/*` package may import `@opentelemetry/api` and no other telemetry package.** The exporter, the SDK and any vendor client belong to Entrypoints.
