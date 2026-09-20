import { z } from "zod";

export const jobPayloads = {
  "project.thumbnail": z.object({ projectId: z.string(), key: z.string() }),
} as const;

export type JobName = keyof typeof jobPayloads;
export type JobPayload<N extends JobName> = z.infer<(typeof jobPayloads)[N]>;
export type JobHandler<N extends JobName> = (payload: JobPayload<N>) => Promise<void>;
