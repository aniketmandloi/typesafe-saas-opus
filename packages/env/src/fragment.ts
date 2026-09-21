import { z } from "zod";

// An env fragment is a piece of a deployment's environment contract. Adapters
// export one each, and a deployment profile composes exactly the fragments its
// adapters need — so a deployment requires exactly its providers' variables and
// nothing else (#15, ADR-0004).
//
// The type has a `server` field and no `public` field, on purpose. No adapter
// ever has a public variable: anything a client needs is app configuration,
// declared in the flat public schema and reaching the bundle through that app's
// access map. Making that structural means the invariant cannot be violated by
// someone adding a field in good faith.
export type EnvFragment = {
  name: string;
  server: z.ZodRawShape;
};

export const fragment = (name: string, server: z.ZodRawShape): EnvFragment => ({ name, server });

// Lambda caps all environment variables at 4 KB in aggregate, so anything
// multi-line or unbounded — a signing key, service-account JSON, a cert bundle
// — is ineligible for env by construction (#15). Such values are fetched from a
// secrets manager at runtime instead. This makes that a parse error rather than
// a deploy that fails at 4096 bytes.
export const shortScalar = (max = 1024) =>
  z
    .string()
    .min(1)
    .max(max)
    .refine((value) => !value.includes("\n"), {
      message:
        "Environment variables must be single-line. Multi-line values belong in a secrets manager, not in env — Lambda caps all vars at 4 KB in aggregate.",
    });

export const composeServerSchema = (...fragments: EnvFragment[]) => {
  const shape: Record<string, z.core.$ZodType> = {};
  const seen = new Map<string, string>();
  for (const part of fragments) {
    for (const [key, schema] of Object.entries(part.server)) {
      const owner = seen.get(key);
      // Two fragments declaring the same variable differently is the kind of
      // thing that resolves silently into whichever composed last. Refuse.
      if (owner && owner !== part.name) {
        throw new Error(
          `Environment variable ${key} is declared by both "${owner}" and "${part.name}". A variable belongs to exactly one fragment.`,
        );
      }
      seen.set(key, part.name);
      shape[key] = schema;
    }
  }
  return z.object(shape);
};
