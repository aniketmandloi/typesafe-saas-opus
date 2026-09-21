import { createLocalProfile } from "@repo/profiles";
import { getRequestListener } from "@hono/node-server";

import { createRuntime } from "../runtime.ts";

// The Vercel entrypoint, and the input to `scripts/bundle-vercel.ts` rather
// than a file Vercel reads directly.
//
// **It is bundled for the same reason the Lambda asset is (#14).** The kit's
// packages are published as raw TypeScript (ADR-0010), and every Vercel
// builder that handles that transpiles the files in place while leaving each
// package's `exports` map pointing at `./src/index.ts`. The deployed function
// then cannot resolve its own dependencies. A bundle has no cross-package
// resolution left to get wrong.
//
// **This entrypoint composes the local profile**, so storage, email and the
// queue are fakes here. Deliberate first step: what a deployment proves is the
// target residue — handler signature, pool policy, module-scope parse — and the
// adapter set is ADR-0006's other axis. The database is real.
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

// A Node `(req, res)` listener, not a Web handler.
//
// The Build Output API hands the function straight to Vercel's Node launcher
// with no `@vercel/node` wrapping in between, so a handler that takes a
// `Request` and returns a `Response` is never read: nothing writes to `res`
// and the request hangs until it times out. Observed, not reasoned about.
//
// `shouldAddHelpers` stays off in `.vc-config.json` for the matching reason —
// the helpers consume the request stream to populate `req.body`, which leaves
// this listener waiting for a body that has already been read. That is the
// most likely mechanism behind honojs/node-server#306, where POST hangs on
// Vercel while GET works.
export default getRequestListener(runtime.app.fetch);
