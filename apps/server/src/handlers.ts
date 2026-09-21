import type { EmailAdapter } from "@repo/email";
import type { JobHandlers } from "@repo/jobs";

import { renderTemplate, type TemplateName, type TemplateVariables } from "./templates.ts";

/**
 * The job handlers this deployment can run.
 *
 * `Pick` rather than the whole `JobHandlers`, and deliberately so: the purge
 * job and its sweep are ADR-0007's work and are not in the vertical slice, and
 * a stub that silently did nothing would be worse than an absence a type can
 * see.
 *
 * Handlers take their adapters as arguments for the same reason every other
 * package does — a handler that reached for configuration could not be run
 * against the fakes (ADR-0006).
 */
export const createJobHandlers = ({
  email,
  appUrl,
}: {
  email: EmailAdapter;
  appUrl: string;
}): Pick<JobHandlers, "email.send"> => ({
  "email.send": async (payload) => {
    // The payload's `variables` are deliberately unstructured at the queue
    // boundary (#6) — typing every template's variables there would make that
    // package change whenever copy does. They are typed *here*, where the
    // template is, which is the only place that knows what they mean.
    const rendered = renderTemplate(
      payload.template as TemplateName,
      payload.variables as TemplateVariables[TemplateName],
      { appUrl },
    );
    await email.send({ to: payload.to, ...rendered });
  },
});
