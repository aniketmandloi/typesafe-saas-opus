import * as schema from "@repo/schema";
import { drizzle } from "drizzle-orm/node-postgres";

// The raw handle. Fenced to exactly four callers (#3, #11): the backoffice
// directory, webhook handlers, the job runner and migrations. Everything else
// receives a TenantDb.
//
// No process.env: the connection string arrives from an entrypoint (ADR-0006).
export const createDb = (connectionString: string) => drizzle(connectionString, { schema });

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
