import { createLocalProfile } from "@repo/profiles";
import { handle } from "hono/aws-lambda";

import { createRuntime } from "../runtime.ts";

// The Lambda entrypoint. Module scope runs during INIT, so a bad environment is
// an INIT failure visible at deploy-canary time rather than a mystery 500 under
// load (ADR-0006).

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
  // One connection per execution environment. Default concurrency is 1,000 and
  // each environment holds its own pool, so a pool of 10 here is up to 10,000
  // backends against a database that will not have them (C4 from #7).
  target: { pool: { max: 1 } },
});

export const handler = handle(runtime.app);
