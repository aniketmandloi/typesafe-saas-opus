// Vercel finds a Hono app by looking for a default export at a fixed set of
// paths — `app`, `index` or `server`, at the project root or under `src/` — and
// ADR-0006 keeps every entrypoint of this app in `src/entrypoints/`. This shim
// is where those two conventions meet, and it is the whole of the overlap.
export { default } from "./entrypoints/vercel.ts";
