import type { Auth } from "@repo/auth";
import { adminClient, organizationClient, twoFactorClient } from "better-auth/client/plugins";
import { createAuthClient as createBetterAuthClient } from "better-auth/react";

// The client half of the fence (ADR-0009). @repo/auth holds the server instance
// and is `server`-tagged because it pulls the server SDK and the Drizzle
// adapter; this package pulls neither, so it is `universal` and safe for
// mobile. The edge between them is type-only and erased before any bundler sees
// it — check-graph.ts proves the erasure by rejecting any value import.
//
// Built on `better-auth/react`, not `better-auth/client`. Both consumers are
// React — Next and React Native — and the vanilla client exposes `useSession`
// as a nanostore atom rather than a hook, so a screen calling it does not
// compile. `better-auth/react` wraps the same atoms with `nanostores/react`,
// which is as safe on React Native as it is in a browser.
export type { Auth };

// Inferred from the server instance's type, so the client's knowledge of
// sessions and organizations has exactly one declaration (the server's) and is
// never restated here.
export type Session = Auth["$Infer"]["Session"];

// biome-ignore lint/suspicious/noExplicitAny: Better Auth's plugin type is invariant in its options
type AnyPlugin = any;

export type AuthClientOptions<TPlugins extends readonly AnyPlugin[]> = {
  baseURL: string;
  /**
   * Platform-specific plugins, supplied by the caller. The Expo plugin imports
   * react-native, expo-constants and expo-linking at module scope, so it cannot
   * live in a `universal` package — it is wired in `@repo/auth-expo`, which is
   * still inside the `@repo/auth*` fence.
   *
   * Generic in the tuple, not `any[]`: a widened array erases whatever the
   * plugin contributes to the client, and the Expo plugin's whole job is to add
   * `getCookie()`. Typing it away would push every call site to a cast.
   */
  plugins?: TPlugins;
  fetchOptions?: Record<string, unknown>;
};

export const createAuthClient = <const TPlugins extends readonly AnyPlugin[] = []>(
  options: AuthClientOptions<TPlugins>,
) =>
  createBetterAuthClient({
    baseURL: options.baseURL,
    plugins: [
      organizationClient(),
      adminClient(),
      twoFactorClient(),
      ...((options.plugins ?? []) as TPlugins),
    ],
    ...(options.fetchOptions ? { fetchOptions: options.fetchOptions } : {}),
  });

export type AuthClient = ReturnType<typeof createAuthClient>;

/**
 * Drives the session atom directly instead of waiting for the `$sessionSignal`
 * listener to fire.
 *
 * React Native needs this: better-auth#10545 leaves the signal listener unbound
 * after a mount/cleanup cycle, so `useSession` never updates after sign-in and
 * the user appears signed out until the app restarts. On Android that masks
 * itself as flakiness, because okhttp's cookie jar persists the cookie
 * independently and a cold start looks signed in.
 *
 * Still open against 1.7.5: `dist/client/session-refresh.mjs` is byte-identical
 * to the version the bug was filed against, and 1.7.5's new module-scope
 * `$signal.listen` only invalidates cached freshness — it never refetches.
 *
 * It lives here rather than in a screen so it stays on the enumerable call list
 * ADR-0009's mitigation depends on, and so removing it is a one-line change
 * when upstream fixes the lifecycle. Harmless on web, where the signal works.
 */
export const refreshSession = async (client: {
  $store: { atoms: { session?: { get(): { refetch(): Promise<unknown> } } } };
}): Promise<void> => {
  await client.$store.atoms.session?.get().refetch();
};
