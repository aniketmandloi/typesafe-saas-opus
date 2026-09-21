import type { AppRouter } from "@repo/api";
import { ORGANIZATION_HEADER } from "@repo/core";
import { createTRPCClient, httpBatchLink } from "@trpc/client";

import { authClient } from "./auth.ts";
import { publicEnv } from "./env.ts";

/**
 * The mobile client.
 *
 * No rewrite and no same-origin trick: there is no origin. The base URL is the
 * explicit public variable, and the session cookie is attached **by hand** —
 * `getCookie()` has been async since Better Auth 1.7, which is why the link's
 * `headers` is async too (#9).
 *
 * `SameSite` never enters into it. It governs only cookies a browser attaches
 * automatically, and nothing here is automatic.
 *
 * `AppRouter` is a type and nothing else. With `verbatimModuleSyntax` on, a
 * missing `type` keyword here becomes a genuine runtime import of the entire
 * server and fails at bundle time rather than shipping one (#9) — and
 * `check-graph.ts` rejects it earlier still.
 */
export const createMobileClient = (organizationId: string) =>
  createTRPCClient<AppRouter>({
    links: [
      httpBatchLink({
        url: `${publicEnv.apiUrl}/api/trpc`,
        headers: async () => ({
          cookie: await authClient.getCookie(),
          [ORGANIZATION_HEADER]: organizationId,
        }),
      }),
    ],
  });
