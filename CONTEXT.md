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
The Drizzle table definitions and the validators derived from them — the single declaration of every persisted shape, from which all other types are inferred.
_Avoid_: Model, entity definition, DTO

**Domain rule**:
A pure function over inferred schema types expressing an invariant or a permitted transition. No I/O.
_Avoid_: Business logic, service, domain object

**Use case**:
Server-side orchestration of a single intent: opens the transaction, calls the domain rules, writes, emits. Lives beside the router, not in a package of its own.
_Avoid_: Service, handler, interactor, command

**Contract**:
The tRPC router type, the one description of what the server offers. Clients consume it as a type and never at runtime.
_Avoid_: API, interface, schema

**Entrypoint**:
The per-target leaf that mounts the server app for one deployment target. It is the only place target-specific code may appear.
_Avoid_: Handler, adapter, bootstrap

**Adapter**:
An implementation of an infrastructure capability (storage, email, queue, billing) behind a kit-owned interface, chosen by the entrypoint at composition rather than at run time. Only adapter packages may import a provider SDK.
_Avoid_: Provider, driver, integration

**Job**:
A unit of deferred work identified by a typed payload, enqueued by a use case and drained elsewhere. Not a resumable multi-step run — the kit has no durable execution.
_Avoid_: Task, workflow, background process

### Tenancy

**Organization**:
The tenant. Every piece of product data belongs to exactly one, and there is no isolation boundary above or below it.
_Avoid_: Account, Workspace, Team, Tenant

**Membership**:
A user's participation in one Organization, carrying exactly one Role. A user may hold memberships in many Organizations.
_Avoid_: Affiliation, Org user

**Role**:
A membership's position in its Organization, drawn from a closed set — owner, admin, member — and the only thing permissions are derived from.
_Avoid_: Permission, Access level, Scope

**Project**:
The tenant-owned resource the kit ships as its worked example: the thing the vertical slice creates, lists and deletes. A cloner replaces it with their own domain. Never a deployable unit in `apps/` — that is an App.
_Avoid_: Item, Resource, Entity

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
