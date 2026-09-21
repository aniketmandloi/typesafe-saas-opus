import { createRscClient } from "../../../../trpc/rsc.ts";
import { resolveOrganization } from "../organization.ts";
import { NewProjectForm } from "./new-project-form.tsx";
import { UploadForm } from "./upload-form.tsx";

export default async function ProjectsPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const organization = await resolveOrganization(slug);

  // A fresh client for this render, carrying this request's cookie and this
  // Organization's id. Never hoisted (#9).
  const client = await createRscClient(organization.organizationId);
  const projects = await client.projects.list.query();

  return (
    <main>
      <h1>{organization.name}</h1>
      <nav>
        <a href={`/o/${slug}/members`}>Members</a>
      </nav>

      <h2>Projects</h2>
      <ul>
        {projects.map((project) => (
          <li key={project.id}>{project.name}</li>
        ))}
      </ul>

      <NewProjectForm organizationId={organization.organizationId} />
      <UploadForm organizationId={organization.organizationId} />
    </main>
  );
}
