import { type PublicKey, publicSchema } from "@repo/env";

// The public access map, hand-written on purpose (#15).
//
// Every read below is a literal `process.env.NEXT_PUBLIC_*`, because that is
// the only form Next inlines. Deriving the physical name at runtime — from the
// `PUBLIC_PHYSICAL_NAMES` table, say — is exactly what stops the bundler
// inlining it, so the table is documentation of this mapping and never its
// mechanism.
//
// `satisfies` is what makes the cost bounded: add a key to the public schema
// and this file fails to compile until it is mapped here. That is the price
// paid three times over, once per app, and it is the honest one.
const raw = {
  apiUrl: process.env.NEXT_PUBLIC_API_URL,
} satisfies Record<PublicKey, string | undefined>;

// Parsed at module scope. A missing public variable is a build failure, not a
// blank screen with a console error.
export const publicEnv = publicSchema.parse(raw);
