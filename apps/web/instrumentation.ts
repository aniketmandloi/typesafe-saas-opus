// An entrypoint in the glossary's sense: the earliest hook on this platform
// that runs with a real environment, before anything depending on it renders
// (ADR-0006).
//
// It beats a `server-only` env module because that fails only when the first
// page importing it renders — which on a lazily compiled route means a
// misconfigured deployment looks healthy until someone visits the wrong page.
//
// The imports are the whole point: both modules parse at module scope, so a
// missing variable fails the process here rather than a request later.
export const register = async () => {
  await import("./src/env.ts");
  await import("./src/env.server.ts");
};
