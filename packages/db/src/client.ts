import * as schema from "@repo/schema";
import { drizzle } from "drizzle-orm/node-postgres";
import { Pool, type PoolConfig } from "pg";

// The raw handle. Fenced to a short list of callers (#3, #11, ADR-0001):
// the admin surface, webhook handlers, the job runner, migrations, and the two
// request-path reads that establish the tenant boundary rather than sit behind
// it. Everything else receives a TenantDb.
//
// No process.env: configuration arrives from an entrypoint (ADR-0006).
//
// The pool is built here and its policy is passed in, never decided here (C4
// from #7). The numbers are not a preference — Lambda's default concurrency of
// 1,000 against a default pool of 10 is up to 10,000 backends, while Vercel
// Fluid shares one process across concurrent requests and wants the opposite —
// so the only place that can know is the entrypoint.
export type DbConfig = {
  connectionString: string;
  /** Per-process pool ceiling. The entrypoint sets it; there is no default worth having. */
  max: number;
} & Omit<PoolConfig, "connectionString" | "max">;

export const createDb = ({ connectionString, max, ...pool }: DbConfig) =>
  drizzle(new Pool({ connectionString, max, ...pool }), { schema });

export type Database = ReturnType<typeof createDb>;

// The handle a transaction hands its callback. Not assignable to Database — it
// has no `$client` — so anything meant to run both inside and outside a
// transaction has to name this union rather than Database.
export type Transaction = Parameters<Parameters<Database["transaction"]>[0]>[0];

/**
 * Whatever can run a statement. Use cases open a transaction and bind a
 * TenantDb to the handle it yields, so the tenant boundary has to compose with
 * transactions or it is only half a boundary.
 */
export type Executor = Database | Transaction;
