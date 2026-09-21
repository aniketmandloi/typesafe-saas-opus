import type { AppRouter } from "@repo/api";
import { ORGANIZATION_HEADER } from "@repo/core";
import { createTRPCClient, httpBatchLink } from "@trpc/client";

/**
 * The browser client.
 *
 * Same-origin, through the `next.config` rewrite. That is not a preference: on
 * their default domains two Vercel projects are **cross-site**, because
 * `vercel.app` is on the Public Suffix List and every `*.vercel.app` subdomain
 * is its own site — so `SameSite` would drop the session cookie and a fresh
 * fork would have no working browser auth until someone configured DNS (#9).
 *
 * The cost, stated plainly: every client-side call takes an extra hop through
 * the web deployment. A cloner who puts `app.` and `api.` under one custom apex
 * can point this at the API directly and delete the rewrite. It is the
 * zero-configuration default, not a cage.
 *
 * Unlike the RSC client this one *may* be held: the browser has exactly one
 * user, so there is no other request's cookie to leak into. It is still built
 * per Organization, because the header is part of the client.
 */
export const createBrowserClient = (organizationId: string) =>
  createTRPCClient<AppRouter>({
    links: [
      httpBatchLink({
        url: "/api/trpc",
        headers: () => ({ [ORGANIZATION_HEADER]: organizationId }),
      }),
    ],
  });
