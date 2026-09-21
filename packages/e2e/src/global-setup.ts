import { connectTestDatabase, migrateTestDatabase, resolveTestDatabase } from "@repo/api/testing";

// Playwright drives two server *processes*, so unlike the vitest suites it
// cannot hold a Testcontainers handle inside the test. The container is started
// here instead and its URL handed to the servers through the environment.
//
// Same resolution order as everywhere else, and the same refusal to skip:
// TEST_DATABASE_URL if set, otherwise Docker, otherwise a loud failure. #8
// accepted in writing that Docker is a hard prerequisite for running the kit's
// tests; this is where that lands for the browser suite.
let stop: (() => Promise<void>) | undefined;

const globalSetup = async () => {
  const resolved = await resolveTestDatabase();
  stop = resolved.stop;

  // Migrated once for the whole run. The browser suite cannot wrap tests in a
  // rolled-back transaction the way the vitest suites do — the work happens in
  // another process — so the spec cleans up after itself instead.
  const db = connectTestDatabase(resolved.url);
  await migrateTestDatabase(db);
  await db.$client.end();

  process.env.TEST_DATABASE_URL = resolved.url;

  return async () => {
    await stop?.();
  };
};

export default globalSetup;
