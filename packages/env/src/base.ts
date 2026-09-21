import { z } from "zod";

import { fragment, shortScalar } from "./fragment.ts";

// The pooled connection every serving deployment uses.
export const databaseFragment = fragment("database", {
  DATABASE_URL: shortScalar(),
});

// The migration runner's connection, and the only thing its profile requires
// (ADR-0012). Migrations use session state that poolers forbid, so this is a
// second, direct endpoint — deliberately absent from the server's schema, so a
// leaked server environment cannot bypass the pooler.
export const directDatabaseFragment = fragment("database-direct", {
  DATABASE_URL_DIRECT: shortScalar(),
});

export const authFragment = fragment("auth", {
  BETTER_AUTH_SECRET: shortScalar().refine((value) => value.length >= 32, {
    message: "BETTER_AUTH_SECRET must be at least 32 characters.",
  }),
  APP_URL: z.url(),
});

// AWS credentials are deliberately absent from every fragment. The SDK resolves
// its own chain from instance roles or web identity tokens, and a schema
// requiring AWS_ACCESS_KEY_ID would fail a correctly configured Fargate task
// that has none (#15).
