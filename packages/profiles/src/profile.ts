import type { EmailAdapter } from "@repo/email";
import type { EnvFragment } from "@repo/env";
import type { JobQueue } from "@repo/jobs";
import type { StorageAdapter } from "@repo/storage";
import type { z } from "zod";

// A deployment profile is the set of Adapters one deployment composes, and
// therefore the exact environment variables that deployment requires (#15,
// ADR-0006).
//
// The unit is a profile, not a target: adapter choice follows *where* you
// deploy, not *how* you are invoked. An AWS deployment picks S3, SES and SQS
// whether it lands on Fargate or Lambda, so the list is written once. What
// stays with the entrypoint is the target residue #7 enumerated — pool policy,
// OTel registration, handler signature.
//
// The worker shares the serving deployment's profile and brings its own
// entrypoint: same deployment, same adapters, it just drains instead of serves.

export type Adapters = {
  storage: StorageAdapter;
  email: EmailAdapter;
  queue: JobQueue;
};

export type DeploymentProfile<TSchema extends z.ZodObject = z.ZodObject> = {
  name: string;
  /** Every fragment this deployment's adapters and the kit itself declare. */
  fragments: EnvFragment[];
  /** The composed schema, and the one thing an entrypoint parses. */
  serverSchema: TSchema;
  /**
   * Built from an already-parsed environment. The profile never reads
   * `process.env` itself — the entrypoint parses once, at module scope, so a
   * misconfigured deployment fails to boot rather than failing per request
   * (ADR-0006).
   */
  createAdapters(env: z.infer<TSchema>): Adapters;
};

export const defineProfile = <TSchema extends z.ZodObject>(profile: {
  name: string;
  fragments: EnvFragment[];
  serverSchema: TSchema;
  createAdapters: (env: z.infer<TSchema>) => Adapters;
}): DeploymentProfile<TSchema> => profile;
