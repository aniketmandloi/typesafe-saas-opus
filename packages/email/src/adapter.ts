// The kit's demand surface for transactional email (ADR-0004). One operation,
// because one is what the kit asks for: send one already-rendered message to
// one address.
//
// **Rendering is not in this seam.** The message arrives with its subject and
// both bodies already built, so choosing React Email or anything else stays a
// separate decision — the kit's email-templating question is still open, and
// folding a renderer in here would answer it by accident. It also keeps the
// seam honest: every provider can send a subject and two bodies, and none of
// them agree on templates.
//
// `from` is absent for the same reason AWS credentials are absent from the env
// fragments: it is deployment configuration, not a per-message choice. SES and
// Resend both require a sender the deployment has verified, so the adapter
// holds it and a use case cannot spoof one.

export type EmailMessage = {
  to: string;
  subject: string;
  html: string;
  /**
   * Required, not optional. A transactional mail with no plaintext part lands
   * in spam filters more often, and making it optional would let a renderer
   * quietly stop producing one.
   */
  text: string;
};

export type EmailAdapter = {
  readonly id: string;
  /**
   * Resolves once the provider has accepted the message, which is not the same
   * as delivery. Nothing in the kit waits on delivery, and an adapter that
   * pretended to would block a job handler on a mail server.
   */
  send(message: EmailMessage): Promise<{ messageId: string }>;
};
