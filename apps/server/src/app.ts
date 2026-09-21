import { type ApiDeps, appRouter, createContext } from "@repo/api";
import { fetchRequestHandler } from "@trpc/server/adapters/fetch";
import { Hono } from "hono";

// C1 from #7: the app is a value and the entrypoint is a leaf. Nothing here
// imports `@hono/node-server`, `hono/aws-lambda` or `hono/vercel`, so this file
// is the same on every target and the differences stay in one directory.
//
// tRPC is mounted through its own fetch adapter rather than through
// `@hono/trpc-server`. That package injects `c.env` onto every tRPC context,
// which is precisely what C2 forbids reading, and it was last published in
// January 2026. Hono routes are Fetch-native, so the adapter needs no bridge.
//
// There is no `env(c)` call anywhere either, and that is ADR-0006 rather than
// an oversight: the entrypoint parses at module scope and hands the result in,
// so a request never asks its environment anything.

export const createApp = ({ deps }: { deps: ApiDeps }) => {
  const app = new Hono();

  // Deliberately dumb. It proves the process is up and serving, and nothing
  // else: a health check that touches the database turns a slow query into a
  // rolling restart.
  app.get("/health", (c) => c.json({ ok: true }));

  // Better Auth owns its whole route surface. The kit's own org-mutating
  // routes are fenced off it (ADR-0008), which is what makes every org-scoped
  // audit write an ordinary use-case write in our own transaction.
  app.all("/api/auth/*", (c) => deps.auth.handler(c.req.raw));

  app.all("/api/trpc/*", (c) =>
    fetchRequestHandler({
      endpoint: "/api/trpc",
      req: c.req.raw,
      router: appRouter,
      // Per request, never hoisted. A context built once at module scope
      // serves one caller's cookies to the next (#9).
      createContext: ({ req }) => createContext({ deps, headers: req.headers }),
    }),
  );

  return app;
};

export type App = ReturnType<typeof createApp>;
