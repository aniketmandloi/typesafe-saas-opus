import { defineConfig } from "drizzle-kit";

// `generate` only. `push` is not used anywhere, including dev (ADR-0012): it
// diffs against a live database and applies silently, which makes it
// unreviewable and — worse — would happily drop the append-only trigger it
// knows nothing about. A dev shortcut that diverges from the deploy path is how
// that trigger goes missing in production only.
//
// `dbCredentials` is deliberately absent. Nothing here connects: generation
// diffs the schema against the committed migration journal, and the only
// connection string in this kit's migration story is the direct one the
// `migrate` profile requires at deploy time.
export default defineConfig({
  dialect: "postgresql",
  schema: "./packages/schema/src/index.ts",
  out: "./packages/db/migrations",
  casing: "snake_case",
  strict: true,
  verbose: true,
});
