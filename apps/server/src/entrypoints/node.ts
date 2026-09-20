import { serve } from "@hono/node-server";
import { createApp } from "../app.ts";
import "../jobs.ts";

const app = createApp({
  DATABASE_URL: process.env.DATABASE_URL!,
  S3_BUCKET: process.env.S3_BUCKET!,
  AWS_REGION: process.env.AWS_REGION!,
});

if (process.env.SPIKE_NO_LISTEN !== "1") {
  serve({ fetch: app.fetch, port: 3001 });
}
export default app;
