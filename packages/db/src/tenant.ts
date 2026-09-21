import { isDark } from "@repo/core";
import { organization } from "@repo/schema";
import { and, eq, type SQL } from "drizzle-orm";
import type { PgColumn, PgTable } from "drizzle-orm/pg-core";

import type { Database } from "./client.ts";

// Tenant isolation is application-level and enforced by construction
// (ADR-0001). A use case never receives the raw handle: it receives a TenantDb
// already bound to one Organization, and every statement it can build carries
// the predicate. Forgetting to scope a query is not a mistake reachable through
// this interface, because the interface has no unscoped method.
//
// ADR-0001 accepts in writing that this wrapper has no backstop — no RLS, no
// database-level guarantee. The integration test asserting org A cannot read
// org B is that hedge; the .toSQL() assertions beside this file are the cheap
// first line, and they need no database at all.

export type TenantTable = PgTable & { organizationId: PgColumn };

/**
 * What a TenantDb method hands back: awaitable for the rows, and inspectable
 * for the SQL. Drizzle's builders are both at runtime; this names only the part
 * the seam promises, so a use case cannot reach past it into the query builder
 * and widen the scope it was given.
 */
export type TenantQuery<TRow> = PromiseLike<TRow[]> & {
  toSQL(): { sql: string; params: unknown[] };
};

type InsertValues<TTable extends TenantTable> = Omit<TTable["$inferInsert"], "organizationId">;

const scoped = (table: TenantTable, organizationId: string, extra?: SQL): SQL => {
  const tenant = eq(table.organizationId, organizationId);
  if (!extra) return tenant;
  const combined = and(tenant, extra);
  if (!combined) throw new Error("Unreachable: and() of two defined conditions");
  return combined;
};

export class DarkOrganizationError extends Error {
  organizationId: string;
  constructor(organizationId: string) {
    super(
      `Organization ${organizationId} is deleted and awaiting purge. No tenant work may run against it.`,
    );
    this.name = "DarkOrganizationError";
    this.organizationId = organizationId;
  }
}

export class UnknownOrganizationError extends Error {
  organizationId: string;
  constructor(organizationId: string) {
    super(`Organization ${organizationId} does not exist.`);
    this.name = "UnknownOrganizationError";
    this.organizationId = organizationId;
  }
}

export type TenantDb = {
  readonly organizationId: string;
  select<TTable extends TenantTable>(
    table: TTable,
    where?: SQL,
  ): TenantQuery<TTable["$inferSelect"]>;
  insert<TTable extends TenantTable>(
    table: TTable,
    values: InsertValues<TTable>,
  ): TenantQuery<TTable["$inferSelect"]>;
  update<TTable extends TenantTable>(
    table: TTable,
    set: Partial<InsertValues<TTable>>,
    where?: SQL,
  ): TenantQuery<TTable["$inferSelect"]>;
  delete<TTable extends TenantTable>(
    table: TTable,
    where?: SQL,
  ): TenantQuery<TTable["$inferSelect"]>;
};

// Drizzle's builder generics are invariant and do not accept a structurally
// typed `PgTable & { organizationId }`. The casts are confined to these four
// lines, each immediately after the predicate has been applied, and the public
// signatures above stay precise — which is where callers actually need them.
// biome-ignore lint/suspicious/noExplicitAny: drizzle's builder generics reject a structural table type
type AnyBuilder = any;

export const createTenantDb = (db: Database, organizationId: string): TenantDb => ({
  organizationId,
  select(table, where) {
    return (db.select() as AnyBuilder)
      .from(table)
      .where(scoped(table, organizationId, where)) as AnyBuilder;
  },
  insert(table, values) {
    // The caller's organizationId is overwritten, never merged. A use case that
    // supplies one is confused or hostile, and neither should choose the tenant
    // a row lands in.
    return (db.insert(table as AnyBuilder) as AnyBuilder)
      .values({ ...values, organizationId })
      .returning() as AnyBuilder;
  },
  update(table, set, where) {
    const { organizationId: _pinned, ...rest } = set as Record<string, unknown>;
    return (db.update(table as AnyBuilder) as AnyBuilder)
      .set(rest)
      .where(scoped(table, organizationId, where))
      .returning() as AnyBuilder;
  },
  delete(table, where) {
    return (db.delete(table as AnyBuilder) as AnyBuilder)
      .where(scoped(table, organizationId, where))
      .returning() as AnyBuilder;
  },
});

// A Dark Organization refuses to open (ADR-0007). One nullable column is the
// whole mechanism, and checking it here means every tenant-scoped path inherits
// the refusal instead of each use case remembering to ask.
export const openTenantDb = async (db: Database, organizationId: string): Promise<TenantDb> => {
  const rows = await db
    .select({ deletedAt: organization.deletedAt })
    .from(organization)
    .where(eq(organization.id, organizationId))
    .limit(1);

  const org = rows[0];
  if (!org) throw new UnknownOrganizationError(organizationId);
  if (isDark(org)) throw new DarkOrganizationError(organizationId);

  return createTenantDb(db, organizationId);
};
