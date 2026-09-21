import { describe, expect, it } from "vitest";

import { emailAdapterContract } from "./contract.ts";
import { createFakeEmail } from "./fake.ts";

describe("the fake meets the demand surface", () => {
  emailAdapterContract("fake", createFakeEmail);
});

describe("the outbox is the point", () => {
  it("records who was sent what, in order", async () => {
    const email = createFakeEmail();
    await email.send({ to: "ada@example.com", subject: "A", html: "<p>a</p>", text: "a" });
    await email.send({ to: "grace@example.com", subject: "B", html: "<p>b</p>", text: "b" });

    // #16's rules are about recipients, not templates: a deletion notice goes
    // to every member, a T-7 warning to owners only, and a Dark Organization
    // receives no other mail at all. None of that is assertable without this.
    expect(email.outbox.map((one) => one.to)).toEqual(["ada@example.com", "grace@example.com"]);
  });

  it("carries a plaintext part on every message, because the type requires one", async () => {
    const email = createFakeEmail();
    await email.send({ to: "ada@example.com", subject: "A", html: "<p>a</p>", text: "a" });
    expect(email.outbox.every((one) => one.text.length > 0)).toBe(true);
  });
});
