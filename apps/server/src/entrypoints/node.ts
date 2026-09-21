import { serve } from "@hono/node-server";
import { createLocalProfile } from "@repo/profiles";
import { z } from "zod";

import { createRuntime } from "../runtime.ts";

// The container entrypoint, and the one `pnpm dev` runs. Bare Node on the raw
// TypeScript, no bundler in watch mode (ADR-0010).
//
// Parsed at module scope, so a misconfigured deployment is a container that
// will not boot — loud and attributable — rather than a mystery 500 under load
// (ADR-0006). This is one of the few files permitted to read `process.env`.

const profile = createLocalProfile();

// PORT belongs to this entrypoint alone: Lambda and Vercel have no use for it,
// so it is not in any fragment (#15).
const schema = profile.serverSchema.extend({
  PORT: z.coerce.number().int().positive().default(3001),
});

const env = schema.parse(process.env);

const runtime = createRuntime({
  env,
  profile,
  // A container holds its process, so a real pool is both safe and wanted.
  target: { pool: { max: 10 } },
});

serve({ fetch: runtime.app.fetch, port: env.PORT });
