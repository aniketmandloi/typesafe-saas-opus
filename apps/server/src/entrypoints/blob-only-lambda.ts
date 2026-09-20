// Static composition of the *other* provider: does the heavy SDK vanish?
import { Hono } from "hono";
import { blobStorage } from "@repo/storage-blob";

const app = new Hono();
const storage = blobStorage({ token: process.env.BLOB_TOKEN! });
app.get("/u", async (c) => c.json(await storage.presignUpload("k", "image/png")));
export const handler = app.fetch;
