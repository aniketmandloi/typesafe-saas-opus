# The kit owns the Drizzle declaration of Better Auth's tables

Better Auth's tables stay canonical ([ADR-0009](./0009-better-auth-is-an-identity-store.md)) and remain the rows `@repo/schema` foreign-keys into, but the **Drizzle declaration of them is the kit's own source file**, hand-maintained, not regenerated output. `@better-auth/cli` is used exactly once to bootstrap that file and is never a dependency. The compatibility oracle is the adapter's own schema check, awaited directly in a test.

This is the opposite of the documented path, so the reasons matter. All of them were verified against the shipped source and a running probe, not the docs.

**Generation is destructive.** Both Drizzle generators — the CLI's and the one inside `@better-auth/drizzle-adapter` — compose the file from scratch and return `overwrite: fileExist`. Neither ever reads what is already there. Any index, comment or kit column in the generated file is silently destroyed by the next `generate`.

**The generator that runs is two minors stale, and it wins silently.** `@better-auth/cli` is pinned at 1.4.21 (depending on `better-auth@1.4.22`) while the kit is on 1.7.5. Its dispatch is `adapter.id in adapters ? adapters[adapter.id] : adapter.createSchema`, so its **own** 1.4.x generator takes priority over the current one the installed adapter provides. The 1.4.x generator understands only per-field `attr.index`; 1.7.5's table-level `indexes` — multi-column, resolved through `getAuthTablesWithResolvedIndexes` — are dropped without a warning. So the one mechanism that would have let config-declared indexes survive regeneration is exactly the mechanism the tool in the documented workflow discards.

Those two together kill the regenerate-and-commit path. Owning the file removes the hazard entirely rather than defending against it, and it makes ADR-0009's claim literal: the tables survive re-examination *because they are ordinary Postgres tables in our own database*, and now they are declared like the rest of our tables.

## The gate, and what it does not do

`(await auth.$context).checkSchema()` is awaited directly in a test. It needs **no database** — `findDrizzleSchemaProblems` diffs `getExpectedSchema(options)` against an introspection of the Drizzle *declaration* — so it runs as a fast unit test on every pull request, and it ships at the library's own version, immune to the CLI skew above.

**It must be awaited, because nothing fails closed.** `createBetterAuth` does `pendingSchemaCheck.catch(err => ctx.logger.error(...))`. Schema drift is a logged error and the instance serves traffic regardless. Earlier notes in this effort recorded that Better Auth 1.7.3+ fails closed in production; that is not true of 1.7.5, and a gate built on instance construction alone would have caught nothing.

Nine mutations against a real 1.7.5 instance establish its exact reach. It catches **missing tables** and **missing columns**. It does **not** catch a renamed physical column (`boolean("email_verified_x")` passes, because both sides compare the Drizzle property name and the physical name is never examined), a changed type, dropped nullability, or a removed index. It correctly tolerates extra columns and extra indexes of ours — which is why ADR-0007's `deleted_at` on `organization` passes.

So the static gate covers the case that actually occurs on a version bump: Better Auth starts requiring a column we do not declare. The classes it misses are covered **behaviourally**, by a Testcontainers smoke test that signs up a user, creates an Organization and accepts an invitation against the real migrated database. A real `INSERT` is a better oracle than any static comparator for type, nullability and physical-name drift.

Writing our own stricter comparator on `getExpectedSchema` was rejected: it means maintaining a copy of Better Auth's field semantics against an internal API, to duplicate work upstream will eventually do — the diffuse coupling ADR-0009 exists to prevent.

**A kit column on a Better Auth table is nullable or carries a default.** The source comments in `diffSchema` describe this rule, but it is **not enforced** against a Drizzle declaration: a `NOT NULL` column with no default passes the check and then breaks every Better Auth insert at runtime. The smoke test is what actually catches it.

## Consequences

**An upgrade is: bump the version, run the gate, read `SchemaMismatchError`.** It names the missing tables and columns, which is enough to hand-apply to the declaration. This replaces ADR-0009's first upgrade gate — `auth generate` is no longer a no-op assertion, because there is no generated file to assert against.

**`@better-auth/cli` is not a devDependency.** Keeping it would invite someone to re-run `generate` and clobber a file the kit owns, which is the destructive overwrite this ADR exists to avoid. Bootstrap is a one-time `npx` against a temporary config that passes no `schema`, since the real config imports the file being generated.

**The declaration is `@repo/schema`'s, so it obeys the same rules as every other table.** One declaration, inferred everywhere, and the auth tables become ordinary migration targets rather than a second thing that moves on its own schedule.
