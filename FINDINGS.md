# What `checkSchema()` actually catches — spike findings

Answers part 2 of [#21](https://github.com/aniketmandloi/typesafe-saas-opus/issues/21).
Branch `spike/schema-check`, throwaway. macOS arm64, Node 24.16.0, 2026-09-21.
`better-auth` 1.7.5, `@better-auth/drizzle-adapter` 1.7.5, `drizzle-orm` 0.45.2,
bootstrapped with `@better-auth/cli` 1.4.21.

```sh
npm install
./mutate.sh
```

## Two corrections to things this effort had recorded

**Better Auth 1.7.5 does not fail closed on schema drift.** `createBetterAuth` does
`pendingSchemaCheck.catch(err => ctx.logger.error(...))` — the instance logs and serves
traffic anyway. A CI gate built on instance construction catches nothing; it must
`await (await auth.$context).checkSchema()` and fail on rejection.

**The 1.4.x CLI's output does satisfy the 1.7.5 check.** The generator is two minors
stale, but the schema it emits passes cleanly, so it is usable for one-time bootstrap.

## The mutation matrix

Every substitution asserts it matched. An earlier pass of this probe used
`str.replace` without an assertion, three patterns silently failed to match, and the
resulting "PASS" readings were meaningless — including the `NOT NULL` row below, which
had been recorded backwards. `mutate.sh` fails loudly instead.

| Mutation | Result |
| --- | --- |
| baseline, unmodified | PASS |
| extra **nullable** column (ADR-0007 `deleted_at`) | PASS — tolerated |
| extra **`NOT NULL`, no default** column | **REJECT** |
| extra `NOT NULL` **with default** column | PASS — tolerated |
| missing column (`user.image`) | **REJECT** — `Missing columns: user.image` |
| missing table | **REJECT** — `Missing tables: ...` |
| renamed physical column (`email_verified` → `email_verified_x`) | PASS — **not caught** |
| changed type (`text` → `boolean`) | PASS — **not caught** |
| dropped `.notNull()` | PASS — **not caught** |
| removed index | PASS — **not caught** |

## What that means

The check enforces exactly two rules, both from `diffSchema`:

1. **Every table and column Better Auth writes must exist.** Matched on the *Drizzle
   property name*, never the physical column name — which is why the rename passes.
   `getExpectedSchema` keys on `field.fieldName || key`, and Better Auth's own field
   names are camelCase, so both sides compare `emailVerified` and the physical
   `email_verified` is never examined.
2. **A column Better Auth does not write must accept an insert that omits it.** A kit
   column that is nullable or defaulted is fine; `NOT NULL` with no default is rejected.
   ADR-0007's `deleted_at` passes because it is nullable.

It says nothing about column types, nullability of columns Better Auth *does* write, or
indexes. Those are left to a behavioural test — a real sign-up, org create and invite
accept against a migrated database, where a wrong type or a missing index shows up as a
failing `INSERT` or a slow query rather than as a diff.

It needs **no database**: `findDrizzleSchemaProblems` introspects the Drizzle declaration
object, not a live connection. So it runs as a fast unit test on every pull request.
