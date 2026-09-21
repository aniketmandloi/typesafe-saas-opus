/**
 * The header the caller names its Organization in.
 *
 * Tenant context is an argument, not ambient state (#3): Better Auth's
 * `activeOrganizationId` cannot express two browser tabs open on two
 * Organizations, and switching in one would silently repoint the other.
 *
 * It lives here, in a `universal` package, and not beside the router — which is
 * where it started. `@repo/api` is `server`-tagged and both clients import it
 * **type-only**, so a constant declared there is unreachable from the code that
 * has to set the header. The Contract is a type; its calling convention is not,
 * and the two need different homes.
 */
export const ORGANIZATION_HEADER = "x-organization-id";
