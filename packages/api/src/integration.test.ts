import { ORGANIZATION_HEADER } from "@repo/core";
import { createTenantDb, type Database, type Executor } from "@repo/db";
import { createFakeQueue } from "@repo/jobs";
import { auditEvent, member, organization, project, user } from "@repo/schema";
import { createFakeStorage } from "@repo/storage";
import { TRPCError } from "@trpc/server";
import { eq, sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import type { Actor, RequestContext } from "./context.ts";
import type { ApiDeps } from "./deps.ts";
import { appRouter } from "./index.ts";
import {
  connectTestDatabase,
  inRolledBackTransaction,
  migrateTestDatabase,
  resolveTestDatabase,
} from "./testing/database.ts";
import { createCallerFactory } from "./trpc.ts";

// The second of #8's three example tests, and the one ADR-0001 calls its only
// hedge: "if the TenantDb wrapper has a bug, there is no second line of
// defence". Everything else in this repo asserts what SQL the seam *can
// produce*. This asserts what Postgres actually does with it.

let db: Database;
let stop: () => Promise<void>;

beforeAll(async () => {
  const resolved = await resolveTestDatabase();
  stop = resolved.stop;
  db = connectTestDatabase(resolved.url);
  await migrateTestDatabase(db);
}, 120_000);

afterAll(async () => {
  await db.$client.end();
  await stop();
});

const ACTOR_A: Actor = {
  userId: "user_a",
  email: "ada@example.com",
  name: "Ada",
  impersonatedBy: null,
};

/** Two Organizations, two users, one Project each. The fixture the whole file turns on. */
const seed = async (tx: Executor) => {
  await tx.insert(user).values([
    { id: "user_a", name: "Ada", email: "ada@example.com", updatedAt: new Date() },
    { id: "user_b", name: "Grace", email: "grace@example.com", updatedAt: new Date() },
    { id: "user_c", name: "Alan", email: "alan@example.com", updatedAt: new Date() },
  ]);

  await tx.insert(organization).values([
    { id: "org_a", name: "Org A", slug: "org-a", createdAt: new Date(), isPersonal: true },
    { id: "org_b", name: "Org B", slug: "org-b", createdAt: new Date(), isPersonal: false },
  ]);

  await tx.insert(member).values([
    { id: "m_a", organizationId: "org_a", userId: "user_a", role: "owner", createdAt: new Date() },
    { id: "m_b", organizationId: "org_b", userId: "user_b", role: "owner", createdAt: new Date() },
  ]);

  await tx.insert(project).values([
    { id: "p_a", organizationId: "org_a", name: "A's project", createdBy: "user_a" },
    { id: "p_b", organizationId: "org_b", name: "B's secret", createdBy: "user_b" },
  ]);
};

const contextFor = (tx: Executor, actor: Actor, organizationId: string | null): RequestContext => ({
  deps: {
    db: tx,
    auth: undefined as never,
    storage: createFakeStorage(),
    queue: createFakeQueue(),
  } satisfies Partial<ApiDeps> as ApiDeps,
  headers: new Headers(organizationId ? { [ORGANIZATION_HEADER]: organizationId } : {}),
  actor,
  organizationId,
});

const caller = (ctx: RequestContext) => createCallerFactory(appRouter)(ctx);

/**
 * The Postgres error behind a Drizzle one.
 *
 * Drizzle wraps every failure as "Failed query: <sql>" and hangs the driver's
 * error off `cause`, so asserting on `.message` would pass for *any* failing
 * statement — including one that failed because the trigger was missing and the
 * syntax was wrong. Walking the chain is what makes these assertions about the
 * trigger rather than about the query failing somehow.
 */
const causeMessages = (error: unknown): string => {
  const parts: string[] = [];
  let current: unknown = error;
  while (current instanceof Error) {
    parts.push(current.message);
    current = (current as { cause?: unknown }).cause;
  }
  return parts.join(" | ");
};

const rejectionOf = async (run: Promise<unknown>): Promise<string> => {
  try {
    await run;
    return "no-error";
  } catch (error) {
    return causeMessages(error);
  }
};

const codeOf = async (run: Promise<unknown>) => {
  try {
    await run;
    return "no-error";
  } catch (error) {
    return error instanceof TRPCError ? error.code : `unexpected: ${String(error)}`;
  }
};

describe("ADR-0001's hedge: a request scoped to org A cannot read org B", () => {
  it("lists only its own Organization's Projects", async () => {
    await inRolledBackTransaction(db, async (tx) => {
      await seed(tx);
      const projects = await caller(contextFor(tx, ACTOR_A, "org_a")).projects.list();
      expect(projects.map((one) => one.id)).toEqual(["p_a"]);
    });
  });

  it("cannot read another Organization's Project by id", async () => {
    await inRolledBackTransaction(db, async (tx) => {
      await seed(tx);
      // The id is real, the row exists, and the caller is a legitimate signed-in
      // member of a different tenant. This is the exact attack ADR-0001 accepts
      // it has no database-level defence against.
      const code = await codeOf(
        caller(contextFor(tx, ACTOR_A, "org_a")).projects.update({ id: "p_b", name: "pwned" }),
      );
      expect(code).toBe("NOT_FOUND");

      const [untouched] = await tx.select().from(project).where(eq(project.id, "p_b"));
      expect(untouched?.name).toBe("B's secret");
    });
  });

  it("cannot delete another Organization's Project", async () => {
    await inRolledBackTransaction(db, async (tx) => {
      await seed(tx);
      expect(
        await codeOf(caller(contextFor(tx, ACTOR_A, "org_a")).projects.delete({ id: "p_b" })),
      ).toBe("NOT_FOUND");

      const rows = await tx.select().from(project).where(eq(project.id, "p_b"));
      expect(rows).toHaveLength(1);
    });
  });

  it("cannot name an Organization it does not belong to", async () => {
    await inRolledBackTransaction(db, async (tx) => {
      await seed(tx);
      // NOT_FOUND rather than FORBIDDEN: confirming org_b exists to a caller who
      // only guessed the id would turn the header into a probe.
      expect(await codeOf(caller(contextFor(tx, ACTOR_A, "org_b")).projects.list())).toBe(
        "NOT_FOUND",
      );
    });
  });

  it("cannot write into another tenant by supplying its id", async () => {
    await inRolledBackTransaction(db, async (tx) => {
      await seed(tx);
      const tenant = createTenantDb(tx, "org_a");
      // TenantDb overwrites organizationId rather than merging it. Asserted here
      // against a real INSERT, not just against generated SQL.
      const [created] = await tenant.insert(project, {
        // `id` is supplied because TenantDb does not mint one — use cases do,
        // and the column has no default. Found by this test failing on a NOT
        // NULL violation rather than on the assertion it was written for.
        id: "p_smuggled",
        organizationId: "org_b",
        name: "smuggled",
      } as never);
      expect(created?.organizationId).toBe("org_a");
    });
  });

  it("refuses a Dark Organization to its own owner", async () => {
    await inRolledBackTransaction(db, async (tx) => {
      await seed(tx);
      await tx
        .update(organization)
        .set({ deletedAt: new Date() })
        .where(eq(organization.id, "org_a"));

      expect(await codeOf(caller(contextFor(tx, ACTOR_A, "org_a")).projects.list())).toBe(
        "NOT_FOUND",
      );
    });
  });
});

describe("nested transactions: a use case opens one inside the test's own", () => {
  it("sees its own write and audits it in the same savepoint", async () => {
    await inRolledBackTransaction(db, async (tx) => {
      await seed(tx);
      const created = await caller(contextFor(tx, ACTOR_A, "org_a")).projects.create({
        name: "Apollo",
        description: null,
      });

      const projects = await caller(contextFor(tx, ACTOR_A, "org_a")).projects.list();
      expect(projects.map((one) => one.name).sort()).toEqual(["A's project", "Apollo"]);

      const audits = await tx.select().from(auditEvent).where(eq(auditEvent.subjectId, created.id));
      expect(audits[0]).toMatchObject({
        organizationId: "org_a",
        actorId: "user_a",
        actorType: "member",
        action: "project.created",
        subjectDisplay: "Apollo",
      });
    });
  });

  it("rolls the savepoint back when the use case throws, audit included", async () => {
    await inRolledBackTransaction(db, async (tx) => {
      await seed(tx);
      const before = await tx.select().from(auditEvent);

      expect(
        await codeOf(
          caller(contextFor(tx, ACTOR_A, "org_a")).projects.update({ id: "p_b", name: "x" }),
        ),
      ).toBe("NOT_FOUND");

      // The outer transaction is still usable, which is the savepoint working:
      // an inner failure that aborted the whole transaction would make this throw.
      const after = await tx.select().from(auditEvent);
      expect(after).toHaveLength(before.length);
      await expect(caller(contextFor(tx, ACTOR_A, "org_a")).projects.list()).resolves.toHaveLength(
        1,
      );
    });
  });
});

describe("ADR-0008's append-only trigger, asserted by behaviour", () => {
  const anEntry = {
    id: "audit_1",
    organizationId: "org_a",
    actorId: "user_a",
    actorType: "member",
    actorDisplay: "ada@example.com",
    action: "project.created",
    subjectType: "project",
    subjectId: "p_a",
    subjectDisplay: "A's project",
  };

  it("rejects a DELETE, even on the raw handle", async () => {
    await inRolledBackTransaction(db, async (tx) => {
      await seed(tx);
      await tx.insert(auditEvent).values(anEntry);
      expect(await rejectionOf(tx.delete(auditEvent).where(eq(auditEvent.id, "audit_1")))).toMatch(
        /append-only/,
      );
    });
  });

  it("rejects an UPDATE to anything but the display columns", async () => {
    await inRolledBackTransaction(db, async (tx) => {
      await seed(tx);
      await tx.insert(auditEvent).values(anEntry);
      expect(
        await rejectionOf(
          tx
            .update(auditEvent)
            .set({ action: "project.deleted" })
            .where(eq(auditEvent.id, "audit_1")),
        ),
      ).toMatch(/only actor_display and subject_display/);
    });
  });

  it("permits scrubbing the display columns, which is ADR-0007's erasure path", async () => {
    await inRolledBackTransaction(db, async (tx) => {
      await seed(tx);
      await tx.insert(auditEvent).values(anEntry);
      await tx
        .update(auditEvent)
        .set({ actorDisplay: null, subjectDisplay: null })
        .where(eq(auditEvent.id, "audit_1"));

      const [scrubbed] = await tx.select().from(auditEvent).where(eq(auditEvent.id, "audit_1"));
      expect(scrubbed).toMatchObject({
        actorDisplay: null,
        subjectDisplay: null,
        action: "project.created",
      });
    });
  });

  it("holds against a statement that names no columns at all", async () => {
    await inRolledBackTransaction(db, async (tx) => {
      await seed(tx);
      await tx.insert(auditEvent).values(anEntry);
      // A DELETE with no WHERE is the shape an incident actually takes.
      expect(await rejectionOf(tx.execute(sql`delete from audit_event`))).toMatch(/append-only/);
    });
  });
});

describe("the slice's own flow: invite, accept, then read as a member", () => {
  const ACTOR_C: Actor = {
    userId: "user_c",
    email: "alan@example.com",
    name: "Alan",
    impersonatedBy: null,
  };

  const invite = (tx: Executor, queue: ReturnType<typeof createFakeQueue>) => {
    const ctx = contextFor(tx, ACTOR_A, "org_a");
    ctx.deps.queue = queue;
    return caller(ctx).members.invite({ email: "alan@example.com", role: "member" });
  };

  it("promotes the inviter's personal Organization in place", async () => {
    await inRolledBackTransaction(db, async (tx) => {
      await seed(tx);
      const [before] = await tx.select().from(organization).where(eq(organization.id, "org_a"));
      expect(before?.isPersonal).toBe(true);

      await invite(tx, createFakeQueue());

      const [after] = await tx.select().from(organization).where(eq(organization.id, "org_a"));
      // Nothing was created and nothing moved. That is #3's growth path: the
      // Organization is promoted, never replaced.
      expect(after?.isPersonal).toBe(false);
      expect(after?.id).toBe("org_a");
    });
  });

  it("enqueues the invitation email with the payload the handler expects", async () => {
    await inRolledBackTransaction(db, async (tx) => {
      await seed(tx);
      const queue = createFakeQueue();
      const created = await invite(tx, queue);

      expect(queue.jobs).toHaveLength(1);
      expect(queue.jobs[0]).toMatchObject({ name: "email.send" });
      expect(queue.jobs[0]?.payload).toMatchObject({
        to: "alan@example.com",
        template: "organization-invitation",
        variables: { invitationId: created.id, organizationName: "Org A", inviterName: "Ada" },
      });
    });
  });

  it("lets the invited user accept, and only then see the Organization's Projects", async () => {
    await inRolledBackTransaction(db, async (tx) => {
      await seed(tx);
      const created = await invite(tx, createFakeQueue());

      // Before accepting, Alan is not a member and the tenant does not exist
      // as far as he is concerned.
      expect(await codeOf(caller(contextFor(tx, ACTOR_C, "org_a")).projects.list())).toBe(
        "NOT_FOUND",
      );

      await caller(contextFor(tx, ACTOR_C, null)).members.accept({ invitationId: created.id });

      const projects = await caller(contextFor(tx, ACTOR_C, "org_a")).projects.list();
      expect(projects.map((one) => one.id)).toEqual(["p_a"]);
    });
  });

  it("refuses a second acceptance, at the unique index", async () => {
    await inRolledBackTransaction(db, async (tx) => {
      await seed(tx);
      const created = await invite(tx, createFakeQueue());
      const accept = () =>
        caller(contextFor(tx, ACTOR_C, null)).members.accept({ invitationId: created.id });

      await accept();
      // The invitation is no longer pending, so this is refused before the
      // index is reached — but the index is what makes the race safe, and
      // member(organization_id, user_id) is asserted unique in @repo/db.
      expect(await codeOf(accept())).toBe("NOT_FOUND");

      const members = await caller(contextFor(tx, ACTOR_A, "org_a")).members.list();
      expect(members.filter((one) => one.userId === "user_c")).toHaveLength(1);
    });
  });

  it("refuses an invitation addressed to someone else", async () => {
    await inRolledBackTransaction(db, async (tx) => {
      await seed(tx);
      const created = await invite(tx, createFakeQueue());
      const wrongPerson: Actor = { ...ACTOR_C, userId: "user_b", email: "grace@example.com" };
      expect(
        await codeOf(
          caller(contextFor(tx, wrongPerson, null)).members.accept({ invitationId: created.id }),
        ),
      ).toBe("NOT_FOUND");
    });
  });

  it("writes one audit entry per intent, in the acting Organization", async () => {
    await inRolledBackTransaction(db, async (tx) => {
      await seed(tx);
      const created = await invite(tx, createFakeQueue());
      await caller(contextFor(tx, ACTOR_C, null)).members.accept({ invitationId: created.id });

      const entries = await tx
        .select()
        .from(auditEvent)
        .where(eq(auditEvent.organizationId, "org_a"));
      expect(entries.map((one) => one.action).sort()).toEqual([
        "member.invitation.accepted",
        "member.invited",
      ]);
      // The accepted entry is attributed to the person who accepted, not to the
      // inviter: an actor is who acted, never who caused it.
      const accepted = entries.find((one) => one.action === "member.invitation.accepted");
      expect(accepted?.actorId).toBe("user_c");
    });
  });

  it("refuses to invite someone who is already a member", async () => {
    await inRolledBackTransaction(db, async (tx) => {
      await seed(tx);
      expect(
        await codeOf(
          caller(contextFor(tx, ACTOR_A, "org_a")).members.invite({
            // Case deliberately differs: the addresses are compared folded,
            // because a capitalised invite that silently never matches is a
            // support ticket nobody diagnoses.
            email: "ADA@example.com",
            role: "member",
          }),
        ),
      ).toBe("CONFLICT");
    });
  });

  it("lists members with the identity behind each membership", async () => {
    await inRolledBackTransaction(db, async (tx) => {
      await seed(tx);
      const members = await caller(contextFor(tx, ACTOR_A, "org_a")).members.list();
      expect(members).toEqual([
        expect.objectContaining({ userId: "user_a", email: "ada@example.com", role: "owner" }),
      ]);
    });
  });
});
