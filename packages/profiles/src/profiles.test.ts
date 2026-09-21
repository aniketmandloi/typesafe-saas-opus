import { describe, expect, it } from "vitest";

import { createLocalProfile } from "./local.ts";

const VALID = {
  DATABASE_URL: "postgres://localhost:5432/kit",
  BETTER_AUTH_SECRET: "test-only-secret-at-least-thirty-two-characters",
  APP_URL: "http://localhost:3000",
};

describe("a deployment requires exactly its own providers' variables", () => {
  it("asks for nothing on behalf of the fakes", () => {
    const profile = createLocalProfile();
    // The whole zero-config claim, as an assertion: three variables, none of
    // them belonging to an adapter.
    expect(Object.keys(profile.serverSchema.shape).sort()).toEqual([
      "APP_URL",
      "BETTER_AUTH_SECRET",
      "DATABASE_URL",
    ]);
  });

  it("parses a complete environment", () => {
    expect(createLocalProfile().serverSchema.parse(VALID)).toMatchObject(VALID);
  });

  // One parse per deployment, so a misconfigured one names everything it is
  // missing instead of one variable per restart (#15).
  it("reports every missing variable at once", () => {
    const result = createLocalProfile().serverSchema.safeParse({});
    expect(result.success).toBe(false);
    expect(result.error?.issues.map((issue) => issue.path[0]).sort()).toEqual([
      "APP_URL",
      "BETTER_AUTH_SECRET",
      "DATABASE_URL",
    ]);
  });
});

describe("the profile owns which adapters, and hands back the same ones", () => {
  it("wires the fakes", () => {
    const profile = createLocalProfile();
    const adapters = profile.createAdapters(profile.serverSchema.parse(VALID));
    expect([adapters.storage.id, adapters.email.id, adapters.queue.id]).toEqual([
      "fake",
      "fake",
      "fake",
    ]);
  });

  it("gives a caller the same instances the fakes handle points at", () => {
    const profile = createLocalProfile();
    const adapters = profile.createAdapters(profile.serverSchema.parse(VALID));
    expect(adapters.email).toBe(profile.fakes.email);
    expect(adapters.storage).toBe(profile.fakes.storage);
    expect(adapters.queue).toBe(profile.fakes.queue);
  });

  // The reason it is a factory: two tests sharing one outbox is a flake that
  // only shows up when the suite is run in a particular order.
  it("does not share an outbox between profile instances", async () => {
    const one = createLocalProfile();
    const other = createLocalProfile();
    await one.fakes.email.send({
      to: "ada@example.com",
      subject: "A",
      html: "<p>a</p>",
      text: "a",
    });
    expect(one.fakes.email.outbox).toHaveLength(1);
    expect(other.fakes.email.outbox).toHaveLength(0);
  });
});
