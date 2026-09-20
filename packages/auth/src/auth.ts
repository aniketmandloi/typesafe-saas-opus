import { drizzleAdapter } from "@better-auth/drizzle-adapter";
import * as schema from "@repo/schema";
import { betterAuth } from "better-auth";
import { admin, organization, twoFactor } from "better-auth/plugins";

// The only package permitted to touch the Better Auth API, together with
// @repo/auth-client (ADR-0009). That is the whole mitigation: it turns diffuse
// coupling into an enumerable call list.
//
// No process.env here. Every value arrives as an argument, because entrypoints
// parse configuration and packages never do (ADR-0006).
export type AuthConfig = {
  db: Parameters<typeof drizzleAdapter>[0];
  secret: string;
  baseURL: string;
  trustedOrigins?: string[];
};

export const createAuth = (config: AuthConfig) =>
  betterAuth({
    secret: config.secret,
    baseURL: config.baseURL,
    ...(config.trustedOrigins ? { trustedOrigins: config.trustedOrigins } : {}),
    database: drizzleAdapter(config.db, { provider: "pg", schema }),
    emailAndPassword: { enabled: true },
    plugins: [
      organization({
        // Better Auth's delete is hard, immediate, and takes `member` with it —
        // and `member` is the reversal handle ADR-0007's grace window needs.
        // Deletion is ours: one nullable column, then a purge job.
        disableOrganizationDeletion: true,
        // Teams stay off: `deleteOrganization` never deletes `team`, so
        // enabling them would leave orphans purge cannot see (#16).
      }),
      // Impersonation is what lets platform staff reach tenant content at all,
      // and it returns them to the ordinary orgProcedure path (ADR-0005).
      admin(),
      // Platform roles carry mandatory 2FA (#11).
      twoFactor(),
    ],
  });

export type Auth = ReturnType<typeof createAuth>;
