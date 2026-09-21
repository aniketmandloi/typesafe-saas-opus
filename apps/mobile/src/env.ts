import { type PublicKey, publicSchema } from "@repo/env";

// The second of the three public access maps (#15), and the one that is
// load-bearing rather than tidy.
//
// Expo inlines `EXPO_PUBLIC_*` at **build** time. A variable that is missing
// does not throw — it inlines as `undefined` and the failure lands on a user's
// device, not in CI. Parsing here, and calling this from `app.config.ts`, is
// what turns that into a build that does not produce a bundle.
//
// Literal reads, like the web map, for the same reason: deriving the physical
// name at runtime is precisely what stops the bundler inlining it.
const raw = {
  apiUrl: process.env.EXPO_PUBLIC_API_URL,
} satisfies Record<PublicKey, string | undefined>;

export const publicEnv = publicSchema.parse(raw);
