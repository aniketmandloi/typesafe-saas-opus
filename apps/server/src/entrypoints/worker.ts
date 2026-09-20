// Job worker: the only entrypoint that reaches the native module.
import { handleThumbnail } from "../jobs.ts";

const drain = async () => {
  await handleThumbnail({ projectId: "p", key: "k" });
};
export const handler = drain;
