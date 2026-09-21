import { project, upload } from "@repo/schema";
import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";

import { createDb, type Database } from "./client.ts";
import {
  createTenantDb,
  DarkOrganizationError,
  openTenantDb,
  UnknownOrganizationError,
} from "./tenant.ts";

// No database is dialled. Drizzle compiles a statement without a connection, so
// these assert what SQL the seam *can produce* — which is exactly the
// by-construction claim ADR-0001 makes and explicitly does not back with RLS.
const db = createDb("postgres://localhost:5432/never-connected");
const ORG = "org_a";
const tenant = createTenantDb(db, ORG);

describe("every statement carries the tenant predicate", () => {
  it("scopes a select", () => {
    const { sql, params } = tenant.select(project).toSQL();
    expect(sql).toContain('"organization_id" = $1');
    expect(params).toEqual([ORG]);
  });

  it("keeps the tenant predicate when the caller adds their own", () => {
    const { sql, params } = tenant.select(project, eq(project.name, "Apollo")).toSQL();
    expect(sql).toContain('"organization_id" = $1');
    expect(sql).toContain('"name" = $2');
    expect(params).toEqual([ORG, "Apollo"]);
  });

  it("scopes an update", () => {
    const { sql, params } = tenant.update(project, { name: "Renamed" }).toSQL();
    // The placeholder index is not pinned: the schema's $onUpdate on updated_at
    // injects a parameter, and asserting $2 would break on an unrelated column.
    expect(sql).toMatch(/where "project"\."organization_id" = \$\d+/);
    expect(params.at(-1)).toBe(ORG);
    expect(params).toContain("Renamed");
  });

  it("scopes a delete", () => {
    const { sql, params } = tenant.delete(project).toSQL();
    expect(sql).toContain('"organization_id" = $1');
    expect(params).toEqual([ORG]);
  });

  it("scopes every tenant table, not just project", () => {
    const { sql, params } = tenant.select(upload).toSQL();
    expect(sql).toContain('"organization_id" = $1');
    expect(params).toEqual([ORG]);
  });
});

describe("the tenant a row lands in is not the caller's to choose", () => {
  it("stamps the bound organization on insert", () => {
    const { params } = tenant
      .insert(project, { id: "p1", name: "Apollo", createdBy: "u1" })
      .toSQL();
    expect(params).toContain(ORG);
  });

  it("overwrites a caller-supplied organizationId rather than merging it", () => {
    const { params } = tenant
      .insert(project, {
        id: "p1",
        name: "Apollo",
        // A use case has no business naming this, and a hostile one would name
        // someone else's. Typed away, and overwritten even when cast past.
        organizationId: "org_victim",
      } as never)
      .toSQL();
    expect(params).toContain(ORG);
    expect(params).not.toContain("org_victim");
  });

  it("refuses to move a row between tenants on update", () => {
    const { params } = tenant
      .update(project, { organizationId: "org_victim", name: "Renamed" } as never)
      .toSQL();
    expect(params).not.toContain("org_victim");
    expect(params.at(-1)).toBe(ORG);
    expect(params).toContain("Renamed");
  });
});

describe("the seam offers no way out", () => {
  it("exposes only scoped operations", () => {
    // If someone adds a passthrough later, this fails. The value of the wrapper
    // is entirely in what it does *not* have.
    expect(Object.keys(tenant).sort()).toEqual([
      "delete",
      "insert",
      "organizationId",
      "select",
      "update",
    ]);
  });
});

describe("a Dark Organization refuses to open", () => {
  const stubDb = (row: { deletedAt: Date | null } | undefined) =>
    ({
      select: () => ({
        from: () => ({
          where: () => ({
            limit: async () => (row ? [row] : []),
          }),
        }),
      }),
    }) as unknown as Database;

  it("opens a live Organization", async () => {
    const opened = await openTenantDb(stubDb({ deletedAt: null }), ORG);
    expect(opened.organizationId).toBe(ORG);
  });

  it("refuses a soft-deleted Organization", async () => {
    await expect(openTenantDb(stubDb({ deletedAt: new Date() }), ORG)).rejects.toBeInstanceOf(
      DarkOrganizationError,
    );
  });

  it("refuses an Organization that does not exist", async () => {
    await expect(openTenantDb(stubDb(undefined), ORG)).rejects.toBeInstanceOf(
      UnknownOrganizationError,
    );
  });
});
