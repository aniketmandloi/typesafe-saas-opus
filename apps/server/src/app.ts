import { Hono } from "hono";
import { trpcServer } from "@hono/trpc-server";
import { makePool, tenantDb } from "@repo/db";
import { s3Storage } from "@repo/storage-s3";
import { appRouter } from "./router.ts";

// Composition root: the entrypoint picks adapters statically. @repo/storage-blob
// exists in the workspace and is never referenced here — the tree-shaking test.
export const createApp = (env: { DATABASE_URL: string; S3_BUCKET: string; AWS_REGION: string }) => {
  const pool = makePool(env.DATABASE_URL);
  const storage = s3Storage({ bucket: env.S3_BUCKET, region: env.AWS_REGION });
  const app = new Hono();
  app.get("/health", (c) => c.json({ ok: true }));
  app.use("/trpc/*", trpcServer({
    router: appRouter,
    createContext: (_opts, c) => {
      const organizationId = c.req.header("x-organization-id") ?? "";
      return { db: tenantDb(pool, organizationId), storage, organizationId };
    },
  }));
  return app;
};
