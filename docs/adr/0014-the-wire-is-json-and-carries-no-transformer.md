# The wire is JSON and the contract carries no transformer

The tRPC contract carries **no transformer** — not superjson, not a reviver, not a hand-rolled one. What crosses the wire is JSON, **the contract's inferred output type is the truth about a value at the edge**, and a value whose JS type is not JSON-representable has a declared crossing rather than a serializer that hides the gap.

So `project.createdAt` is a `Date` in the Schema and a `string` at both clients, and that is correct rather than a defect. Clients read their row types off the tRPC client, never off `@repo/schema` — which [ADR-0013](./0013-validators-are-tied-to-schemas-by-a-type-gate.md) has since made structural, since `@repo/schema` is `server`-tagged and a client cannot import it without declaring a type-only edge that `check-graph` would have to accept.

## Why not a transformer

The case for one is that it closes the gap: with superjson, a `Date` round-trips, the client type matches the Schema type, and `@repo/core`'s domain rules — which take `Date` and call `.getTime()` — become callable from a screen.

That last point is the only real argument, and it rests on a premise the kit rejects. **`@repo/core` being `universal` means it imports nothing server-only; it does not mean screens compute domain answers.** `invitationRefusal` is the example that settles it: the order of its checks is a security property — the recipient is checked *last*, so an expired link never reveals whose invitation it was — and the procedure maps its result to `NOT_FOUND` precisely so the client learns nothing it shouldn't. A rule like that belongs to the server's answer. A client that renders what it is told does not need a `Date` to do it.

With that gone, what remains is cost: a dependency in the contract and in every client, every payload wrapped in `{ json, meta }`, four call sites (server plus three client factories) that must agree or break at run time, and more bytes on a phone the week [ADR-0013](./0013-validators-are-tied-to-schemas-by-a-type-gate.md) spent 825 KiB getting off one.

**Better Auth's client is not a counter-argument, though it looks like one.** It revives ISO-8601 strings into `Date` objects by default — `betterJSONParse` runs with `parseDates = true` — so `apps/web` genuinely ships two date conventions in one bundle: `authClient.getSession()` returns `Date`, the tRPC client returns `string`. That divergence is accepted, because the way Better Auth achieves parity is the way not to: its reviver is **shape-blind**, turning *any* string matching the ISO regex into a `Date`, including a user-typed field that happens to look like a timestamp. Matching its convention would import that hazard. If the kit ever does adopt a transformer, it must be the explicit-metadata kind, never a reviver.

## The rule

- What crosses the wire is JSON. The contract's inferred output type is the truth about a value at the edge.
- A column whose JS type is not JSON-representable must have a **declared crossing**. Known ones: `timestamp` crosses as an **ISO-8601 string**; `numeric` and money cross as a **string, never a float**; `bigint({ mode: "bigint" })` crosses as a **string**. `bigint({ mode: "number" })` — what `upload.byteSize` uses — is already a number and crosses as one.
- **This binds inputs too.** A date-valued input is declared as an ISO string and parsed by its Zod validator, because a JSON body cannot carry anything else. `z.date()` on a procedure input cannot parse what a client is able to send.
- **Conversion happens at the point of use**: a screen that renders a timestamp writes `new Date(row.createdAt)`. The kit ships no helper for this — it would wrap a one-argument constructor and imply a subtlety that isn't there — and procedures do not return preformatted display strings, because formatting is locale- and viewport-dependent and the kit shares no UI across platforms.

## Consequences

**The wire shape is inferred, not declared, and that is the risk this ADR carries.** Resolvers return Drizzle rows and tRPC reports `string` to clients without anyone writing it down. The day someone adds a transformer, every client type in the repo changes at once and most call sites keep compiling. The guard is a **type-level assertion pinning the wire shape of one representative procedure**, so that change fails the build instead of landing silently. Hand-mapping timestamps in every procedure was the alternative and was rejected: it buys the same protection at the price of a second declaration of every row, maintained forever.

**Two date conventions ship in one client bundle**, deliberately, and a cloner will meet both.
