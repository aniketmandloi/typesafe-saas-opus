import type { ApiDeps } from "./deps.ts";

/**
 * The Organization the caller names for this request.
 *
 * Tenant context is an argument, not ambient state (#3). Better Auth's
 * `activeOrganizationId` cannot express two browser tabs open on two
 * Organizations: switching in one silently repoints the other, and the next
 * write from it lands in the wrong tenant. A header can express it.
 */
export const ORGANIZATION_HEADER = "x-organization-id";

export type Actor = {
  userId: string;
  email: string;
  name: string;
  /** Set when platform staff are acting as this user (ADR-0005). */
  impersonatedBy: string | null;
};

export type RequestContext = {
  deps: ApiDeps;
  headers: Headers;
  actor: Actor | null;
  organizationId: string | null;
};

/**
 * Built per request, never once at module scope.
 *
 * A context captured at module scope serves one request's cookies to the next,
 * which is cross-tenant disclosure rather than a caching bug — the sharpest
 * hazard in the RSC path (#9).
 */
export const createContext = async ({
  deps,
  headers,
}: {
  deps: ApiDeps;
  headers: Headers;
}): Promise<RequestContext> => {
  const session = await deps.auth.api.getSession({ headers });

  return {
    deps,
    headers,
    actor: session
      ? {
          userId: session.user.id,
          email: session.user.email,
          name: session.user.name,
          impersonatedBy: session.session.impersonatedBy ?? null,
        }
      : null,
    organizationId: headers.get(ORGANIZATION_HEADER),
  };
};
