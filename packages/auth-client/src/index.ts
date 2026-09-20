import type { Auth } from "@repo/auth";
import { createAuthClient as createBetterAuthClient } from "better-auth/client";
import { adminClient, organizationClient, twoFactorClient } from "better-auth/client/plugins";

// The client half of the fence (ADR-0009). @repo/auth holds the server
// instance and is `server`-tagged because it pulls the server SDK and the
// Drizzle adapter; this package pulls neither, so it is `universal` and safe
// for mobile. The edge between them is type-only and erased before any bundler
// sees it — check-graph.ts proves the erasure by rejecting any value import.
export type { Auth };

// Inferred from the server instance's type, so the client's knowledge of
// sessions and organizations has exactly one declaration (the server's) and is
// never restated here.
export type Session = Auth["$Infer"]["Session"];

export type AuthClientOptions = {
  baseURL: string;
  // Platform-specific plugins are supplied by the caller: the Expo plugin
  // imports react-native, expo-constants and expo-linking at module scope, so
  // it cannot live in a `universal` package. It is wired in the native client
  // package instead, which is still inside the @repo/auth* fence.
  // biome-ignore lint/suspicious/noExplicitAny: Better Auth's plugin type is invariant in its options
  plugins?: any[];
  fetchOptions?: Record<string, unknown>;
};

export const createAuthClient = (options: AuthClientOptions) =>
  createBetterAuthClient({
    baseURL: options.baseURL,
    plugins: [organizationClient(), adminClient(), twoFactorClient(), ...(options.plugins ?? [])],
    ...(options.fetchOptions ? { fetchOptions: options.fetchOptions } : {}),
  });

export type AuthClient = ReturnType<typeof createAuthClient>;

/**
 * Drives the session atom directly instead of waiting for the `$sessionSignal`
 * listener to fire.
 *
 * React Native needs this: better-auth#10545 leaves the signal listener
 * unbound after a mount/cleanup cycle, so `useSession` never updates after
 * sign-in and the user appears signed out until the app restarts. On Android
 * that masks itself as flakiness, because okhttp's cookie jar persists the
 * cookie independently and a cold start looks signed in.
 *
 * Still open against 1.7.5: `dist/client/session-refresh.mjs` is byte-identical
 * to the version the bug was filed against, and 1.7.5's new module-scope
 * `$signal.listen` only invalidates cached freshness — it never refetches.
 *
 * It lives here rather than in a screen so it stays on the enumerable call list
 * ADR-0009's mitigation depends on, and so removing it is a one-line change
 * when upstream fixes the lifecycle. Harmless on web, where the signal works.
 */
export const refreshSession = async (client: AuthClient): Promise<void> => {
  await client.$store.atoms.session?.get().refetch();
};
