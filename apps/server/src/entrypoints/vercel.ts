import { createApp } from "../app.ts";
import "../jobs.ts";

const app = createApp({
  DATABASE_URL: process.env.DATABASE_URL!,
  S3_BUCKET: process.env.S3_BUCKET!,
  AWS_REGION: process.env.AWS_REGION!,
});

export const GET = app.fetch;
export const POST = app.fetch;
export default app.fetch;
