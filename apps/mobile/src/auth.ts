import { createExpoAuthClient } from "@repo/auth-expo";

import { publicEnv } from "./env.ts";

// One client for the app. Unlike the server-side web client there is no
// per-request hazard here: a phone has exactly one user, so there is no other
// request's session to leak into.
export const authClient = createExpoAuthClient({
  baseURL: `${publicEnv.apiUrl}/api/auth`,
  scheme: "typesafesaas",
});
