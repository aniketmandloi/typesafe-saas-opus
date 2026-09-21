// The tie between a Validator and its Schema (ADR-0013).
//
// `@repo/schema` is `server`-tagged and reaches this package type-only, so the
// tables are never in a client bundle. What crosses is the *type*, and these
// helpers are what turn that into a compile error when a validator and its
// table stop agreeing.

// Equality, not assignability. Assignability accepts a validator that widened —
// `z.string()` where the column is a union — which is exactly the drift worth
// catching.
export type Exact<A, B> =
  (<T>() => T extends A ? 1 : 2) extends <T>() => T extends B ? 1 : 2 ? true : false;

export type Assert<T extends true> = T;

export type KeysMatch<TValidator, TColumns> = Exact<keyof TValidator, TColumns>;

// Optionality is normalised away on purpose. A table says what the *database*
// requires (a defaulted column is optional to an INSERT); a validator says what
// a *client* must send. Those are allowed to differ, and `exactOptionalPropertyTypes`
// would otherwise make every nullable column a false positive. What must agree
// is the key set and the value type.
type Normalize<T> = { [K in keyof T]-?: T[K] | undefined };

export type ShapesMatch<TValidator, TRow> = Exact<Normalize<TValidator>, Normalize<TRow>>;
