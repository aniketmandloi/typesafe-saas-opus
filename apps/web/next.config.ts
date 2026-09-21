import type { NextConfig } from "next";

import { publicEnv } from "./src/env.ts";

// No `transpilePackages`. Workspace packages export `.ts` through their
// `exports` conditions and Next 16 consumes them directly (#14) — adding it
// would be cargo cult.
const nextConfig: NextConfig = {
  async rewrites() {
    return [
      // Both surfaces, and for one reason: the session cookie. `vercel.app` is
      // on the Public Suffix List, so two Vercel projects on default domains
      // are cross-site and `SameSite` would drop it. Proxying makes the browser
      // consider the cookie first-party with no DNS setup at all (#9).
      {
        source: "/api/trpc/:path*",
        destination: `${publicEnv.apiUrl}/api/trpc/:path*`,
      },
      {
        source: "/api/auth/:path*",
        destination: `${publicEnv.apiUrl}/api/auth/:path*`,
      },
    ];
  },
};

export default nextConfig;
