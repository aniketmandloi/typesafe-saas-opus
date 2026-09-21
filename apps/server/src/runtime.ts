import type { ApiDeps } from "@repo/api";
import { createAuth } from "@repo/auth";
import { createDb } from "@repo/db";
import type { DeploymentProfile } from "@repo/profiles";

import { createApp } from "./app.ts";
import { createJobHandlers } from "./handlers.ts";

/**
 * Everything the kit itself requires, whatever profile is composed on top.
 *
 * Named structurally rather than inferred from one profile's schema, because
 * every profile composes these three fragments and none of them belong to an
 * adapter.
 */
export type KitEnv = {
  DATABASE_URL: string;
  BETTER_AUTH_SECRET: string;
  APP_URL: string;
};

/**
 * The target residue, and all of it (#7).
 *
 * `max` is here rather than in the profile because the profile describes
 * *where* a deployment runs and this describes *how it is invoked* — and those
 * differ sharply for the same adapters. Lambda's default concurrency of 1,000
 * against a pool of 10 is up to 10,000 backends; Vercel Fluid shares one
 * process across concurrent requests and wants the opposite.
 */
export type TargetConfig = {
  pool: { max: number };
};

export const createRuntime = <TEnv extends KitEnv>({
  env,
  profile,
  target,
}: {
  env: TEnv;
  profile: DeploymentProfile;
  target: TargetConfig;
}) => {
  const db = createDb({ connectionString: env.DATABASE_URL, max: target.pool.max });
  const adapters = profile.createAdapters(env);

  const auth = createAuth({
    db,
    secret: env.BETTER_AUTH_SECRET,
    baseURL: env.APP_URL,
  });

  const deps: ApiDeps = {
    db,
    auth,
    storage: adapters.storage,
    queue: adapters.queue,
  };

  return {
    db,
    auth,
    adapters,
    deps,
    handlers: createJobHandlers({ email: adapters.email, appUrl: env.APP_URL }),
    app: createApp({ deps }),
  };
};

export type ServerRuntime = ReturnType<typeof createRuntime>;
