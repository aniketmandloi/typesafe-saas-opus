import type { Assert, Exact } from "@repo/validators";
import type { inferRouterOutputs } from "@trpc/server";

import type { AppRouter } from "./index.ts";

/**
 * The wire shape, pinned (ADR-0014).
 *
 * The contract carries no transformer, so a `Date` leaves the resolver and
 * arrives at both clients as an ISO string. tRPC infers that correctly — which
 * is the problem this file exists for: nobody *wrote* it down, so the day
 * someone adds superjson, every client type in the repo changes at once and
 * most call sites keep compiling. This assertion makes that a build failure.
 *
 * One representative procedure is enough. The claim is about the transformer,
 * not about `projects.list`.
 */
// `inferRouterOutputs` hands back the resolver's return type, promise and all.
type ProjectOnTheWire = Awaited<inferRouterOutputs<AppRouter>["projects"]["list"]>[number];

export type _TimestampsCrossAsStrings = Assert<Exact<ProjectOnTheWire["createdAt"], string>>;
