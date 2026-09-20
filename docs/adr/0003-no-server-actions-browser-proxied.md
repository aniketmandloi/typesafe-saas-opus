# No Server Actions, and the browser reaches the API through a rewrite

`apps/web` contains no server-side data code: every read and write leaves over HTTP to `apps/server`, exactly as the mobile app does. Two consequences are recorded here because both look like mistakes from the inside, and a future reader will try to correct them.

**Server Actions are banned for anything touching domain data.** A Next app that never uses them looks like an oversight. It isn't: `apps/web` may not import server packages, so the only legal Server Action is one that calls tRPC over HTTP — which creates a third mutation path (browser → Next server → API server) that exists on web and not on mobile. One contract exists so the two clients do the same thing; a web-only mutation path is the divergence it was built to prevent. The cost is form ergonomics — `useActionState`, progressive enhancement, no-JS submission — judged acceptable for B2B SaaS behind an auth wall. Next-internal concerns that touch no domain data (OG images, health checks, revalidation triggers) are unaffected.

**Browser API calls go through a `next.config` rewrite rather than straight to the API.** The extra hop looks like something to remove. It is load-bearing: the browser is the only caller relying on the browser to attach the session cookie automatically, and `vercel.app` is on the Public Suffix List, so two Vercel projects on their default domains are *cross-site* and no cookie is sent. The rewrite makes browser calls same-origin, so preview deployments work on stock domains with no DNS setup and no CORS configuration.

The RSC and mobile paths are unaffected by any of this, because both set the `Cookie` header explicitly and `SameSite` governs only automatic attachment.

## Consequences

The API base URL cannot be derived from `VERCEL_URL`, `VERCEL_BRANCH_URL` or `VERCEL_PROJECT_PRODUCTION_URL` — all three describe the web deployment, not the sibling API — so it is an explicit typed environment variable.

A cloner who configures `app.` and `api.` under one custom apex may point the browser directly at the API and drop the rewrite. The rewrite is the zero-configuration default, not a constraint.

If the API is deployed to Vercel with Deployment Protection enabled, server-to-server calls from a preview RSC require the `x-vercel-protection-bypass` header.
