import { redirect } from "next/navigation";

import { createRscAnonymousClient } from "../trpc/rsc.ts";
import { SignInForm } from "./sign-in-form.tsx";

/**
 * The default redirect #3 describes: a solo user never sees an org switcher, so
 * they land straight in their personal Organization and the `/o/:slug` segment
 * stays out of their way. "Optional for individuals" is delivered here, in the
 * UI, and never in the schema.
 */
export default async function Home() {
  const client = await createRscAnonymousClient();

  const memberships = await client.organizations.list.query().catch(() => null);
  if (!memberships) return <SignInForm />;

  const landing = memberships.find((one) => one.isPersonal) ?? memberships[0];
  if (!landing) return <SignInForm />;

  redirect(`/o/${landing.slug}/projects`);
}
