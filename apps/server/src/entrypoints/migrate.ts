import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createDb } from "@repo/db";
import { migrateProfile } from "@repo/profiles";
import { sql } from "drizzle-orm";
import { migrate } from "drizzle-orm/node-postgres/migrator";

// The fourth entrypoint (ADR-0012). It runs as a one-shot job before a new
// revision serves traffic, never at application boot: on Lambda and Vercel, N
// cold starts would race the same migration with no coordination, and the dev
// loop restarts constantly besides.
//
// It composes the `migrate` profile — the only one holding the direct,
// non-pooled connection string, and the only one composing no adapters at all.

const env = migrateProfile.serverSchema.parse(process.env);

// One connection, because there is one job. A pool would be the wrong shape for
// a process that holds a session-level lock and exits.
const db = createDb({ connectionString: env.DATABASE_URL_DIRECT, max: 1 });

// Drizzle's Postgres migrator has **no locking**. It reads the watermark from
// `__drizzle_migrations`, then applies every pending migration in one
// transaction — which gives atomicity, not mutual exclusion, so two concurrent
// runners read the same watermark and both apply. Serialising in the pipeline
// is not a promise this kit can make: it does not own the cloner's CI, and
// rollbacks are exactly when two deploys overlap.
//
// Session-level rather than transaction-level, because `migrate()` opens its
// own transaction and the lock has to outlive it. The pinning hazard advisory
// locks carry under RDS Proxy cannot arise here — this connection is the direct
// one by construction.
const LOCK_KEY = 8_534_220_119_204_137n;

const migrationsFolder = join(
  dirname(fileURLToPath(import.meta.url)),
  "../../../../packages/db/migrations",
);

await db.execute(sql`select pg_advisory_lock(${LOCK_KEY})`);
try {
  await migrate(db, { migrationsFolder });
  console.log("Migrations applied.");
} finally {
  await db.execute(sql`select pg_advisory_unlock(${LOCK_KEY})`);
  await db.$client.end();
}
