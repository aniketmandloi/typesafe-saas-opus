import { eq, and } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import { projects, type NewProject } from "@repo/schema";

export const makePool = (connectionString: string) => new Pool({ connectionString, max: 1 });

export const tenantDb = (pool: Pool, organizationId: string) => {
  const db = drizzle(pool);
  return {
    listProjects: () =>
      db.select().from(projects).where(eq(projects.organizationId, organizationId)),
    createProject: (input: Omit<NewProject, "organizationId">) =>
      db.insert(projects).values({ ...input, organizationId }).returning(),
    findProject: (id: string) =>
      db.select().from(projects)
        .where(and(eq(projects.id, id), eq(projects.organizationId, organizationId))),
  };
};
export type TenantDb = ReturnType<typeof tenantDb>;
