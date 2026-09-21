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

// PORT belongs to this entrypoint alone: Lambda and Vercel have no use for it,
// so it is not in any fragment (#15). Parsed before the profile because the
// profile now needs it — the fake storage this profile wires serves its own
// bytes from this process, so the URLs it presigns have to name this port.
const PORT = z.coerce.number().int().positive().default(3001).parse(process.env.PORT);

// `localhost` is the limit of what this process can know about itself. A
// browser on this machine can send to it; a phone on the LAN cannot, so a
// device running `apps/mobile` against a laptop gets a presigned URL it cannot
// reach. That is a property of the fake, not of the upload flow — a deployed
// profile presigns against the provider's own host.
const profile = createLocalProfile({ storageBaseUrl: `http://localhost:${PORT}/__storage` });

const env = profile.serverSchema.parse(process.env);

const runtime = createRuntime({
  env,
  profile,
  // A container holds its process, so a real pool is both safe and wanted.
  target: { pool: { max: 10 } },
  storageTransfer: (request) => profile.fakes.storage.handle(request),
});

serve({ fetch: runtime.app.fetch, port: PORT });
