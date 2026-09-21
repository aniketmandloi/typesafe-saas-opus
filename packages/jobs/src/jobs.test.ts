import { describe, expect, it } from "vitest";

import { createFakeQueue } from "./fake.ts";
import { type JobQueue, jobPayloads, parseJobPayload } from "./queue.ts";

describe("job payloads are typed at the boundary", () => {
  it("parses a valid payload", () => {
    expect(
      parseJobPayload("email.send", {
        to: "a@example.com",
        template: "invite",
        variables: { orgName: "Acme" },
      }),
    ).toMatchObject({ to: "a@example.com", template: "invite" });
  });

  it("rejects a malformed payload where it is enqueued, not mid-retry", () => {
    expect(() =>
      parseJobPayload("email.send", { to: "not-an-email", template: "x", variables: {} }),
    ).toThrow();
    expect(() => parseJobPayload("organization.purge", {})).toThrow();
  });

  it("covers every declared job", () => {
    expect(Object.keys(jobPayloads).sort()).toEqual([
      "email.send",
      "organization.purge",
      "organization.purgeSweep",
    ]);
  });
});

describe("the seam is a queue, not a workflow engine", () => {
  it("a driver only has to offer enqueue", async () => {
    const enqueued: { name: string; payload: unknown }[] = [];
    const queue: JobQueue = {
      id: "test",
      async enqueue(name, payload) {
        enqueued.push({ name, payload });
        return "job-1";
      },
    };
    const id = await queue.enqueue("organization.purge", { organizationId: "org_1" });
    expect(id).toBe("job-1");
    expect(enqueued).toEqual([
      { name: "organization.purge", payload: { organizationId: "org_1" } },
    ]);
  });
});

describe("the dev driver keeps enqueueing and running apart", () => {
  const payload = { to: "ada@example.com", template: "invite", variables: {} };

  it("does not run a handler just because something was enqueued", async () => {
    const queue = createFakeQueue();
    let ran = 0;
    await queue.enqueue("email.send", payload);
    expect(ran).toBe(0);
    // Draining is a separate act, on a separate process in every real driver.
    await queue.drain({
      "email.send": async () => {
        ran += 1;
      },
    });
    expect(ran).toBe(1);
  });

  it("refuses a malformed payload at the call site, not three retries deep", async () => {
    const queue = createFakeQueue();
    await expect(queue.enqueue("email.send", { ...payload, to: "not-an-email" })).rejects.toThrow();
    expect(queue.jobs).toHaveLength(0);
  });

  it("drains in order and leaves nothing behind", async () => {
    const queue = createFakeQueue();
    const seen: string[] = [];
    await queue.enqueue("email.send", { ...payload, to: "a@example.com" });
    await queue.enqueue("email.send", { ...payload, to: "b@example.com" });
    await queue.drain({
      "email.send": async (job) => {
        seen.push(job.to);
      },
    });
    expect(seen).toEqual(["a@example.com", "b@example.com"]);
    expect(queue.jobs).toHaveLength(0);
  });
});
