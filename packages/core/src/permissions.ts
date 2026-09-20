// The role→permission map, as plain data (#3). Deliberately not built with
// Better Auth's `createAccessControl`: that is a Better Auth API, and ADR-0009
// fences those to the @repo/auth* packages. This is a lookup table and a pure
// function over it, so every other package can ask "may they?" without taking
// a dependency on the identity store.
//
// Org RBAC and platform RBAC are separate closed sets and never mix. The only
// bridge is impersonation, which is audit-logged and puts a platform actor back
// on the ordinary orgProcedure path (ADR-0005).

export const ORG_ROLES = ["owner", "admin", "member"] as const;
export type OrgRole = (typeof ORG_ROLES)[number];

export const PLATFORM_ROLES = ["platformAdmin", "platformSupport"] as const;
export type PlatformRole = (typeof PLATFORM_ROLES)[number];

export type OrgPermissions = {
  organization: ("read" | "update" | "delete")[];
  member: ("read" | "invite" | "remove" | "changeRole")[];
  billing: ("read" | "manage")[];
  project: ("create" | "read" | "update" | "delete")[];
};

export type PlatformPermissions = {
  organization: ("readMetadata" | "impersonate")[];
  user: ("readMetadata" | "ban")[];
};

// A role's permissions are exhaustive: there is no inheritance chain to trace.
// Reading one line tells you everything the role may do.
export const ORG_ROLE_PERMISSIONS: Record<OrgRole, OrgPermissions> = {
  owner: {
    organization: ["read", "update", "delete"],
    member: ["read", "invite", "remove", "changeRole"],
    billing: ["read", "manage"],
    project: ["create", "read", "update", "delete"],
  },
  admin: {
    organization: ["read", "update"],
    member: ["read", "invite", "remove"],
    billing: ["read"],
    project: ["create", "read", "update", "delete"],
  },
  member: {
    organization: ["read"],
    member: ["read"],
    billing: [],
    project: ["create", "read", "update"],
  },
};

export const PLATFORM_ROLE_PERMISSIONS: Record<PlatformRole, PlatformPermissions> = {
  // Metadata only, never tenant content (ADR-0005). Reaching content means
  // impersonating, which is audited and time-boxed.
  platformAdmin: {
    organization: ["readMetadata", "impersonate"],
    user: ["readMetadata", "ban"],
  },
  platformSupport: {
    organization: ["readMetadata"],
    user: ["readMetadata"],
  },
};

// Better Auth stores a member's roles as a CSV column, so "member,admin" is one
// value and not a join (#3). Parsing is therefore a domain concern, not a
// storage detail we can ignore.
export const parseRoles = (csv: string | null | undefined): OrgRole[] => {
  if (!csv) return [];
  return csv
    .split(",")
    .map((part) => part.trim())
    .filter((part): part is OrgRole => (ORG_ROLES as readonly string[]).includes(part));
};

type Query<TPermissions> = {
  [TResource in keyof TPermissions]?: TPermissions[TResource] extends (infer TAction)[]
    ? TAction[]
    : never;
};

const grantsAll = <TPermissions extends Record<string, readonly string[]>>(
  granted: TPermissions[],
  query: Query<TPermissions>,
): boolean =>
  Object.entries(query).every(([resource, actions]) =>
    (actions as string[]).every((action) =>
      granted.some((grant) => grant[resource]?.includes(action)),
    ),
  );

// Every call site asks this, never `role === "admin"` (#12). A role check
// leaks the map into the caller and goes stale the moment the map changes;
// this does not.
export const hasOrgPermission = (roles: OrgRole[], query: Query<OrgPermissions>): boolean =>
  grantsAll(
    roles.map((role) => ORG_ROLE_PERMISSIONS[role]),
    query,
  );

export const hasPlatformPermission = (
  roles: PlatformRole[],
  query: Query<PlatformPermissions>,
): boolean =>
  grantsAll(
    roles.map((role) => PLATFORM_ROLE_PERMISSIONS[role]),
    query,
  );
