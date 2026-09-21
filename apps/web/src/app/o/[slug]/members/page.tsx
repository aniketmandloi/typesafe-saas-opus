import { createRscClient } from "../../../../trpc/rsc.ts";
import { resolveOrganization } from "../organization.ts";
import { InviteForm } from "./invite-form.tsx";

/**
 * Org settings, not the Admin app: ordinary tenant-scoped product surface with
 * no special powers (ADR-0005).
 */
export default async function MembersPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const organization = await resolveOrganization(slug);
  const client = await createRscClient(organization.organizationId);
  const members = await client.members.list.query();

  return (
    <main>
      <h1>{organization.name} members</h1>
      <ul>
        {members.map((member) => (
          <li key={member.userId}>
            {member.name} — {member.email} — {member.role}
          </li>
        ))}
      </ul>
      <InviteForm organizationId={organization.organizationId} />
    </main>
  );
}
