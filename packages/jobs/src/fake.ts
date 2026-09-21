import {
  type JobHandlers,
  type JobName,
  type JobPayload,
  type JobQueue,
  parseJobPayload,
} from "./queue.ts";

export type EnqueuedJob = {
  id: string;
  name: JobName;
  payload: unknown;
  runAt: Date | undefined;
};

// The zero-config dev and test driver. It holds jobs in memory, which is
// exactly what C7 forbids on three of the four deployment targets — and that is
// fine, because this driver is never one of them. pg-boss and SQS are the real
// drivers; this one exists so a clean checkout can run the slice with no
// Postgres and no AWS account.
//
// It does **not** drain on its own. A queue that ran handlers the moment
// something was enqueued would hide the one property the seam exists to
// express: that enqueueing and running are different events, on different
// processes, at different times. Tests drain explicitly.
export type FakeQueue = JobQueue & {
  readonly jobs: readonly EnqueuedJob[];
  /** Runs every queued job once, in order, and clears the queue. */
  drain(handlers: Partial<JobHandlers>): Promise<void>;
  clear(): void;
};

export const createFakeQueue = (): FakeQueue => {
  const jobs: EnqueuedJob[] = [];
  let sequence = 0;

  return {
    id: "fake",
    jobs,
    clear() {
      jobs.length = 0;
    },
    async enqueue(name, payload, options) {
      // Parsed here, so a malformed payload fails at the call site rather than
      // three retries deep inside a handler. The real drivers do the same.
      parseJobPayload(name, payload);
      sequence += 1;
      const id = `fake-job-${sequence}`;
      jobs.push({ id, name, payload, runAt: options?.runAt });
      return id;
    },
    async drain(handlers) {
      const pending = jobs.splice(0, jobs.length);
      for (const job of pending) {
        const handler = handlers[job.name];
        if (!handler) continue;
        await (
          handler as (payload: unknown, ctx: { attempt: number; jobId: string }) => Promise<void>
        )(parseJobPayload(job.name, job.payload) as JobPayload<typeof job.name>, {
          attempt: 1,
          jobId: job.id,
        });
      }
    },
  };
};
