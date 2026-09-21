import { z } from "zod";

// Flat, never composed: no adapter has a public variable, so there is nothing
// to compose on this side (#15). One schema serves every app.
export const publicSchema = z.object({
  apiUrl: z.url(),
});

export type PublicEnv = z.infer<typeof publicSchema>;
export type PublicKey = keyof PublicEnv;

// One logical key, per-app physical names. Both bundler prefixes are mandatory
// and neither bundler can be trusted to inline from a shared package — Next
// does it automatically, Expo deliberately does not — so each app hand-writes
// its own access map of literal `process.env.X` reads and validates it with
// `satisfies Record<PublicKey, string | undefined>`.
//
// This table is documentation of that mapping, not a mechanism. Deriving the
// physical name at runtime is exactly what stops the bundlers inlining.
export const PUBLIC_PHYSICAL_NAMES: Record<PublicKey, { web: string; native: string }> = {
  apiUrl: { web: "NEXT_PUBLIC_API_URL", native: "EXPO_PUBLIC_API_URL" },
};
