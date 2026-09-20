import { thumbnail } from "@repo/images";
import type { JobHandler } from "@repo/jobs";

export const handleThumbnail: JobHandler<"project.thumbnail"> = async (payload) => {
  const out = await thumbnail(Buffer.from(payload.key));
  console.log(out.byteLength);
};
