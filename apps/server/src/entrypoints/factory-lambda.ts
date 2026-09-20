// Counterfactual for ADR-0004: adapter chosen at run time by env var.
import { Hono } from "hono";
import { s3Storage } from "@repo/storage-s3";
import { blobStorage } from "@repo/storage-blob";
import type { Storage } from "@repo/storage";

const pick = (): Storage =>
  process.env.STORAGE_DRIVER === "blob"
    ? blobStorage({ token: process.env.BLOB_TOKEN! })
    : s3Storage({ bucket: process.env.S3_BUCKET!, region: process.env.AWS_REGION! });

const app = new Hono();
const storage = pick();
app.get("/u", async (c) => c.json(await storage.presignUpload("k", "image/png")));
export const handler = app.fetch;
