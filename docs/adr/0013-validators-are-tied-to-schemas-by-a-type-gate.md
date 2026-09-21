# Validators are tied to Schemas by a type gate, not a runtime derivation

The Drizzle table definitions become **server-only**: `@repo/schema` is retagged `server` and a new `universal` `@repo/validators` holds the validators clients run, declared as plain Zod and tied to the tables by a **type-level assertion** rather than by `createInsertSchema` executing in the bundle. `@repo/validators` declares `@repo/schema` as a `typeOnly` dependency, so `check-graph` proves every import of it is erased.

The kit's typesafety contract is unchanged — a persisted shape is declared exactly once, in the table — but the mechanism enforcing it moves from an unbroken runtime derivation chain to a gate that fails the build. That is the same shape [ADR-0011](./0011-kit-owns-the-auth-schema-declaration.md) settled on for the identity tables, for the same reason: what the kit needs is that drift cannot land, not that one call produces the other.

## What the runtime derivation actually cost, and what it actually bought

Measured on the real iOS Hermes bytecode at phase 9 of the vertical slice: importing `@repo/schema` from one mobile screen added **825 KiB, 18.8% of the bundle**, because validators derived from Drizzle tables ship `drizzle-orm/pg-core` to a phone. Metro's tree shaker has been on by default since SDK 54 and did not remove it, which is expected — `pgTable(...)` calls are module-scope side effects, the documented case tree shaking cannot touch.

What that bought at runtime was **nothing**. Every validator any client or procedure runs was already hand-written Zod:

- `insertProjectSchema` picks `name` and `description`, and overrides both.
- `requestUploadSchema` picks three columns and overrides all three.
- `updateProjectSchema` is `insertProjectSchema.partial().extend({ id: z.string().min(1) })`.

The overrides were not a shortcut. drizzle-zod 0.8.3's documented refinement callbacks (`(schema) => schema.min(1)`) do not typecheck against a `text()` column under TypeScript 6 or 7, so a whole-schema override was the only form that compiled. The second declaration the typesafety contract forbids therefore **already existed**, written under protest, and the 825 KiB was buying the *type* tie alone: `createInsertSchema(project, { … }).pick({ … })` is typed against the columns, so a renamed or dropped column was a compile error.

The two genuinely-derived validators, `selectProjectSchema` and `selectUploadSchema`, had **no consumers anywhere in the repo** — not server, not tests, not either client. They are deleted. Clients read row types off the tRPC client, which is the correct idiom regardless.

So this decision does not trade typesafety for bytes. It replaces an implicit type tie that cost 825 KiB with an explicit one that costs nothing, and deletes the dead weight beside it.

## The gate

A type-level mutual-assignability assertion per validator, in `@repo/validators`, against a type-only import of the table's inferred insert type. It runs in the existing `typecheck` task on every pull request and needs no database — the property [ADR-0012](./0012-migrations-are-a-deploy-step-under-their-own-profile.md) and [ADR-0011](./0011-kit-owns-the-auth-schema-declaration.md) both depend on.

It asserts two things: that **the picked subset matches** the table (catching a rename, a retype or a removal), and that **every client-suppliable column is covered** (catching a new column going silently unvalidated). The second half is new — `.pick()` never checked it, so adding a column to `project` that a client should supply has always been silently unvalidated.

A runtime test comparing `createInsertSchema(table)`'s key set against the validator was considered and rejected: it catches nothing the type error does not catch earlier, and it would put `drizzle-zod` back in a package that exists to not have it.

**The gate's ceiling, stated plainly**: it cannot check `min(1)` or `max(200)` against the database, because `text()` carries no length. Those constraints are unbacked by the schema today and remain unbacked. Nothing here made that worse; it is simply now written down.

## Consequences

**A `universal` package may not declare `drizzle-orm` or `drizzle-zod`**, enforced by a denylist in `check-graph.ts`. The platform tag alone does not cover this: the checker only inspects `@repo/*` edges, so the next person who wants a derived validator on the client would reach for `drizzle-zod` directly and nothing would stop them. The reason in the comment is bundle weight, not correctness.

**`@repo/core` declares its `@repo/schema` edge as `typeOnly`.** Its imports are already `import type`; only the declaration was missing.

**The mobile bundle keeps Zod.** Dropping from 34% to ~15% leaves [#15](https://github.com/aniketmandloi/typesafe-saas-opus/issues/15)'s knowingly-accepted 663 KiB, which is a different decision and is not reopened here.

**Someone will try to undo this.** A universal package that does not derive its validators from the tables looks, at a glance, exactly like the second declaration the kit forbids. It is not, and the denylist plus this ADR are what say so.
