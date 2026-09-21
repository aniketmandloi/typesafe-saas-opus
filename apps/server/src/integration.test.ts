import { connectTestDatabase, migrateTestDatabase, resolveTestDatabase } from "@repo/api/testing";
import { ORGANIZATION_HEADER } from "@repo/core";
import type { Database } from "@repo/db";
import { createLocalProfile } from "@repo/profiles";
import { member, organization, user } from "@repo/schema";
import { inArray } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { createRuntime } from "./runtime.ts";

// Auth context, end to end, over HTTP against a real Postgres.
//
// The whole app is in-process: `app.request()` is Hono's own Fetch entry, so
// nothing is listening on a port. What this proves is the part the unit tests
// cannot — that a session cookie minted by Better Auth is read back by
// `createContext`, resolves to an Actor, and reaches a tenant-scoped procedure.

let db: Database;
let stop: () => Promise<void>;
let runtime: ReturnType<typeof createRuntime>;

const signedUp: string[] = [];

beforeAll(async () => {
  const resolved = await resolveTestDatabase();
  stop = resolved.stop;
  db = connectTestDatabase(resolved.url);
  await migrateTestDatabase(db);

  const profile = createLocalProfile();
  const env = profile.serverSchema.parse({
    DATABASE_URL: resolved.url,
    BETTER_AUTH_SECRET: "test-only-secret-at-least-thirty-two-characters",
    APP_URL: "http://localhost:3000",
  });
  runtime = createRuntime({ env, profile, target: { pool: { max: 2 } } });
}, 120_000);

afterAll(async () => {
  // Better Auth writes through its own adapter and commits, so these rows
  // cannot ride a rolled-back transaction the way the rest of the suite does.
  // Cleaning up by hand is the honest cost of exercising the real sign-up path
  // instead of fabricating a session.
  if (signedUp.length > 0) {
    const owned = await db
      .select({ id: member.organizationId })
      .from(member)
      .where(inArray(member.userId, signedUp));
    if (owned.length > 0) {
      await db.delete(organization).where(
        inArray(
          organization.id,
          owned.map((one) => one.id),
        ),
      );
    }
    await db.delete(user).where(inArray(user.id, signedUp));
  }
  await db.$client.end();
  await runtime.db.$client.end();
  await stop();
});

const signUp = async () => {
  const email = `ada-${crypto.randomUUID().slice(0, 8)}@example.com`;
  const response = await runtime.app.request("/api/auth/sign-up/email", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ email, password: "correct-horse-battery-staple", name: "Ada" }),
  });
  const body = (await response.json()) as { user?: { id: string } };
  if (body.user?.id) signedUp.push(body.user.id);
  return { response, cookie: response.headers.get("set-cookie") ?? "", email };
};

const organizationsOf = async (cookie: string) => {
  const response = await runtime.app.request("/api/trpc/organizations.list", {
    headers: { cookie },
  });
  const body = (await response.json()) as {
    result?: { data: { organizationId: string; isPersonal: boolean; roles: string[] }[] };
  };
  return { status: response.status, rows: body.result?.data ?? [] };
};

describe("a session cookie minted by Better Auth reaches a tenant-scoped procedure", () => {
  it("signs up and returns a session cookie", async () => {
    const { response, cookie } = await signUp();
    expect(response.status).toBe(200);
    expect(cookie).toMatch(/session_token=/);
  });

  // #3: there is no org-less mode, and the signup hook is what makes that true.
  it("auto-creates a Personal Organization at signup", async () => {
    const { cookie } = await signUp();
    const { status, rows } = await organizationsOf(cookie);
    expect(status).toBe(200);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ isPersonal: true, roles: ["owner"] });
  });

  it("resolves the Actor and serves that Organization's Projects", async () => {
    const { cookie } = await signUp();
    const { rows } = await organizationsOf(cookie);

    const projects = await runtime.app.request("/api/trpc/projects.list", {
      headers: { cookie, [ORGANIZATION_HEADER]: rows[0]?.organizationId ?? "" },
    });
    expect(projects.status).toBe(200);
    await expect(projects.json()).resolves.toMatchObject({ result: { data: [] } });
  });

  it("refuses a real session against an Organization it does not belong to", async () => {
    const mine = await signUp();
    const theirs = await signUp();
    const { rows } = await organizationsOf(theirs.cookie);

    const response = await runtime.app.request("/api/trpc/projects.list", {
      headers: { cookie: mine.cookie, [ORGANIZATION_HEADER]: rows[0]?.organizationId ?? "" },
    });
    expect(response.status).toBe(404);
  });

  it("refuses a request with no cookie at all", async () => {
    const response = await runtime.app.request("/api/trpc/organizations.list");
    expect(response.status).toBe(401);
  });
});
