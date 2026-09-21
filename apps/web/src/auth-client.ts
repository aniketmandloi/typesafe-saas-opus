"use client";

import { createAuthClient } from "@repo/auth-client";

import { publicEnv } from "./env.ts";

/**
 * The browser's Better Auth client.
 *
 * **Same-origin in the browser, absolute on the server, and both are
 * necessary.** In the browser the calls must go through `apps/web`'s rewrite so
 * the session cookie is first-party — `vercel.app` is on the Public Suffix
 * List, so two Vercel projects on default domains are cross-site and
 * `SameSite` would drop it. #9 argued that for the contract; the cookie makes
 * it true for auth as well.
 *
 * But `"use client"` does not mean "browser only": Client Components are
 * server-rendered too, and this module evaluates during SSR where there is no
 * origin to resolve a relative URL against. Better Auth rejects one outright —
 * `Invalid base URL: /api/auth` — and the page 500s before it ever reaches a
 * browser. Found by the end-to-end spec, which is the only thing that renders
 * this on a server and then in a browser.
 */
const baseURL =
  typeof window === "undefined"
    ? `${publicEnv.apiUrl}/api/auth`
    : `${window.location.origin}/api/auth`;

export const authClient = createAuthClient({ baseURL });
