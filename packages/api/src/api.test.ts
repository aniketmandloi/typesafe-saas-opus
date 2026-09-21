import type { Database } from "@repo/db";
import { auditEvent, member, organization, project } from "@repo/schema";
import { TRPCError } from "@trpc/server";
import { describe, expect, it, vi } from "vitest";

import { mutate } from "./audit.ts";
import { type Actor, ORGANIZATION_HEADER, type RequestContext } from "./context.ts";
import type { ApiDeps } from "./deps.ts";
import { appRouter } from "./index.ts";
import { createCallerFactory } from "./trpc.ts";

// No database is dialled. These assert what the *gate* decides — who reaches a
// tenant and what answer they get when they do not — which is the half of
// ADR-0001 that lives here. The half that lives in SQL is asserted in
// @repo/db's own tests, and the half that only a real Postgres can prove (org A
// cannot read org B across a live connection) is the Testcontainers test this
// environment has no Docker for.

type Rows = { organization?: unknown[]; member?: unknown[]; project?: unknown[] };

const stubDb = (rows: Rows) => {
  const rowsFor = (table: unknown) =>
    rows[table === organization ? "organization" : table === member ? "member" : "project"] ?? [];

  // `where()` has to be awaitable *and* chainable onto `.limit()`: openTenantDb
  // limits its lookup, the tenant seam does not, and both go through here.
  const where = (result: unknown[]) => {
    const query = Promise.resolve(result) as Promise<unknown[]> & {
      limit: () => Promise<unknown[]>;
    };
    query.limit = async () => result;
    return query;
  };

  return {
    select: () => ({
      from: (table: unknown) => ({
        where: () => where(rowsFor(table)),
        innerJoin: () => ({ where: () => where(rowsFor(table)) }),
      }),
    }),
  } as unknown as Database;
};

const ACTOR: Actor = {
  userId: "user_a",
  email: "ada@example.com",
  name: "Ada",
  impersonatedBy: null,
};

const ORG = "org_a";

const context = (over: {
  db: Database;
  actor?: Actor | null;
  organizationId?: string | null;
}): RequestContext => ({
  deps: { db: over.db } as unknown as ApiDeps,
  headers: new Headers({ [ORGANIZATION_HEADER]: over.organizationId ?? "" }),
  actor: over.actor === undefined ? ACTOR : over.actor,
  organizationId: over.organizationId === undefined ? ORG : over.organizationId,
});

const caller = (ctx: RequestContext) => createCallerFactory(appRouter)(ctx);

const live = [{ deletedAt: null }];

const codeOf = async (run: Promise<unknown>) => {
  try {
    await run;
    return "no-error";
  } catch (error) {
    return error instanceof TRPCError ? error.code : "not-a-trpc-error";
  }
};

describe("a call reaches a tenant only by naming one the caller belongs to", () => {
  it("refuses an unauthenticated caller", async () => {
    const ctx = context({ db: stubDb({}), actor: null });
    expect(await codeOf(caller(ctx).projects.list())).toBe("UNAUTHORIZED");
  });

  it("refuses a caller who names no Organization", async () => {
    const ctx = context({ db: stubDb({}), organizationId: null });
    expect(await codeOf(caller(ctx).projects.list())).toBe("BAD_REQUEST");
  });

  // The next three are the same answer on purpose. FORBIDDEN would confirm
  // that an Organization exists to someone who only guessed its id.
  it("answers NOT_FOUND for an Organization that does not exist", async () => {
    const ctx = context({ db: stubDb({ organization: [] }) });
    expect(await codeOf(caller(ctx).projects.list())).toBe("NOT_FOUND");
  });

  it("answers NOT_FOUND for an Organization the caller is not in", async () => {
    const ctx = context({ db: stubDb({ organization: live, member: [] }) });
    expect(await codeOf(caller(ctx).projects.list())).toBe("NOT_FOUND");
  });

  it("answers NOT_FOUND for a Dark Organization, to its own members", async () => {
    const ctx = context({
      db: stubDb({ organization: [{ deletedAt: new Date() }], member: [{ role: "owner" }] }),
    });
    expect(await codeOf(caller(ctx).projects.list())).toBe("NOT_FOUND");
  });
});

describe("the permission is the procedure's, not the caller's word for it", () => {
  const withRole = (role: string, rows: Rows = {}) =>
    context({ db: stubDb({ organization: live, member: [{ role }], ...rows }) });

  it("lets a member read Projects", async () => {
    const rows = [{ id: "p1", name: "Apollo" }];
    await expect(caller(withRole("member", { project: rows })).projects.list()).resolves.toEqual(
      rows,
    );
  });

  it("refuses a member who tries to delete one", async () => {
    const ctx = withRole("member");
    expect(await codeOf(caller(ctx).projects.delete({ id: "p1" }))).toBe("FORBIDDEN");
  });

  it("lets an admin delete one", async () => {
    // Reaching the use case at all is the assertion: the gate passed, so the
    // failure below comes from the stub having no transaction, not from RBAC.
    const ctx = withRole("admin");
    expect(await codeOf(caller(ctx).projects.delete({ id: "p1" }))).not.toBe("FORBIDDEN");
  });

  it("reads roles through the CSV column Better Auth stores them in", async () => {
    const ctx = withRole("member,admin");
    expect(await codeOf(caller(ctx).projects.delete({ id: "p1" }))).not.toBe("FORBIDDEN");
  });
});

describe("a mutation carries its audit entry into the same transaction", () => {
  const recordingDb = () => {
    const written: { table: unknown; values: Record<string, unknown> }[] = [];
    const tx = {
      insert: (table: unknown) => ({
        values: (values: Record<string, unknown>) => ({
          returning: async () => {
            written.push({ table, values });
            return [values];
          },
        }),
      }),
    };
    const db = {
      transaction: (run: (tx: unknown) => Promise<unknown>) => run(tx),
    } as unknown as Database;
    return { db, written };
  };

  it("writes the entry with the acting member and the named tenant", async () => {
    const { db, written } = recordingDb();

    await mutate(db, ORG, ACTOR, {
      work: async (tenant) => {
        const [row] = await tenant.insert(project, { id: "p1", name: "Apollo" });
        return row as { id: string; name: string };
      },
      audit: (row) => ({
        action: "project.created",
        subjectType: "project",
        subjectId: row.id,
        subjectDisplay: row.name,
      }),
    });

    const entry = written.find((one) => one.table === auditEvent);
    expect(entry?.values).toMatchObject({
      organizationId: ORG,
      actorId: ACTOR.userId,
      actorType: "member",
      actorDisplay: ACTOR.email,
      action: "project.created",
      subjectId: "p1",
      subjectDisplay: "Apollo",
    });
  });

  it("names the subject the work produced, not one guessed beforehand", async () => {
    const { db } = recordingDb();
    const audit = vi.fn(() => ({
      action: "project.created" as const,
      subjectType: "project",
      subjectId: "p1",
      subjectDisplay: "Apollo",
    }));

    await mutate(db, ORG, ACTOR, {
      work: async () => ({ id: "p1" }),
      audit,
    });

    expect(audit).toHaveBeenCalledWith({ id: "p1" });
  });

  // Asserted by tsc, never run: the point is that this shape does not build.
  // If `mutate` ever stopped requiring an audit entry, the suppression below
  // would become unused and typecheck would fail on it — so this test cannot
  // rot into passing for the wrong reason.
  it("does not compile without an audit entry", () => {
    const neverCalled = (db: Database) =>
      // @ts-expect-error auditing is a required argument (ADR-0008), so
      // omitting it is a build failure rather than a gap discovered during an
      // incident. The error lands on the argument, not on the missing key.
      mutate(db, ORG, ACTOR, {
        work: async () => ({ id: "p1" }),
      });
    expect(neverCalled).toBeTypeOf("function");
  });
});
