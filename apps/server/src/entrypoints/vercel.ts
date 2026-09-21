import { createLocalProfile } from "@repo/profiles";
import { handle } from "hono/vercel";

import { createRuntime } from "../runtime.ts";

// The Vercel entrypoint.

// **This entrypoint composes the local profile, because it is the only profile
// that exists yet.** That is one import, and it is the one line that changes
// when the AWS and Vercel profiles land — which is ADR-0006's split doing its
// job: the profile owns *which adapters*, this file owns the target residue
// (handler signature, pool policy, and where the parse happens). What is proved
// here today is the residue, not the adapter set. Do not deploy it as is: it
// would serve fakes.
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

const fetchHandler = handle(runtime.app);

export const GET = fetchHandler;
export const POST = fetchHandler;
export const PUT = fetchHandler;
export const PATCH = fetchHandler;
export const DELETE = fetchHandler;
export const OPTIONS = fetchHandler;
