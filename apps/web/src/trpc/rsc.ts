import type { AppRouter } from "@repo/api";
import { ORGANIZATION_HEADER } from "@repo/core";
import { createTRPCClient, httpBatchLink } from "@trpc/client";
import { cookies } from "next/headers";
import { serverEnv } from "../env.server.ts";
import { publicEnv } from "../env.ts";

/**
 * A tRPC client for one server render.
 *
 * **Constructed per request, never at module scope.** A client hoisted to
 * module scope captures the first request's headers and serves them to every
 * request after it — which is not a caching bug but cross-tenant disclosure,
 * and the sharpest hazard in this whole path (#9). This file exports a factory
 * and no instance, so there is nothing to accidentally reuse.
 *
 * Next forwards no cookies automatically: `cookies()` is async and the
 * documented pattern is to read the value and place it on the outgoing request
 * by hand. That is why this is `async` — the asynchrony is Next's, not ours.
 *
 * `AppRouter` arrives as a **type**. With `verbatimModuleSyntax` on, dropping
 * the `type` keyword here turns this into a genuine runtime import of the whole
 * server, and `check-graph.ts` rejects it before a bundler ever sees it.
 */
export const createRscClient = async (organizationId: string) => {
  const cookieHeader = (await cookies()).toString();

  return createTRPCClient<AppRouter>({
    links: [
      httpBatchLink({
        // The explicit base URL, not the rewrite: a rewrite is a browser
        // convenience and this call never goes near a browser. None of Vercel's
        // URL variables can answer this either — all three describe *this*
        // deployment rather than the sibling API (#9).
        url: `${publicEnv.apiUrl}/api/trpc`,
        headers: () => ({
          cookie: cookieHeader,
          [ORGANIZATION_HEADER]: organizationId,
          ...(serverEnv.VERCEL_AUTOMATION_BYPASS_SECRET
            ? { "x-vercel-protection-bypass": serverEnv.VERCEL_AUTOMATION_BYPASS_SECRET }
            : {}),
        }),
      }),
    ],
  });
};

/**
 * The same, for calls made before any Organization is known — signing in, and
 * resolving a slug to an id.
 */
export const createRscAnonymousClient = async () => {
  const cookieHeader = (await cookies()).toString();

  return createTRPCClient<AppRouter>({
    links: [
      httpBatchLink({
        url: `${publicEnv.apiUrl}/api/trpc`,
        headers: () => ({
          cookie: cookieHeader,
          ...(serverEnv.VERCEL_AUTOMATION_BYPASS_SECRET
            ? { "x-vercel-protection-bypass": serverEnv.VERCEL_AUTOMATION_BYPASS_SECRET }
            : {}),
        }),
      }),
    ],
  });
};
