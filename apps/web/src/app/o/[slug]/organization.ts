import { notFound } from "next/navigation";

import { createRscAnonymousClient } from "../../../trpc/rsc.ts";

/**
 * Resolve the slug in the URL to the Organization id the contract wants.
 *
 * Routes are slug-shaped and the contract is id-shaped (#3), and this is the
 * bridge. It is a membership lookup, so a slug the caller does not belong to is
 * indistinguishable from one that does not exist — `notFound()` either way,
 * matching what the contract itself answers.
 */
export const resolveOrganization = async (slug: string) => {
  const client = await createRscAnonymousClient();
  const memberships = await client.organizations.list.query();
  const membership = memberships.find((one) => one.slug === slug);
  if (!membership) notFound();
  return membership;
};
