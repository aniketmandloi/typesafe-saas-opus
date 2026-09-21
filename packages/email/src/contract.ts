import { expect, it } from "vitest";

import type { EmailAdapter } from "./adapter.ts";

// The demand surface, executable — the same shape as the storage contract, and
// for the same reason: an adapter that cannot meet what the kit asks for fails
// at selection time rather than in production (ADR-0004).
//
// It asserts nothing about delivery, bounces or sender verification, because
// the fake legitimately has none of them. Those differences belong in the
// cloner-facing docs, not in a suite the fake is meant to fail.
export const emailAdapterContract = (
  name: string,
  create: () => EmailAdapter | Promise<EmailAdapter>,
) => {
  const message = (to: string) => ({
    to,
    subject: "Contract",
    html: "<p>Contract</p>",
    text: "Contract",
  });

  it(`${name}: accepts a message and identifies it`, async () => {
    const email = await create();
    const { messageId } = await email.send(message("ada@example.com"));
    expect(messageId.length).toBeGreaterThan(0);
  });

  it(`${name}: gives each accepted message its own id`, async () => {
    const email = await create();
    const first = await email.send(message("ada@example.com"));
    const second = await email.send(message("grace@example.com"));
    expect(first.messageId).not.toBe(second.messageId);
  });

  it(`${name}: identifies itself`, async () => {
    const email = await create();
    expect(email.id.length).toBeGreaterThan(0);
  });
};
