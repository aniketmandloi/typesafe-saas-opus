// Static import that is never referenced at all.
import { Hono } from "hono";
import { blobStorage } from "@repo/storage-blob";
import { s3Storage } from "@repo/storage-s3";

const app = new Hono();
const storage = blobStorage({ token: process.env.BLOB_TOKEN! });
app.get("/u", async (c) => c.json(await storage.presignUpload("k", "image/png")));
export const handler = app.fetch;
