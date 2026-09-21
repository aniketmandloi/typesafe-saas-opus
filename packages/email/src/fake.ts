import type { EmailAdapter, EmailMessage } from "./adapter.ts";

// The test default and the zero-config dev default (ADR-0004). It keeps an
// outbox, which is the whole reason a fake beats a no-op here: the kit has
// rules about *who receives what* — the deletion notice goes to all members,
// the T-7 purge warning to owners only, and a Dark Organization gets no other
// mail at all (#16) — and only an inspectable outbox can assert them.
//
// Where it diverges from a real provider, and the docs must say so: nothing is
// delivered, no address is verified, bounces and complaints do not exist, and
// there is no rate limit. Code that passes against this fake can still be
// rejected by SES for an unverified sender.
export type FakeEmail = EmailAdapter & {
  /** Test-only: every message this adapter accepted, in order. */
  readonly outbox: readonly EmailMessage[];
  clear(): void;
};

export const createFakeEmail = (): FakeEmail => {
  const outbox: EmailMessage[] = [];
  let sent = 0;

  return {
    id: "fake",
    outbox,
    clear() {
      outbox.length = 0;
    },
    async send(message) {
      outbox.push(message);
      sent += 1;
      return { messageId: `fake-${sent}` };
    },
  };
};
