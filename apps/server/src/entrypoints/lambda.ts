import { handle } from "hono/aws-lambda";
import { createApp } from "../app.ts";
import "../jobs.ts";

const app = createApp({
  DATABASE_URL: process.env.DATABASE_URL!,
  S3_BUCKET: process.env.S3_BUCKET!,
  AWS_REGION: process.env.AWS_REGION!,
});

export const handler = handle(app);
