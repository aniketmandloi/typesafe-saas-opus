import { describe, expect, it } from "vitest";

import { type JobQueue, jobPayloads, parseJobPayload } from "./index.ts";

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
