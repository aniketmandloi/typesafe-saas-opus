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
_Avoid_: Application, target, project

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
An implementation of an infrastructure capability (storage, email, queue, billing) behind a kit-owned interface, selected at boot. Only adapter packages may import a provider SDK.
_Avoid_: Provider, driver, integration

**Job**:
A unit of deferred work identified by a typed payload, enqueued by a use case and drained elsewhere. Not a resumable multi-step run — the kit has no durable execution.
_Avoid_: Task, workflow, background process
