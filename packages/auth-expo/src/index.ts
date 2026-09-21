import { expoClient } from "@better-auth/expo/client";
import { createAuthClient, refreshSession } from "@repo/auth-client";
import * as SecureStore from "expo-secure-store";

// The package phase 3b said would be needed once `apps/mobile` existed.
//
// `@better-auth/expo/client` imports `react-native`, `expo-constants` and
// `expo-linking` **at module scope**, so it is `native` and cannot live in the
// `universal` `@repo/auth-client`. A platform tag is one bit per package and
// never per subpath (#2), so the split is a package, not an export condition.
//
// It stays inside the `@repo/auth*` fence, which is what ADR-0009's whole
// mitigation rests on: the set of places that touch the Better Auth API has to
// stay enumerable, and three named packages are as enumerable as one.

export type ExpoAuthClientOptions = {
  baseURL: string;
  /** The app's scheme, for the deep link Better Auth sends users back through. */
  scheme: string;
  storagePrefix?: string;
};

export const createExpoAuthClient = ({
  baseURL,
  scheme,
  storagePrefix = "typesafe-saas-kit",
}: ExpoAuthClientOptions) =>
  createAuthClient({
    baseURL,
    plugins: [
      expoClient({
        scheme,
        storagePrefix,
        // SecureStore rather than AsyncStorage: this holds the session cookie.
        // 1.7.4 fixed multibyte and concurrent-update corruption in this exact
        // layer, one release before the version pinned here, so it was still
        // being shaken out very recently.
        storage: SecureStore,
      }),
    ],
  });

/**
 * Sign-in on React Native, with the workaround that makes it visible.
 *
 * `useSession` does not update after sign-in under 1.7.5
 * ([better-auth#10545](https://github.com/better-auth/better-auth/issues/10545)):
 * `dist/client/session-refresh.mjs` is byte-identical to the version the bug
 * was filed against, and 1.7.5's new module-scope `$signal.listen` only
 * invalidates cached freshness — it never refetches.
 *
 * **The `refreshSession` call is load-bearing.** Remove it and sign-in silently
 * does nothing until the app restarts, which on Android masks itself as
 * flakiness, because okhttp's native cookie jar persists the cookie
 * independently and a cold start looks signed in.
 *
 * It sits here, at one sanctioned call site, rather than in a screen — which is
 * what keeps it on the enumerable list ADR-0009 depends on, and makes removing
 * it a one-line change when upstream fixes the lifecycle.
 */
export type ExpoAuthClient = ReturnType<typeof createExpoAuthClient>;

export const signInWithEmail = async (
  client: ExpoAuthClient,
  credentials: { email: string; password: string },
) => {
  const result = await client.signIn.email(credentials);
  if (!result.error) await refreshSession(client);
  return result;
};

export const signUpWithEmail = async (
  client: ExpoAuthClient,
  credentials: { email: string; password: string; name: string },
) => {
  const result = await client.signUp.email(credentials);
  if (!result.error) await refreshSession(client);
  return result;
};

/**
 * The same workaround, at the one call site sign-in does not cover: app start.
 *
 * A cold start has a stored cookie and no sign-in to hang a refetch off, so
 * under [#10545](https://github.com/better-auth/better-auth/issues/10545)
 * `useSession` stays empty and the app renders a signed-out UI for a user who
 * is signed in. Observed on a device — the browser path cannot reach it,
 * because it has no SecureStore and no session to restore.
 *
 * Exported rather than called inside `createExpoAuthClient`: the client is
 * constructed at module scope, and a fetch fired from there races the first
 * render instead of driving it.
 */
export const restoreSession = async (client: ExpoAuthClient) => {
  await refreshSession(client);
};
