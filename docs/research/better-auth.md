# Better Auth: orgs, RBAC, SSO and web+Expo sessions

Research for [#4](https://github.com/aniketmandloi/typesafe-saas-opus/issues/4). Verified against
the Better Auth docs site, the `better-auth/better-auth` GitHub repo at tag `v1.7.5`, the GitHub
releases/issues API, and the npm registry. **Checked 2026-09-19.** Everything below is from a
primary source with the URL cited; where a claim could not be verified it says so.

Docs pages are quoted from their raw-Markdown form (`https://better-auth.com/docs/<path>.md`),
which is the same content the site renders.

---

## 1. Current version, cadence, breaking changes in flight

**Latest stable: `better-auth@1.7.5`, published 2026-09-14.**
Source: <https://registry.npmjs.org/better-auth> (`dist-tags.latest`).

dist-tags on the registry as of this date:

| tag | version |
| --- | --- |
| `latest` | 1.7.5 |
| `release-1.6` | 1.6.33 |
| `release-1.4` | 1.4.22 |
| `rc` | 1.7.0-rc.6 |
| `beta` | 1.7.0-beta.10 |
| `canary` | 1.0.0-canary.14 |

Two lines are actively maintained in parallel: `1.6.33` and `1.7.5` were both published on
2026-09-14. There is a `release-1.4` tag as well, so at least three branches receive backports.
No published LTS policy was found on the docs site or in the repo.

**Cadence** (from <https://api.github.com/repos/better-auth/better-auth/releases>):

- Minors: `1.5.0` 2026-03-01, `1.6.0` 2026-04-06, `1.7.0` 2026-08-18 — roughly every 1–4 months.
- Patches: weekly to fortnightly. Six patches shipped on the 1.7 line in the month after 1.7.0.

**Everything is MIT.** Verified per-package on the npm registry: `better-auth`,
`@better-auth/sso`, `@better-auth/scim`, `@better-auth/expo`, `@better-auth/drizzle-adapter`,
`@better-auth/passkey`, and the CLI package `auth` are all `"license": "MIT"` at 1.7.5.

### Breaking changes in flight

**Packages were split out of the monorepo core.** These now live in their own npm packages and
are no longer imported from `better-auth/plugins` or `better-auth/adapters/*`:

- `@better-auth/drizzle-adapter` (was `better-auth/adapters/drizzle`)
- `@better-auth/expo`, `@better-auth/sso`, `@better-auth/scim`, `@better-auth/passkey`,
  `@better-auth/oauth-provider`, `@better-auth/mcp`, `@better-auth/stripe`, `@better-auth/i18n`,
  `@better-auth/redis-storage`, `@better-auth/electron`, `@better-auth/api-key`,
  `@better-auth/cimd`, `@better-auth/test-utils`
- Full list: <https://github.com/better-auth/better-auth/tree/v1.7.5/packages>

`organization`, `admin`, `twoFactor`, `bearer`, `jwt`, `multiSession`, `customSession` are still
in core (`better-auth/plugins`).

**The CLI was renamed.** It is now `npx auth@latest <generate|migrate|upgrade|init|info|secret>`.
The old `@better-auth/cli` package is frozen at 1.4.21 (2026-03-01, per npm). The CLI requires
Node.js 22.12+. Source: <https://better-auth.com/docs/concepts/cli> and
<https://better-auth.com/docs/guides/1-7-upgrade-guide>.

**1.7 upgrade hazards** (<https://better-auth.com/docs/guides/1-7-upgrade-guide>) — mostly
irrelevant to a greenfield kit, but they show where the project churns:

- 1.7.0–1.7.2 added a required `issuer` column to `account` with a unique index; **1.7.3 reverted
  it**. The release notes say "we recognize the cost to users who already migrated and are
  committed to keeping the core schema stable throughout v1"
  (<https://github.com/better-auth/better-auth/releases/tag/v1.7.5> chain, and the 1.7.3 notes).
  A required core-schema column shipped and was withdrawn inside three patch releases.
- SCIM was rebuilt and **requires full reprovisioning**; 1.7 replaces the legacy SCIM models.
- The `oidcProvider` plugin was removed; migrate to `@better-auth/oauth-provider`.
  `oauthApplication` becomes `oauthClient` and client data must be moved by hand.
- Expo: `authClient.getCookie()` is now **async** and returns a promise.
- Organization: `team.memberCount` and `teamMember.membershipKey` columns added (no manual step).
- 1.7.3 turned on **schema validation at init by default, including production**, and
  authentication requests are rejected on a detected mismatch. Relevant to our migration story:
  a drifted Drizzle schema now fails closed at runtime, not just at generate time.

**Ownership changed.** Better Auth was acquired by Vercel, announced 2026-07-07
(<https://better-auth.com/blog/better-auth-joins-vercel>). The post states Vercel "shares our
commitment to keeping auth open source, framework and platform agnostic" but makes **no explicit
licensing, governance or self-hosting commitment**. Auth.js also folded into Better Auth
(<https://better-auth.com/blog/authjs-joins-better-auth>). The library is still MIT at 1.7.5;
there is no verifiable guarantee about the future beyond the current license.

---

## 2. Organization plugin

Docs: <https://better-auth.com/docs/plugins/organization>
Schema source of truth:
<https://github.com/better-auth/better-auth/blob/v1.7.5/packages/better-auth/src/plugins/organization/schema.ts>

### Schema it imposes

Read off `schema.ts` at v1.7.5 (the rendered docs hide these in a `<DatabaseTable>` component;
the source is authoritative).

**`organization`** — `id`, `name` (required, sortable), `slug` (required, **unique**, sortable),
`logo` (optional), `createdAt` (required), `updatedAt` (optional). A `metadata` field exists on
the Zod runtime schema (`z.record(z.string(), z.unknown())`, JSON-string-coercible) but is not in
`OrganizationDefaultFields`.

**`member`** — `id`, `organizationId` → `organization.id`, `userId` → `user.id`,
`role` (string, default `"member"`), `createdAt`.

**`invitation`** — `id`, `organizationId` → `organization.id`, `email`, `role`,
`status` (default `"pending"`; enum at runtime: `pending | accepted | rejected | canceled`),
`expiresAt` (optional), `createdAt`, `inviterId` → `user.id`. `+ teamId` when teams are on.

**`session`** — the plugin adds `activeOrganizationId` (nullable, `input: false`), and
`activeTeamId` when teams are on.

**`organizationRole`** (only when `dynamicAccessControl.enabled`) — `organizationId`, `role`,
`permission`, `createdAt`, `updatedAt`.

**`team`, `teamMember`** (only when `teams.enabled`) — `team` has `name`, `memberCount`,
`organizationId`, timestamps; `teamMember` has `teamId`, `userId`, `membershipKey` (**unique**),
`createdAt`.

> **The only unique constraints the plugin declares are `organization.slug` and
> `teamMember.membershipKey`.** There is no unique index on `member(organizationId, userId)` or on
> `invitation(organizationId, email)`. Uniqueness of membership is enforced in application code,
> not the database. (Verified by grepping `unique` across `schema.ts` — two hits only.)

### Roles and permissions

Built-in roles: `owner`, `admin`, `member`. Built-in statement:
`organization: [update, delete]`, `member: [create, update, delete]`,
`invitation: [create, cancel]`.

A user can hold **multiple roles**, stored as a **comma-separated string** in the single
`member.role` column — not a join table.

**Extensible, yes, and in two distinct ways:**

1. **Static (compile-time)** — `createAccessControl(statement)` from `better-auth/plugins/access`,
   then `ac.newRole({...})`. You must pass the same `ac` and `roles` to **both** the server plugin
   and the client plugin. Merging with the defaults is manual: spread `defaultStatements` and
   `adminAc.statements` from `better-auth/plugins/organization/access`, otherwise your custom role
   *replaces* the built-in permissions. Checks: `auth.api.hasPermission` (server),
   `authClient.organization.hasPermission` (round-trips to the server),
   `authClient.organization.checkRolePermission` (synchronous, client-only).
2. **Dynamic (runtime)** — `dynamicAccessControl: { enabled: true }` stores per-org roles in the
   `organizationRole` table with `createRole` / `updateRole` / `deleteRole` / `listRoles`. Requires
   a pre-defined `ac` on the server so the *available* permission surface is still statically
   typed. **`checkRolePermission` does not see dynamic roles** — it runs synchronously on the
   client; you must use the `hasPermission` API for those.

### Multiple active orgs per session

**No.** `session.activeOrganizationId` is a single nullable column. One session row has at most
one active organization. The docs explicitly suggest the workaround: "It's not always you want to
persist the active organization in the session. You can manage the active organization in the
client side only. For example, multiple tabs can have different active organizations."

The `multiSession` plugin (<https://better-auth.com/docs/plugins/multi-session>) is for multiple
*user accounts* in one browser, not multiple active orgs.

By default `activeOrganizationId` is `null` on sign-in. Setting an initial active org requires a
`databaseHooks.session.create.before` hook that you write.

### Opinionated vs overridable

**Overridable:** table names (`schema.<model>.modelName`), field names
(`schema.<model>.fields`), `additionalFields` on `organization` / `member` / `invitation` /
`team` (auto-accepted and auto-returned by the endpoints, inferred on the client via
`inferOrgAdditionalFields<typeof auth>()`). `organizationHooks` give before/after hooks on create,
update, delete, member add/remove/update, invitation send/accept/reject/cancel. Limits are
configurable: `organizationLimit`, `membershipLimit` (default **100**), `invitationLimit`
(default 100), `invitationExpiresIn` (default 48h), `creatorRole`,
`allowUserToCreateOrganization`, `cancelPendingInvitationsOnReInvite`.

**Opinionated and not overridable without forking:** the four-table shape itself; role-as-CSV-
string on `member`; single active org per session; `owner`/`admin`/`member` naming baked into
`creatorRole` and the default statements; the invite-by-email-ID flow.

**One flow note for the vertical slice:** `acceptInvitation` must be called **after the user is
logged in** — the invitation link lands on your page, and your page has to route the recipient
through sign-up/sign-in first and then call accept. Better Auth does not ship that page. Also,
SSO auto-provisioning explicitly does **not** accept or cancel pending invitations.

`requireEmailVerificationOnInvitation` matters if we change ID generation:
Better Auth defaults to requiring email verification for by-ID invitation actions when invitation
IDs are predictable (`generateId: "serial"` / `false` / custom).

---

## 3. Drizzle adapter

Docs: <https://better-auth.com/docs/adapters/drizzle>
Package: `@better-auth/drizzle-adapter@1.7.5`, MIT (<https://registry.npmjs.org/@better-auth/drizzle-adapter>).

**Maturity.** First-party, in-repo (`packages/drizzle-adapter`), versioned in lockstep with core.
Supports `pg` / `mysql` / `sqlite`. Since 1.4.0 it supports **joins** (`advanced.database.joins:
true`), which the docs say gives "upwards of 2x to 3x performance improvements" on `/get-session`
and `/get-full-organization`. Joins require `relations()` declared in your Drizzle schema, passed
through the adapter's `schema` object, with matching `relationName` on both sides of any
duplicated FK. It supports native interactive transactions (`transaction: true`) — required by
the SCIM plugin.

**Generated, not hand-declared — but you own the output.** `npx auth@latest generate --adapter
drizzle --dialect pg` writes a `schema.ts` (default: project root, `--output` to relocate). It is
a plain Drizzle schema file checked into your repo, not a runtime-generated artifact. Prisma and
Drizzle can generate without a live DB connection; the CLI still loads your `auth.ts` to pick up
plugins and schema customisations.

**Migrations when a plugin adds tables.** `npx auth migrate` (the automatic path) **only works
with the built-in Kysely adapter**. With Drizzle the documented flow is:

1. Add the plugin to `auth.ts`.
2. `npx auth generate` — regenerates the Drizzle schema file including the plugin's tables.
3. Review the diff.
4. `npx drizzle-kit generate` → `npx drizzle-kit migrate` — your normal Drizzle migration flow.

So plugin-added tables land in the same Drizzle migration stream as our own tables. Good for the
kit's single-migration-history goal. The cost is that step 3 is a real review step: `generate`
rewrites the whole file, so any hand-edits to auth tables must be re-applied or expressed through
`schema`/`additionalFields` config instead.

Customisation hooks: `usePlural`, `schemaName` (Postgres schema namespace, e.g. `auth`),
per-model `modelName`, per-field `fields`.

**Caveat, new in 1.7.3:** schema validation now runs at init **by default in production** and
rejects auth requests on a mismatch (<https://github.com/better-auth/better-auth/releases/tag/v1.7.3>).
A generated-schema/DB drift is now a hard runtime failure.

---

## 4. Expo / React Native

Docs: <https://better-auth.com/docs/integrations/expo>
Package: `@better-auth/expo@1.7.5`, MIT.

The docs are written for **Expo SDK 55** (React Native 0.83, React 19.2) and state SDK 55 requires
the New Architecture.

**Session storage: cookies, persisted in `expo-secure-store`.** There is no separate token flow
for the first-party path. Server-side you add `expo()` to `plugins`; client-side you add
`expoClient({ storage: SecureStore, scheme, storagePrefix })` from `@better-auth/expo/client`. The
Expo client intercepts `Set-Cookie` from the server and writes the cookie jar into SecureStore,
then replays it on subsequent `authClient` calls. Session data is also cached in SecureStore
(`disableCache: true` to turn off) so there is no loading spinner on cold start.

**Web and mobile share one session concept: yes.** The server-side `session` row, its
`activeOrganizationId`, and the whole org/member/permission model are identical. The only
difference is transport — a browser manages the cookie itself; on native the Expo client manages
the same cookie in SecureStore.

**But the sharing is not free for our tRPC client.** Any request that is *not* made through
`authClient` has to attach the cookie by hand. The documented pattern, which is exactly our
Expo→Hono→tRPC path:

```ts
httpBatchLink({
  async headers() {
    const cookies = await authClient.getCookie(); // async as of 1.7
    return cookies ? { Cookie: cookies } : {};
  },
}),
```

…plus `credentials: "omit"` on plain `fetch` calls, because `include` interferes with the
manually-set header.

**Deep links / trusted origins.** OAuth callbacks come back via the app scheme. Requires `scheme`
in `app.json` and the scheme added to `trustedOrigins` (`"myapp://"`, wildcards supported). Dev
mode uses `exp://<local-ip>`, which needs wildcard `trustedOrigins` entries the docs warn should
be development-only. Social sign-in on native does **not** navigate automatically — you route
after the promise resolves. `signIn.social` with `idToken` is supported for **Google, Apple and
Facebook only**.

**Metro:** package exports are on by default since SDK 53; do not set
`unstable_enablePackageExports = false`. Requires `expo-network`, plus `expo-linking`,
`expo-web-browser`, `expo-constants` for social providers.

**Alternative token flow exists** but is not the Expo path: the `bearer` plugin
(<https://better-auth.com/docs/plugins/bearer>) reads `set-auth-token` off the sign-in response and
sends `Authorization: Bearer <token>`. The docs carry an explicit warning — "Use this cautiously;
it is intended only for APIs that don't support cookies… Improper implementation could easily lead
to security vulnerabilities."

**Known open Expo bugs** (GitHub, open as of 2026-09-19):

- [#10545](https://github.com/better-auth/better-auth/issues/10545) (2026-07-17) — "[Expo/React
  Native] `useSession` never updates after sign-in — `$sessionSignal` listener left unbound by
  session-refresh lifecycle." Open for two months. Directly affects the mobile half of the slice.
- [#11160](https://github.com/better-auth/better-auth/issues/11160) (2026-09-04) — client
  `$sessionSignal` subscription refetches with no damping and aborts the in-flight request.
- [#10253](https://github.com/better-auth/better-auth/issues/10253) — `expoClient` cannot use an
  HTTPS origin (App Links); scheme-only.

Recent Expo fixes in 1.7.4 (multibyte session data in SecureStore; stale secure-storage session
data and corrupted cookies under concurrent updates) suggest the SecureStore cookie layer was
still being shaken out one release ago.

---

## 5. Enterprise auth

All of these are **MIT and free** — verified individually on the npm registry. Nothing in the
authentication feature set is paywalled.

| Capability | Status | Package |
| --- | --- | --- |
| SAML 2.0 (SP) | Exists, free | `@better-auth/sso` |
| OIDC / OAuth2 SSO (SP) | Exists, free | `@better-auth/sso` |
| Org-scoped identity providers | Exists, free | `@better-auth/sso` |
| SCIM 2.0 inbound provisioning | Exists, free | `@better-auth/scim` |
| 2FA (TOTP, email/SMS OTP, backup codes, trusted devices) | Exists, free | core `better-auth/plugins` |
| Passkeys / WebAuthn | Exists, free | `@better-auth/passkey` |
| Acting as an OAuth/OIDC **provider** | Exists, free | `@better-auth/oauth-provider` |
| Self-service SSO configuration UI | **Paid hosted service** | Better Auth Infrastructure |
| Audit log | **Paid hosted service** (see gap list) | `@better-auth/infra` |
| Admin dashboard UI | **Paid hosted service** | `@better-auth/infra` |

### SSO — <https://better-auth.com/docs/plugins/sso>

Covers OIDC, OAuth2 and SAML 2.0. Includes OIDC discovery, IdP-initiated SAML, SP metadata
endpoint, signed AuthnRequests, assertion replay protection, timestamp and algorithm validation,
response size limits, signing-cert rotation, attribute mapping, shared redirect URI, and a domain
verification flow.

**Organization-scoped providers are first-class.** `registerSSOProvider` takes an `organizationId`
and a `domain`; users signing in through that provider are auto-added to that org.
`organizationProvisioning: { disabled: false, defaultRole, getRole({user, userInfo, provider}) }`
maps IdP attributes (department, job title, …) onto org roles. When the organization plugin is
enabled and `organizationId` is supplied, the caller must be an org `owner` or `admin`; members get
403. Domain-derived assignment from another sign-in method requires domain verification, a verified
stored email, and one unambiguous org match. `ssoProvider.additionalFields` is available for
provider metadata (e.g. a display name when an org has several providers).

Note: **SSO auto-provisioning does not accept or cancel pending invitations.** An invited user must
complete the invitation flow first.

### SCIM — <https://better-auth.com/docs/plugins/scim>

Inbound SCIM 2.0 per RFC 7643/7644. Users and Groups, group-to-role projection, direct SSO
integration. **Requires a database adapter with native interactive transactions** — for us that
means `drizzleAdapter(db, { provider: "pg", transaction: true })`. Rebuilt in 1.7 (seven
provisioning models plus three optional managed-catalog models); 1.7.1 added `managedConnections`
for runtime tenant connections and bearer-credential issue/rotate/revoke via server-only
`auth.api` methods, and Microsoft Entra interop fixes.

### 2FA — <https://better-auth.com/docs/plugins/2fa>

Still in core. TOTP (authenticator app, `totpURI` for QR), OTP over email/SMS
(`otpOptions.sendOTP`), backup codes, trusted devices. Sign-in returns
`twoFactorRedirect: true` plus `twoFactorMethods: ["totp" | "otp"]` so the client can pick UI.
Open bug [#11287](https://github.com/better-auth/better-auth/issues/11287) (2026-09-14): the 2FA
challenge never fires on passwordless sign-in (magic-link / email-OTP) and the matcher is not
configurable.

### Passkeys — <https://better-auth.com/docs/plugins/passkey>

Built on SimpleWebAuthn. Register, sign in, list, rename, delete, conditional UI (autofill),
passkey-first pre-auth registration, authenticator-name derivation, extensions.

**Expo/native caveat — unverified in our favour.** The plugin's "Expo Integration" section covers
**only** the `cookiePrefix` alignment needed so the WebAuthn challenge cookie survives SecureStore.
The docs do **not** document a native React Native WebAuthn bridge, and I could not verify from
primary sources whether `signIn.passkey` invokes the platform passkey APIs on iOS/Android or only
works in a web context. Treat native passkeys as unproven until prototyped.

---

## 6. Admin capabilities

Docs: <https://better-auth.com/docs/plugins/admin> (still in core, `better-auth/plugins`).

Everything the admin app needs at the API level exists:

- **Impersonation** — `auth.api.impersonateUser({ body: { userId } })` /
  `stopImpersonating()`. Creates a real session mimicking the user. Default duration **1 hour**,
  `impersonationSessionDuration` to change. Admins cannot impersonate other admins unless the role
  holds the `user: ["impersonate-admins"]` permission (`allowImpersonatingAdmins` is deprecated).
  Adds an `impersonatedBy` field to `session`.
- **Ban / unban** — `banUser` / `unbanUser`, with `banReason`, `banExpires`, `defaultBanReason`,
  `defaultBanExpiresIn`, `bannedUserMessage`. Adds `banned` / `banReason` / `banExpires` to `user`.
- **Session listing and revocation** — `listUserSessions`, `revokeUserSession`,
  `revokeUserSessions`.
- **User CRUD** — `createUser`, `listUsers` (paginated/sortable/filterable), `getUser`,
  `updateUser`, `setUserRole`, `setUserPassword`, `removeUser`.

**Its own separate RBAC.** The admin plugin has a *second* access-control system, distinct from
the organization plugin's. Default roles `admin` / `user`; statement
`user: [create, list, set-role, ban, impersonate, impersonate-admins, delete, set-password,
set-email, get, update]` and `session: [list, revoke, delete]`. Same
`createAccessControl`/`newRole` machinery, configured independently. Also `adminRoles: [...]` and
an escape hatch `adminUserIds: [...]`.

Gotcha: with email-enumeration protection on (`requireEmailVerification` or `autoSignIn: false`)
you must supply `customSyntheticUser` returning the admin fields in schema order, or the fake
sign-up response leaks the difference.

**No admin UI ships with the plugin.** The dashboard is the paid hosted product.

---

## 7. Pricing — what's actually paid

<https://better-auth.com/pricing> and <https://better-auth.com/docs/infrastructure/introduction>.

The framework is free and open source. Paid pricing applies only to **Better Auth Infrastructure**,
a hosted service you opt into with `@better-auth/infra` (`dash()`, `sentinel()`) plus an API key,
pointing at `dash.better-auth.com`.

- **Starter — free**: 1 dashboard seat, 10k audit logs/mo at 1-day retention, 1k security
  detections/mo, community support.
- **Pro — $20/mo**: unlimited seats, 20k audit logs/mo (then $0.0001/event), 10k detections/mo
  (then $0.001/event), self-service SSO & Directory Sync (1 connection, then $50/mo each),
  transactional email $0.001 and SMS $0.09, email templates, abuse protection, email support.
- **Enterprise — custom**: custom limits/retention, custom domain + log drain, dashboard RBAC,
  Slack support, MSA/DPA.
- Add-ons: custom domain $25/mo, log drain $25/mo.

The `dash()` plugin auto-collects a fixed taxonomy of audit events (`user_signed_up`,
`session_revoked`, `user_impersonated`, organization events, security events, …) — but **the logs
live in Better Auth's service, not our Postgres**. For a fork-and-go kit whose stated posture is
adapter-behind-env-var portability, this is a hosted dependency, not a library. Everything the kit
needs — audit log, admin UI — is on the paid side of that line.

---

## Gap list

What Better Auth does **not** give us, and what the kit has to build.

### Blocking for the vertical slice

1. **Tenant scoping of our own tables.** Better Auth scopes *its* tables to organizations. It has
   no opinion about `project.organizationId`, no row-level enforcement, no query helper. Every
   tRPC procedure touching tenant data must derive the org from the session and filter itself. We
   build: a tRPC `orgProcedure` middleware that resolves `activeOrganizationId` + the caller's
   member row, plus a Drizzle convention (and ideally a lint or test) that no tenant table is
   queried without an org predicate.

2. **Org context on the session is one ID and nothing else.** `getSession` returns
   `session.activeOrganizationId` — not the member row, not the role, not the permission set.
   Getting the role costs another call (`getActiveMemberRole` / `getFullOrganization`). The
   `customSession` plugin can inline it, **but the docs state custom fields are excluded from both
   cookie cache and secondary storage, so the callback runs on every session fetch**. We build:
   the org-context resolution for the tRPC context, and decide explicitly whether to eat a DB
   round-trip per request or denormalise the role into the session row via a database hook.

3. **Initial active organization.** Null on every sign-in. We build the
   `databaseHooks.session.create.before` hook that picks the user's org.

4. **The entire invite → accept UI and routing.** Better Auth gives `inviteMember` /
   `acceptInvitation` and a `sendInvitationEmail(data)` callback. It does not give: the invitation
   email template, the accept landing page, the "sign up first, then accept" routing, or the
   deep-link equivalent on Expo. The invite link format is ours to define. Note also that
   `acceptInvitation` requires an authenticated session.

5. **Mobile auth transport glue.** `authClient.getCookie()` is async and must be wired into the
   tRPC `httpBatchLink` headers, with `credentials: "omit"` on any raw fetch. Plus `trustedOrigins`
   wildcards that differ between dev (`exp://`) and prod (`myapp://`). We build and own that,
   and we should verify open issue
   [#10545](https://github.com/better-auth/better-auth/issues/10545) (`useSession` never updating
   after sign-in on RN) does not bite before committing the mobile half of the slice.

### Structural gaps the kit must decide on

6. **No unique constraint on membership.** `member(organizationId, userId)` is not unique in the
   generated schema, nor is `invitation(organizationId, email)`. Duplicate-membership safety is
   application-level. We should add the indexes ourselves in the Drizzle schema (which is ours to
   edit post-`generate`) and carry the diff across regenerations.

7. **Roles are a comma-separated string in one column.** No join table, no referential integrity
   on role names, no way to query "all admins of org X" without a `LIKE`. If the kit wants
   queryable role assignment, that is ours.

8. **Two unrelated RBAC systems.** The organization plugin and the admin plugin each have their own
   `createAccessControl` instance, statements and roles. The kit needs one story for "can this user
   do this", spanning platform-admin and org-member, and must decide whether to bridge them or keep
   them deliberately separate.

9. **One active org per session.** If the kit ever wants a user acting in two orgs concurrently
   (two tabs, or a mobile app with an org switcher that does not mutate server state), the
   `activeOrganizationId` column will not carry it. Options: client-held org ID passed explicitly
   in the tRPC context and validated against membership server-side — which is arguably the better
   design for us anyway, since it makes the org an explicit argument rather than ambient session
   state.

10. **Audit log.** Not in the OSS library at all. The only first-party audit log is the paid
    hosted `dash()` service, storing events off-premises. The map lists audit log as unspecified —
    Better Auth does not close it. We build a Postgres audit log, and if we want auth events in it
    we wire them ourselves from `databaseHooks` and `organizationHooks`.

11. **Admin UI.** The plugin is API-only. The admin app's screens (user list, ban, impersonate,
    session table) are entirely ours.

12. **Self-service SSO onboarding.** `registerSSOProvider` is a server API. The customer-facing
    "paste your SAML metadata here" flow is the paid dashboard. If the kit wants self-service SSO,
    we build that UI on top of the free `@better-auth/sso` API.

13. **No org-scoped billing link.** Better Auth has `@better-auth/stripe` and a Polar plugin, but
    the map locks Polar behind an adapter for Stripe swap. The Better Auth billing plugins are
    their own opinion and probably collide with our payments adapter — a separate ticket, but worth
    flagging that adopting `@better-auth/stripe` would undercut the adapter boundary.

14. **Typed env / typed errors.** Better Auth has its own error-code surface
    (<https://better-auth.com/docs/reference/errors>); mapping it into the kit's error taxonomy and
    into both clients' UI states is ours.

### Risk register

- **Schema churn.** The `account.issuer` column that shipped required in 1.7.0 and was withdrawn in
  1.7.3 is a live example of core-schema churn inside a patch series. The project has now stated a
  commitment to core-schema stability through v1, but a fork-and-go kit inherits every such
  migration. Pin exact versions; treat `auth generate` output as reviewed code.
- **Hard-fail schema validation (1.7.3+).** Drift between our Drizzle schema and the DB now rejects
  auth requests in production. Our migration story needs a CI check that `auth generate` is a
  no-op against the committed schema.
- **Ownership.** Vercel acquisition (2026-07-07) with an open-source intent statement but no
  licensing or governance commitment. Current code is MIT; that is the only verifiable guarantee.
- **Native passkeys unverified.** See §5.

---

## Sources

- <https://registry.npmjs.org/better-auth> and the per-package registry documents for
  `@better-auth/{sso,scim,expo,drizzle-adapter,passkey}` and `auth`
- <https://api.github.com/repos/better-auth/better-auth/releases>
- <https://github.com/better-auth/better-auth/blob/v1.7.5/packages/better-auth/src/plugins/organization/schema.ts>
- <https://github.com/better-auth/better-auth/tree/v1.7.5/packages>
- <https://better-auth.com/docs/plugins/organization>
- <https://better-auth.com/docs/plugins/admin>
- <https://better-auth.com/docs/plugins/sso>
- <https://better-auth.com/docs/plugins/scim>
- <https://better-auth.com/docs/plugins/2fa>
- <https://better-auth.com/docs/plugins/passkey>
- <https://better-auth.com/docs/plugins/bearer>
- <https://better-auth.com/docs/plugins/multi-session>
- <https://better-auth.com/docs/adapters/drizzle>
- <https://better-auth.com/docs/integrations/expo>
- <https://better-auth.com/docs/integrations/hono>
- <https://better-auth.com/docs/concepts/cli>
- <https://better-auth.com/docs/concepts/session-management>
- <https://better-auth.com/docs/guides/1-7-upgrade-guide>
- <https://better-auth.com/docs/infrastructure/introduction>,
  <https://better-auth.com/docs/infrastructure/plugins/audit-logs>
- <https://better-auth.com/pricing>
- <https://better-auth.com/blog/better-auth-joins-vercel>, <https://better-auth.com/blog/1-7>
- GitHub issues [#10545](https://github.com/better-auth/better-auth/issues/10545),
  [#11160](https://github.com/better-auth/better-auth/issues/11160),
  [#10253](https://github.com/better-auth/better-auth/issues/10253),
  [#11287](https://github.com/better-auth/better-auth/issues/11287)
