// Who an audit entry attributes an action to. A Job and a webhook act with no
// user behind them at all, so an actor is never merely a user id (ADR-0008).
//
// Universal rather than server-side, because the Admin app reads the log and is
// `web`-tagged (#11): it cannot import the package that writes it.
//
// How an impersonated action is attributed is deliberately not settled here.
// The glossary says it has two parties at once and the table has one actor, and
// nothing in the vertical slice impersonates — inventing an encoding now would
// be deciding it by accident.
export const ACTOR_TYPES = ["member", "platform", "job", "webhook"] as const;
export type ActorType = (typeof ACTOR_TYPES)[number];
