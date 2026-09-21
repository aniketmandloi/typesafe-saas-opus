import { INVITATION_EMAIL_TEMPLATE } from "@repo/api";
import type { EmailMessage } from "@repo/email";

// The smallest thing that is not a decision.
//
// How the kit renders mail — React Email or otherwise, and how templates stay
// provider-agnostic — is still an open question on the map. Reaching for a
// renderer here would answer it by accident, so this is string interpolation
// and an escape, and it is meant to be replaced. What it does settle, because
// the slice needs it settled, is the **shape**: a template takes typed
// variables and returns a subject and both bodies, which is exactly what the
// email seam accepts.

const escapeHtml = (value: string) =>
  value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");

export type TemplateVariables = {
  [INVITATION_EMAIL_TEMPLATE]: {
    invitationId: string;
    organizationName: string;
    inviterName: string;
  };
};

export type TemplateName = keyof TemplateVariables;

export const renderTemplate = <TName extends TemplateName>(
  name: TName,
  variables: TemplateVariables[TName],
  { appUrl }: { appUrl: string },
): Omit<EmailMessage, "to"> => {
  switch (name) {
    case INVITATION_EMAIL_TEMPLATE: {
      const { organizationName, inviterName, invitationId } = variables;
      // The accept link is the invitation id and nothing else. Where an
      // unauthenticated visitor lands is the client's problem: the server
      // answers UNAUTHORIZED and the app routes through signup carrying the id.
      const url = `${appUrl}/invitations/${encodeURIComponent(invitationId)}`;
      return {
        subject: `${inviterName} invited you to ${organizationName}`,
        html: `<p>${escapeHtml(inviterName)} invited you to join <strong>${escapeHtml(organizationName)}</strong>.</p><p><a href="${escapeHtml(url)}">Accept the invitation</a></p>`,
        text: `${inviterName} invited you to join ${organizationName}.\n\nAccept the invitation: ${url}\n`,
      };
    }
    default:
      // Unreachable while TemplateName is a closed union, and present so that
      // adding a template without rendering it fails here rather than sending
      // an empty message.
      throw new Error(`No template named ${String(name)}.`);
  }
};
