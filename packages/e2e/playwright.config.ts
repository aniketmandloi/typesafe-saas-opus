import { defineConfig } from "@playwright/test";

const WEB_PORT = 3100;
const API_PORT = 3101;
const APP_URL = `http://localhost:${WEB_PORT}`;
const API_URL = `http://localhost:${API_PORT}`;

// Ports deliberately off the defaults, so a spec never quietly passes against
// a dev server someone left running.
// Read lazily, because global setup is what puts this there when Docker is
// providing the database. Reading it at module scope would capture the value
// from before the container started.
const databaseUrl = () => process.env.TEST_DATABASE_URL ?? "";

// This package is neither an App nor a Package as CONTEXT.md defines them: it
// is not deployable and nothing imports it. It lives in `packages/` because it
// has to live somewhere, and it is `server`-tagged because it talks to Postgres
// — which is exactly why it could not stay inside `apps/web`, whose `web` tag
// forbids importing @repo/db. The graph checker caught that.
export default defineConfig({
  testDir: "./src",
  // Starts the database before either server boots, and stops it afterwards.
  globalSetup: "./src/global-setup.ts",
  // One worker, no parallelism, one browser. This suite exists to prove the
  // flow composes, not to be fast, and a kit that needs a large machine to run
  // its own tests is a kit a cloner cannot run.
  workers: 1,
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: 0,
  reporter: [["list"]],
  timeout: 60_000,
  use: {
    baseURL: APP_URL,
    trace: "retain-on-failure",
    headless: true,
  },
  // Chromium alone. Three engines is three downloads and three times the
  // memory for a suite whose job is to prove the flow composes.
  projects: [{ name: "chromium", use: { browserName: "chromium" } }],
  webServer: [
    {
      // Bare Node on the raw TypeScript (ADR-0010) — the same entrypoint
      // `pnpm dev` runs, so the spec exercises the real one.
      command: "node ../../apps/server/src/entrypoints/node.ts",
      url: `${API_URL}/health`,
      reuseExistingServer: !process.env.CI,
      stdout: "pipe",
      stderr: "pipe",
      env: {
        PORT: String(API_PORT),
        DATABASE_URL: databaseUrl(),
        BETTER_AUTH_SECRET: "e2e-only-secret-at-least-thirty-two-characters",
        // The user-facing app, not this server: it is what Better Auth trusts
        // as an Origin and what invitation links point at.
        APP_URL,
      },
    },
    {
      // `next start` on a production build, never `next dev`. The dev server
      // carries a Turbopack watcher and HMR for no benefit here, and the
      // build has already happened by the time this runs.
      // Build and start here rather than in a root script, so the API URL has
      // exactly one definition. Next inlines `NEXT_PUBLIC_API_URL` at build
      // time, so a build that did not see it would produce a bundle calling
      // `undefined/api/trpc` — or, because the env gate parses at module
      // scope, fail outright. Driven through pnpm because this package is not
      // apps/web and must not import it: nothing imports an app (#2).
      command: `pnpm --filter @repo/web exec next build && pnpm --filter @repo/web exec next start -p ${WEB_PORT}`,
      url: APP_URL,
      // A production build on a small machine still needs a moment.
      timeout: 180_000,
      reuseExistingServer: !process.env.CI,
      stdout: "pipe",
      stderr: "pipe",
      env: { NEXT_PUBLIC_API_URL: API_URL },
    },
  ],
});
