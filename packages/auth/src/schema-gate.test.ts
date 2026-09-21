import { createDb } from "@repo/db";
import { describe, expect, it } from "vitest";

import { createAuth } from "./auth.ts";

// ADR-0011's gate. The kit owns the Drizzle declaration of Better Auth's
// tables, so something has to prove that declaration still satisfies whatever
// version of Better Auth is installed. This is that proof.
//
// It must be *awaited*. `createBetterAuth` does
// `pendingSchemaCheck.catch(err => ctx.logger.error(...))`, so schema drift is
// a logged error and the instance serves traffic regardless — a test that only
// constructs the instance passes while the schema is broken.
//
// It needs no database: findDrizzleSchemaProblems introspects the Drizzle
// declaration object, not a live connection. So this runs on every pull
// request at unit-test speed, and the connection string below is never dialled.
// Built through createDb so it carries the schema the auth config now requires.
// A bare drizzle() handle has no schema attached, and the gate is about the
// schema.
const neverConnected = () =>
  createDb({ connectionString: "postgres://localhost:5432/unused-by-this-test", max: 1 });

const auth = () =>
  createAuth({
    db: neverConnected(),
    secret: "test-only-secret-at-least-thirty-two-characters",
    baseURL: "http://localhost:3000",
  });

describe("the auth declaration satisfies the installed Better Auth", () => {
  it("has a schema check at all", async () => {
    const ctx = await auth().$context;
    // If this fails, the adapter stopped registering a check and the gate is
    // silently doing nothing. That is worse than a failing gate.
    expect(ctx.checkSchema).toBeTypeOf("function");
  });

  it("reports no problems", async () => {
    const ctx = await auth().$context;
    await expect(ctx.checkSchema?.()).resolves.not.toThrow();
  });
});

// What this gate does and does not cover, established by nine mutations against
// a real instance (spike/schema-check). It enforces exactly the two rules
// `diffSchema` states:
//
//   caught:     missing table, missing column, extra NOT NULL column with no
//               default (Better Auth inserts without it)
//   tolerated:  extra nullable column (ADR-0007's deleted_at), extra nullable
//               column with a default, extra indexes of ours
//   NOT caught: renamed physical column, changed type, dropped .notNull() on a
//               column Better Auth writes, removed index
//
// Columns are matched on the Drizzle property name, never the physical column
// name — which is why a rename passes. The classes it misses are covered
// behaviourally by the Testcontainers sign-up → organization → invite test,
// where a wrong type shows up as a failing INSERT.
