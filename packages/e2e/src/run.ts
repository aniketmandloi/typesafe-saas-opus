import { spawn } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { connectTestDatabase, migrateTestDatabase, resolveTestDatabase } from "@repo/api/testing";

// The browser suite's database has to exist **before Playwright starts**, so it
// cannot come from a `globalSetup`.
//
// That is not a preference, it is the lifecycle: Playwright evaluates the
// config and launches `webServer` *before* global setup runs. Verified rather
// than assumed — a probe logged the webServer env being read ten seconds
// before global setup began — and CI proved the cost, with the API server
// exiting on an empty DATABASE_URL while a container was still starting.
//
// So this script owns the database and Playwright is its child. One mechanism,
// identical locally and in CI: TEST_DATABASE_URL if set, otherwise Docker,
// otherwise a loud failure.

const here = dirname(fileURLToPath(import.meta.url));

const { url, stop } = await resolveTestDatabase();

// Migrated once for the whole run. The browser suite cannot wrap each test in
// a rolled-back transaction the way the vitest suites do — the work happens in
// other processes — so the spec cleans up after itself instead.
const db = connectTestDatabase(url);
await migrateTestDatabase(db);
await db.$client.end();

const child = spawn(
  join(here, "../node_modules/.bin/playwright"),
  ["test", ...process.argv.slice(2)],
  {
    stdio: "inherit",
    env: { ...process.env, TEST_DATABASE_URL: url },
  },
);

let stopped = false;
const shutdown = async (code: number) => {
  if (stopped) return;
  stopped = true;
  await stop();
  process.exit(code);
};

child.on("exit", (code, signal) => void shutdown(signal ? 1 : (code ?? 1)));
// A container outliving an interrupted run is how a laptop ends up with a
// dozen stray Postgres instances.
for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.on(signal, () => {
    child.kill(signal);
  });
}
