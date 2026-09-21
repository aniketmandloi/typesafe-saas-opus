"use client";

import { createAuthClient } from "@repo/auth-client";

/**
 * The browser's Better Auth client.
 *
 * Same-origin for the same reason the tRPC browser client is: the session
 * cookie is set by the API and the browser must consider it first-party, so
 * `/api/auth/*` is rewritten too. #9 argued this for the contract; it is the
 * cookie that makes it true, so it applies identically here.
 */
export const authClient = createAuthClient({ baseURL: "/api/auth" });
