import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createDb, type Database, type Executor } from "@repo/db";
import { migrate } from "drizzle-orm/node-postgres/migrator";

/**
 * Where the integration suite gets a Postgres.
 *
 * Two sources, in order, and **never a skip**. A suite that quietly passes
 * because no database was reachable is worse than one that is missing: it
 * reports green for the one assertion [ADR-0001](../../../../docs/adr/0001-application-level-tenant-scoping.md)
 * names as its only hedge.
 *
 * 1. `TEST_DATABASE_URL`, for a local Postgres.
 * 2. Otherwise a Testcontainers Postgres, which is what CI uses (#8) because it
 *    is hermetic and needs no shared server.
 *
 * If neither is available this throws, loudly, naming both.
 */
export const resolveTestDatabase = async (): Promise<{
  url: string;
  stop: () => Promise<void>;
}> => {
  const provided = process.env.TEST_DATABASE_URL;
  if (provided) return { url: provided, stop: async () => {} };

  try {
    const { PostgreSqlContainer } = await import("@testcontainers/postgresql");
    const container = await new PostgreSqlContainer("postgres:17-alpine").start();
    return {
      url: container.getConnectionUri(),
      stop: () => container.stop().then(() => undefined),
    };
  } catch (cause) {
    throw new Error(
      "The integration suite needs a Postgres. Set TEST_DATABASE_URL, or run a Docker daemon so Testcontainers can start one. " +
        `Testcontainers failed with: ${cause instanceof Error ? cause.message : String(cause)}`,
    );
  }
};

const migrationsFolder = join(dirname(fileURLToPath(import.meta.url)), "../../../db/migrations");

export const migrateTestDatabase = async (db: Database) => {
  await migrate(db, { migrationsFolder });
};

export const connectTestDatabase = (url: string): Database =>
  createDb({ connectionString: url, max: 1 });

class Rollback extends Error {
  constructor() {
    super("rollback");
    this.name = "Rollback";
  }
}

/**
 * Run one test's work inside a transaction and roll it back.
 *
 * The use cases open transactions of their own, so what the callback receives
 * is an outer transaction and every `mutate()` inside it opens a **savepoint**.
 * That nesting is the thing this wrapper actually exercises — if Drizzle's
 * savepoints did not work, every test here would either leak rows or fail to
 * see its own writes.
 */
export const inRolledBackTransaction = async (
  db: Database,
  work: (tx: Executor) => Promise<void>,
): Promise<void> => {
  try {
    await db.transaction(async (tx) => {
      await work(tx);
      throw new Rollback();
    });
  } catch (cause) {
    if (!(cause instanceof Rollback)) throw cause;
  }
};
