import type { Project } from "@repo/schema";

export const canRename = (p: Project, orgId: string): boolean =>
  p.organizationId === orgId;

export const slugify = (name: string): string =>
  name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
