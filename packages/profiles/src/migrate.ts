import { composeServerSchema, directDatabaseFragment } from "@repo/env";

import { defineProfile, type NoAdapters } from "./profile.ts";

// A profile composing **zero adapters**, which looks degenerate and is the
// point (ADR-0012).
//
// The migrator needs no storage, no email and no queue. Sharing `apps/server`'s
// profile would make a migration job demand S3 and SES credentials it will
// never use, and the deployment profile is the composition unit precisely so
// that a deployment requires exactly its providers' variables (#15).
//
// It is also the only profile holding the **direct, non-pooled** connection
// string. Migrations use session state that poolers forbid, and keeping the
// direct URL out of the server's schema means a leaked server environment
// cannot bypass the pooler.
const fragments = [directDatabaseFragment] as const;
const serverSchema = composeServerSchema(...fragments);

export const migrateProfile = defineProfile<typeof serverSchema, NoAdapters>({
  name: "migrate",
  fragments: [...fragments],
  serverSchema,
  createAdapters: () => ({}),
});
