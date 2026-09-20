# Entrypoints parse environment variables; packages never do

Configuration is validated at module scope inside an entrypoint, and no package ever reads `process.env`. Packages receive their config as an argument.

This **reverses C3** from the portability constraints, which forbade module-scope parsing outright. C3 was correct for its time and for a reason specific to one target: on Cloudflare Workers, configuration exists only on the request context, so a module-scope `parse(process.env)` silently yields `{}`. Workers is no longer a deployment target (ADR-0002), and on containers, Lambda and Vercel `process.env` is fully populated before the first module evaluates. The prohibition has therefore been narrowed to its surviving half — *packages* never parse — rather than kept for a target that no longer exists.

Recorded because a future reader who finds C3 in the record and not this will re-revert it.

## Considered Options

**Parse once per process, memoized on first request.** Rejected: it buys nothing on any of the three remaining targets, adds a branch to every request, and converts a deployment-time failure into a mystery 500 under load. Module-scope failure is a container that won't boot or a Lambda INIT failure — loud, attributable, and visible at deploy-canary time.

**Parse per request, unmemoized.** Rejected for the same reasons, plus the cost.

## Consequences

An entrypoint is target-specific by definition and is already the only place target-specific code may appear, so parsing belongs there. The `Entrypoint` glossary entry was widened accordingly: `apps/web`'s `instrumentation.ts` and `apps/mobile`'s `app.config.ts` are entrypoints, because each is the earliest hook on its platform that runs with a real `process.env` before anything that depends on config. For mobile this is load-bearing rather than tidy — Expo inlines public variables at build time, so without a gate in `app.config.ts` a missing variable ships as `undefined` in the bundle and crashes on a user's device.

Because packages take config as an argument, they stay pure and testable, and an adapter typed on its own schema fragment cannot read a variable it did not declare.

`process.env` is banned repo-wide outside an allowlist — deployment profiles, entrypoints, and each app's own `env.ts` — enforced by a lint rule. This answers "can a client read this variable?" from where the file is rather than by auditing every access, and it makes an unresolved question about Metro's inlining of symlinked workspace packages unobservable rather than something the kit must depend on.

A logical configuration key has one name in the schema and a different physical name per app, because `NEXT_PUBLIC_` and `EXPO_PUBLIC_` are both mandatory and neither bundler accepts the other's prefix. Grepping for `NEXT_PUBLIC_API_URL` therefore finds exactly one hit, in `apps/web`'s access map, and not the schema.
