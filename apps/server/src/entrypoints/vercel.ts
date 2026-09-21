import { createLocalProfile } from "@repo/profiles";

import { createRuntime } from "../runtime.ts";

// The Vercel entrypoint.
//
// Vercel's Hono support takes a **default export of the Hono app** and owns the
// handler signature itself. `hono/vercel`'s `handle()` — what this file used
// before anyone tried to deploy it — is the Next.js App Router shape, and
// `apps/server` is not a Next app: it built, which is all a typecheck can tell
// you, and would not have served. `src/index.ts` is the shim that puts this
// file at one of the paths Vercel looks in.
//
// **This entrypoint composes the local profile**, which means storage, email
// and the queue are fakes here. That is a deliberate first step and not an
// oversight: the target residue — handler signature, pool policy, module-scope
// parse — is what a deployment proves, and the adapter set is ADR-0006's other
// axis, which lands with the AWS and Vercel profiles. The database is real.
const profile = createLocalProfile();
const env = profile.serverSchema.parse(process.env);

const runtime = createRuntime({
  env,
  profile,
  // Fluid shares **one process across concurrent requests**, which is the
  // opposite of Lambda's isolate-per-request: one connection here would
  // serialise every concurrent caller through it (C4 from #7).
  target: { pool: { max: 10 } },
});

export default runtime.app;
