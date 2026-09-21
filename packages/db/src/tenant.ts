import { isDark, type OrgRole, parseRoles } from "@repo/core";
import { member, organization, user } from "@repo/schema";
import { and, eq, type SQL } from "drizzle-orm";
import type { PgColumn, PgTable } from "drizzle-orm/pg-core";

import type { Executor } from "./client.ts";

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

/**
 * What a tenant may change about its own Organization row.
 *
 * `id` is the tenant key and `deletedAt` is the Dark marker, and both are
 * absent on purpose: no interactive path deletes or undeletes an Organization
 * (ADR-0007), so leaving the column out here means no tenant-scoped code can
 * reach it at all.
 */
export type OrganizationUpdate = Partial<
  Omit<typeof organization.$inferInsert, "id" | "deletedAt">
>;

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
  /**
   * The tenant's own Organization row.
   *
   * It is the one tenant row whose tenant key is its primary key, so it is
   * unreachable through `select`/`update` above — those predicate on an
   * `organizationId` column the `organization` table does not have. Without
   * these two the boundary would be incomplete, and promoting a personal
   * Organization in place (#3's growth path) would need the raw handle.
   */
  organization(): TenantQuery<typeof organization.$inferSelect>;
  updateOrganization(set: OrganizationUpdate): TenantQuery<typeof organization.$inferSelect>;
  /**
   * This Organization's memberships, with the identity each one names.
   *
   * `select` above is single-table by construction, and a member's email lives
   * on `user`, which has no tenant column — so the member list is a read the
   * seam cannot express without help. The answer is a named operation rather
   * than a join escape hatch: an escape hatch takes the predicate back off, and
   * that predicate is the entire boundary. Adding one named read per crossing
   * keeps them countable.
   */
  members(): TenantQuery<TenantMember>;
};

export type TenantMember = {
  userId: string;
  email: string;
  name: string;
  role: string | null;
  createdAt: Date;
};

// Drizzle's builder generics are invariant and do not accept a structurally
// typed `PgTable & { organizationId }`. The casts are confined to these four
// lines, each immediately after the predicate has been applied, and the public
// signatures above stay precise — which is where callers actually need them.
// biome-ignore lint/suspicious/noExplicitAny: drizzle's builder generics reject a structural table type
type AnyBuilder = any;

export const createTenantDb = (db: Executor, organizationId: string): TenantDb => ({
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
  organization() {
    return db
      .select()
      .from(organization)
      .where(eq(organization.id, organizationId)) as unknown as TenantQuery<
      typeof organization.$inferSelect
    >;
  },
  members() {
    return db
      .select({
        userId: member.userId,
        email: user.email,
        name: user.name,
        role: member.role,
        createdAt: member.createdAt,
      })
      .from(member)
      .innerJoin(user, eq(user.id, member.userId))
      .where(eq(member.organizationId, organizationId)) as unknown as TenantQuery<TenantMember>;
  },
  updateOrganization(set) {
    // Stripped at runtime, not merely omitted from the type. `update` above
    // already learned this: a type that leaves a column out stops an honest
    // caller, and a cast walks straight past it.
    const { id: _id, deletedAt: _deletedAt, ...rest } = set as Record<string, unknown>;
    return db
      .update(organization)
      .set(rest)
      .where(eq(organization.id, organizationId))
      .returning() as unknown as TenantQuery<typeof organization.$inferSelect>;
  },
});

// A Dark Organization refuses to open (ADR-0007). One nullable column is the
// whole mechanism, and checking it here means every tenant-scoped path inherits
// the refusal instead of each use case remembering to ask.
export const openTenantDb = async (db: Executor, organizationId: string): Promise<TenantDb> => {
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

export class NotAMemberError extends Error {
  organizationId: string;
  userId: string;
  constructor(organizationId: string, userId: string) {
    super(`User ${userId} is not a member of organization ${organizationId}.`);
    this.name = "NotAMemberError";
    this.organizationId = organizationId;
    this.userId = userId;
  }
}

export type TenantSession = {
  tenant: TenantDb;
  roles: OrgRole[];
};

/**
 * Resolve one caller's standing in one Organization, and hand back a TenantDb
 * bound to it.
 *
 * The membership lookup runs on the raw handle, which is the point: this is the
 * function that *establishes* the boundary, so it cannot be behind it. Keeping
 * it here rather than in the procedure means every unscoped read in the kit's
 * request path lives in this one reviewed file — ADR-0001 accepts having no
 * backstop on the condition that the surface stays small.
 *
 * One indexed lookup per request on `member(organizationId, userId)`. Not
 * cached in v1 (#3).
 */
export const openTenantSession = async (
  db: Executor,
  organizationId: string,
  userId: string,
): Promise<TenantSession> => {
  const tenant = await openTenantDb(db, organizationId);

  const rows = await db
    .select({ role: member.role })
    .from(member)
    .where(and(eq(member.organizationId, organizationId), eq(member.userId, userId)))
    .limit(1);

  const membership = rows[0];
  if (!membership) throw new NotAMemberError(organizationId, userId);

  return { tenant, roles: parseRoles(membership.role) };
};
