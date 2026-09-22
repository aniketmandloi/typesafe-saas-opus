# Typesafe SaaS Starter Kit

A private, fork-and-go TypeScript monorepo for launching SaaS products. This glossary fixes the words the kit uses about itself, so that a decision recorded in one place reads the same everywhere.

## Language

### The kit and its users

**Kit**:
This repository: the starter every product is forked from.
_Avoid_: Template, boilerplate, framework

**Cloner**:
Someone who forks the kit to build a product with it. The kit's audience, distinct from an end user of a product built on it.
_Avoid_: Consumer, developer, user

### The workspace

**App**:
A deployable unit in `apps/`. Nothing imports an app.
_Avoid_: Application, target

**Package**:
A shared unit in `packages/`, imported by apps and by other packages, published nowhere and consumed as TypeScript source.
_Avoid_: Library, module, workspace

**Platform tag**:
The declared runtime compatibility of an app or package — `universal`, `server`, `web`, `native` or `none`. One tag per package, never per subpath: a package is either safe for mobile or it isn't.
_Avoid_: Environment, runtime tag, target

**Layer**:
A package's position in the one-way import order. A lower layer never imports a higher one.
_Avoid_: Tier, level, ring

### What lives where

**Schema**:
The Drizzle table definitions — the single declaration of every persisted shape, from which all other types are inferred. Includes the identity tables: the kit declares them itself rather than consuming generated output, so there is one declaration and no second thing moving on its own schedule. Server-only: a table definition is not safe to run on a phone.
_Avoid_: Model, entity definition, DTO

**Validator**:
The declaration of what a client may send — a persisted shape's input surface, tied to its Schema by a type gate and never by a runtime derivation. The only persisted-shape artifact safe to run on a phone, which is what keeps the tables out of a mobile bundle.
_Avoid_: DTO, input type, form schema

**Domain rule**:
A pure function over inferred schema types expressing an invariant or a permitted transition. No I/O.
_Avoid_: Business logic, service, domain object

**Use case**:
Server-side orchestration of a single intent: opens the transaction, calls the domain rules, writes, emits. Lives beside the router, not in a package of its own.
_Avoid_: Service, handler, interactor, command

**Contract**:
The tRPC router type, the one description of what the server offers. Clients consume it as a type and never at runtime.
_Avoid_: API, interface, schema

**Wire shape**:
What a value looks like on the far side of JSON — the Contract's output type, which may legitimately differ from its Schema type and is the truth about that value at the edge. A timestamp is a `Date` in the Schema and an ISO-8601 string in its Wire shape; nothing reconciles the two, because the Contract carries no transformer.
_Avoid_: Serialized form, payload type, DTO

**Entrypoint**:
The per-target leaf that mounts an app for one deployment target, and the earliest hook on its platform that runs with a real environment before anything depending on configuration. It is the only place target-specific code may appear, and the only place configuration is parsed. Every App has one, not only the server.
_Avoid_: Handler, adapter, bootstrap

**Deployment profile**:
The set of Adapters one deployment composes, and therefore the exact environment variables that deployment requires. A property of *where* a deployment runs, never of how it is invoked, so every Entrypoint of the same deployment shares one profile.
_Avoid_: Environment, stage, preset

**Env fragment**:
The slice of an environment schema declared by whatever owns those variables — an Adapter package, or the kit itself. A Deployment profile composes only the fragments of the Adapters it wired, so a deployment requires exactly its own providers' variables and nothing more. An environment schema is not a **Schema** in this glossary's sense; that word is reserved for persisted shapes.
_Avoid_: Config block, partial schema

**Adapter**:
An implementation of an infrastructure capability (storage, email, queue, billing) behind a kit-owned interface, chosen by the entrypoint at composition rather than at run time. Only adapter packages may import a provider SDK.
_Avoid_: Provider, driver, integration

**Identity store**:
Better Auth and the tables it generates: the canonical record of who a user is, which sessions exist, and who belongs to which Organization. Its tables are read and written directly by the kit's own use cases, and it is never an Adapter, because those tables live in our own database and there is nothing to substitute.
_Avoid_: Auth provider, auth service, auth layer

**Job**:
A unit of deferred work identified by a typed payload, enqueued by a use case and drained elsewhere. Not a resumable multi-step run — the kit has no durable execution.
_Avoid_: Task, workflow, background process

**Job envelope**:
The seam-owned metadata carried beside a Job's payload — today, the trace context that joins a Job back to the request that enqueued it. Every driver carries it and no handler ever reads it, which is the test that distinguishes it from payload: payload is what the work is about, envelope is how the system talks about the work.
_Avoid_: Headers, metadata, job options

**Worker**:
The Entrypoint that drains Jobs instead of serving requests. It shares its deployment's profile and differs from the serving Entrypoint only in how it is invoked, so it is never an App of its own — there is one per target, not one per kit.
_Avoid_: Worker app, background service, consumer, daemon

**Dropped Job**:
A Job completed without being run, because its handler could not open the tenant the work was for. Distinct from a failed Job, which retries: a drop is the right outcome for work whose Organization went Dark after it was enqueued, and it is never an Audit entry.
_Avoid_: Skipped job, cancelled job, discarded job

### Tenancy

**Organization**:
The tenant. Every piece of product data belongs to exactly one, and there is no isolation boundary above or below it.
_Avoid_: Account, Workspace, Team, Tenant

**Personal Organization**:
The Organization auto-created for a user at signup, carrying a flag that is cleared in place the first time its owner invites someone. There is no org-less mode, so this is what makes the solo-to-team path move no data: the Organization is promoted, never replaced.
_Avoid_: Personal workspace, default org, solo mode

**Membership**:
A user's participation in one Organization, carrying exactly one Role. A user may hold memberships in many Organizations.
_Avoid_: Affiliation, Org user

**Role**:
A membership's position in its Organization, drawn from a closed set — owner, admin, member — and the only thing permissions are derived from.
_Avoid_: Permission, Access level, Scope

**Project**:
The tenant-owned resource the kit ships as its worked example: the thing the vertical slice creates, lists and deletes. A cloner replaces it with their own domain. Never a deployable unit in `apps/` — that is an App.
_Avoid_: Item, Resource, Entity

**Dark**:
The state of an Organization between a deletion request and its Purge: reachable by no tenant-scoped code, causing nothing it would otherwise have caused, yet still wholly present. Distinct from an Organization that simply has no active subscription.
_Avoid_: Disabled, suspended, archived, deactivated

**Grace window**:
The fixed period an Organization stays Dark before it is purged, and the only period in which a deletion can be taken back.
_Avoid_: Retention period, soft-delete window, cooling-off period

**Purge**:
The irreversible destruction of everything one Organization owns — its records, its stored files and its billing customer. The only act in the kit that removes tenant data.
_Avoid_: Hard delete, cleanup, reaping, GC

### Operating the kit

**Admin app**:
The platform operator's own surface onto every tenant: the place support and operations staff answer questions about accounts. Distinct from Org settings, which belongs to the customer.
_Avoid_: Back-office, console, dashboard

**Org settings**:
The in-product surface where an Organization manages its own members, roles, billing and profile. Ordinary tenant-scoped product surface with no special powers.
_Avoid_: Admin, org admin, admin panel

**Platform role**:
A staff position held by the kit operator's own people, governing what the Admin app permits. Entirely separate from Role, which governs a Membership inside one Organization.
_Avoid_: Superadmin, staff role, global role

**Audit entry**:
The record that one intent occurred: who acted, in which Organization if any, against what. It names the action and its target and never carries the values that changed, which is what keeps the log readable by platform staff without becoming a view onto tenant content.
_Avoid_: Log line, event, history record, activity

**Telemetry**:
Traces, logs and error reports: sampled, stored outside our database and disposable. The deliberate opposite of an Audit entry in every property that matters — an Audit entry is durable, tenant-readable and written in the caller's transaction, and Purge reaches it. Purge does not reach Telemetry, which is why the two are never the same record and never share a path.
_Avoid_: Observability data, monitoring, logs, events

**Rate limit bucket**:
One caller's consumption of one quota over a rolling window, keyed on an identity the server has verified rather than one the caller claimed. Neither an Audit entry nor Telemetry: it lives in our database but records no intent, and it outlives nothing — which is why Purge has no work to do against it.
_Avoid_: Quota, counter, throttle, window

**Actor**:
Whoever an Audit entry attributes an action to — a member, a platform staff member, a Job or an incoming webhook. Never merely a user id: a Job and a webhook act with no user behind them at all, and an impersonated action has two parties at once.
_Avoid_: User, subject, principal

**Impersonation**:
A platform staff member acting as a member of one Organization, time-boxed and audited, and the only way platform staff reach tenant content. Distinct from holding a Role: it borrows an identity rather than granting a permission.
_Avoid_: Sudo, assume identity, masquerade, act-as
