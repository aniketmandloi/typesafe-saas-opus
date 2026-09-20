// Vercel discovers this as the function. Hono's Vercel entrypoint shape.
import { createApp } from "../src/app.ts";

const app = createApp({
  DATABASE_URL: process.env.DATABASE_URL!,
  S3_BUCKET: process.env.S3_BUCKET!,
  AWS_REGION: process.env.AWS_REGION!,
});

export default app.fetch;
