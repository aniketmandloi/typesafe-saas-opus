import * as schema from "@repo/schema";
import { drizzle } from "drizzle-orm/node-postgres";

// The raw handle. Fenced to exactly four callers (#3, #11): the backoffice
// directory, webhook handlers, the job runner and migrations. Everything else
// receives a TenantDb.
//
// No process.env: the connection string arrives from an entrypoint (ADR-0006).
export const createDb = (connectionString: string) => drizzle(connectionString, { schema });

export type Database = ReturnType<typeof createDb>;
