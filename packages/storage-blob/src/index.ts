import { del, put } from "@vercel/blob";
import type { Storage } from "@repo/storage";

export const blobStorage = (config: { token: string }): Storage => ({
  presignUpload: async (key, contentType) => {
    const res = await put(key, new Blob([]), { access: "public", contentType, token: config.token });
    return { url: res.url };
  },
  presignDownload: async (key) => `https://blob.vercel-storage.com/${key}`,
  delete: async (key) => {
    await del(key, { token: config.token });
  },
});
