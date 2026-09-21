import { z } from "zod";

// The queue seam (#6). One interface fits *queues* — pg-boss in process,
// SQS plus Lambda on the AWS reference deployment — because control inversion
// is a wiring concern and a `(payload, ctx) => Promise<void>` handler runs
// unchanged under all of them.
//
// It deliberately does not fit durable execution engines. Their unit of work is
// a checkpointed resumable run, not a job, and `step.sleep('3 days')` has no
// meaning here. Durable workflows are out of scope for this kit.
//
// Cron, dead-lettering and concurrency are absent on purpose. They are
// deploy-time declarations — a schedule in Terraform, a redrive policy on a
// queue — not parameters a handler can carry, and pretending otherwise would
// shape the interface around one driver's capabilities.
//
// This package is universal: it holds payload types and the handler contract,
// so a client can enqueue with a typed payload. The server-tagged handler
// *implementations* live elsewhere.

export const jobPayloads = {
  "email.send": z.object({
    to: z.email(),
    template: z.string().min(1),
    // Deliberately unstructured: templates vary, and typing every template's
    // variables here would make this package change whenever copy does.
    variables: z.record(z.string(), z.unknown()),
  }),
  // ADR-0007's purge. One job per Organization past its grace window, enqueued
  // by a daily sweep. It runs storage → Polar → database, external-first,
  // because the rows hold the object keys and the customer id.
  "organization.purge": z.object({
    organizationId: z.string().min(1),
  }),
  // The sweep itself: enqueues one purge job per due Organization. Every target
  // needs some daily trigger, and the 30-day window is deliberately indifferent
  // to cron jitter — Vercel Hobby fires once a day ±59 minutes.
  "organization.purgeSweep": z.object({}),
} as const;

export type JobName = keyof typeof jobPayloads;

export type JobPayload<TName extends JobName> = z.infer<(typeof jobPayloads)[TName]>;

export type JobContext = {
  /** Distinguishes a retry from a first attempt; handlers must be idempotent regardless. */
  attempt: number;
  jobId: string;
};

// There is deliberately no cancellation signal here. Shutdown is the driver's
// business — pg-boss draining in-process and a Lambda being frozen are not the
// same event — and a handler that reacts to it is coupled to the driver's
// lifecycle, which is exactly what this seam exists to prevent. Handlers are
// idempotent and short; the driver retries what it interrupts.
//
// It also kept this universal package honest: AbortSignal lives in the DOM lib,
// and reaching for it would have pulled a platform assumption into a package
// that ships to mobile.

export type JobHandler<TName extends JobName> = (
  payload: JobPayload<TName>,
  ctx: JobContext,
) => Promise<void>;

export type JobHandlers = { [TName in JobName]: JobHandler<TName> };

// Enqueueing is the only thing callers outside the worker do. A driver
// implements this; nothing else about the driver is visible.
export type JobQueue = {
  readonly id: string;
  enqueue<TName extends JobName>(
    name: TName,
    payload: JobPayload<TName>,
    options?: { runAt?: Date },
  ): Promise<string>;
};

// Parsing at the boundary means a malformed payload fails where it was
// enqueued, not three retries deep inside a handler.
export const parseJobPayload = <TName extends JobName>(
  name: TName,
  payload: unknown,
): JobPayload<TName> => jobPayloads[name].parse(payload) as JobPayload<TName>;
