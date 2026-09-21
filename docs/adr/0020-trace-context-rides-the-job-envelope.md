# Trace context rides the Job envelope, not the Job payload

`JobQueue.enqueue` carries a **trace envelope beside the payload**, and the consumer's Process span **links** to the enqueuing context rather than parenting from it. Handlers never see the envelope.

## Why not in the payload

`@repo/jobs`' `jobPayloads` record is the single declaration of a Job's shape, and `parseJobPayload` validates it in both directions. Putting `traceparent` in the payload would mean either every payload schema declares a trace field — the same infrastructure concern re-declared in *N* domain shapes, which the kit's typesafety contract calls a bug outright — or one schema quietly permitting an extra key, which defeats the validation that exists to catch a payload written by an older deployment.

The envelope belongs to the **seam** because every driver needs it and no handler should ever read it: pg-boss gets a column, SQS gets message attributes, the in-memory fake carries it in memory. That asymmetry is the test that it is infrastructure and not domain data.

## Why links and not parent-child

The messaging semantic conventions propagate W3C `traceparent` with the message and have the consumer link to the **message creation context**. Links are the default because a span can have **only one parent**, which breaks the moment a consumer takes a batch — and because links are "the only consistent trace structure that can be guaranteed, given the many different messaging systems models available". Parenting directly from the creation context is permitted only in single-message scenarios, and a kit spanning pg-boss and SQS does not get to assume one.

This also fits what [ADR-0015](./0015-background-jobs-are-a-queue-seam.md) already settled: enqueueing and running are different events, on different processes, at different times. A parent span that ended minutes before its child began was always the wrong picture.

## What this costs

**The conventions are at `Development` stability** — not stable, not release candidate. Attribute names may move, and `OTEL_SEMCONV_STABILITY_OPT_IN=messaging` is the migration knob when they do. This is accepted knowingly: the alternative is inventing private attribute names that no backend understands.

**Links are the weakest thing to query in some backends** — Sentry's OTLP ingest accepts them and cannot search, filter or aggregate on them. That is not a cost this ADR pays, because [ADR-0019](./0019-sentry-owns-errors-otlp-owns-traces.md) keeps traces out of Sentry; it is, in part, *why* that ADR reads the way it does.

## Consequences

**`JobQueue.enqueue` and `JobContext` both grow**, and every driver — including the fake — must carry the envelope or the join silently disappears. A driver that drops it produces Job spans that look fine in isolation and can never be traced back to a request, which is a failure nothing alerts on.

**Someone will try to move it into the payload**, because that is where the data visibly is and the envelope looks like ceremony. The envelope is what keeps an infrastructure concern out of *N* domain schemas.
