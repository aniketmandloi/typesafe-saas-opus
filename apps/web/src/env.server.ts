import { z } from "zod";

// `apps/web`'s own server schema — variables this app needs and no other
// deployment does, so they belong here rather than in `@repo/env` or in a
// profile (#15).
//
// Kept in a separate file from the public access map so the split is visible in
// `biome.json` rather than inferred: a server variable read from a module the
// browser bundles would inline as `undefined` and fail silently, which is the
// one failure mode this whole design exists to prevent. Importing this from a
// Client Component is a mistake the fence does not catch — adding the
// `server-only` package would make it a build error, and is the obvious
// hardening.
const schema = z.object({
  /**
   * Standard Deployment Protection intercepts server-to-server calls, so a
   * preview RSC render reaching the API gets a challenge page instead of data
   * (#9). Optional because only protected Vercel previews need it.
   */
  VERCEL_AUTOMATION_BYPASS_SECRET: z.string().min(1).optional(),
});

export const serverEnv = schema.parse(process.env);
