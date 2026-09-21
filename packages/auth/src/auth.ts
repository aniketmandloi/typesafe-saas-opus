import { drizzleAdapter } from "@better-auth/drizzle-adapter";
import type { Database } from "@repo/db";
import * as schema from "@repo/schema";
import { member, organization as organizationTable } from "@repo/schema";
import { betterAuth } from "better-auth";
import { admin, organization, twoFactor } from "better-auth/plugins";

/**
 * The slug a Personal Organization gets at signup.
 *
 * Derived from the address rather than the display name, because a name is
 * optional on some providers and an address never is, and suffixed with the
 * user id because `organization.slug` is unique and two people called `ada`
 * must both be able to sign up.
 */
const personalSlug = (email: string, userId: string) => {
  const local = email.split("@")[0] ?? "user";
  const base =
    local
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "") || "user";
  return `${base}-${userId.slice(0, 8).toLowerCase()}`;
};

// The only package permitted to touch the Better Auth API, together with
// @repo/auth-client (ADR-0009). That is the whole mitigation: it turns diffuse
// coupling into an enumerable call list.
//
// No process.env here. Every value arrives as an argument, because entrypoints
// parse configuration and packages never do (ADR-0006).
export type AuthConfig = {
  db: Database;
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
    databaseHooks: {
      user: {
        create: {
          // Every user gets a Personal Organization at signup, so there is no
          // org-less mode (#3). The alternative endgame is the one that sank
          // it: under an org-less mode, a solo user who later invites someone
          // needs their existing data *migrated* into a newly created org — a
          // data move on the happy path of the product's own growth story.
          //
          // This is the one org-creating write that is not a use case, and it
          // is allowed to be: there is no request, no actor and no session yet,
          // which is precisely why ADR-0008 keeps `databaseHooks` for
          // platform-scoped events. It writes no audit entry for the same
          // reason — there is nobody to attribute it to but the row itself.
          after: async (user) => {
            const organizationId = crypto.randomUUID();
            await config.db.insert(organizationTable).values({
              id: organizationId,
              name: user.name || user.email,
              slug: personalSlug(user.email, user.id),
              createdAt: new Date(),
              isPersonal: true,
            });
            await config.db.insert(member).values({
              id: crypto.randomUUID(),
              organizationId,
              userId: user.id,
              role: "owner",
              createdAt: new Date(),
            });
          },
        },
      },
    },
    plugins: [
      organization({
        // The flag every user's first Organization carries (#3). Declaring it
        // here is what ties it to the schema: checkSchema() rejects the
        // instance if the column and this entry ever drift apart.
        schema: {
          organization: {
            additionalFields: {
              isPersonal: { type: "boolean", required: false, input: false },
            },
          },
        },
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
