# Polar: subscriptions, orgs and seats, webhooks

Research for [issue #5](https://github.com/aniketmandloi/typesafe-saas-opus/issues/5). Verified against
Polar's official docs, API reference, the `polarsource/*` GitHub repos and the npm registry on
**2026-09-19**. Fees, plan tiers and SDK versions are time-sensitive — re-check before relying on them.

## Verdict

Polar is a **good fit** for an org-scoped B2B kit, better than it was a year ago, with two caveats
worth naming up front:

1. **Org-owned subscriptions are natively supported.** Polar's `Customer` is a discriminated union
   of `individual` and `team`, and the team variant has `Member`s and `CustomerSeat`s. The kit's
   `Organization` maps 1:1 onto a `type: "team"` Customer keyed by `external_id`. This is a
   first-class model, not a metadata convention.
2. **The Better Auth ↔ Polar organization integration exists but is unpublished and marked
   `@experimental`.** The code is on `polar-adapters` `main` (v1.9.0) and looks serious, but npm's
   `latest` is still 1.8.4 from 2026-05-06, whose org story is metadata-only. See
   [Better Auth integration](#better-auth-integration).

The merchant-of-record model is the real constraint, and it is a **commercial** constraint, not a
technical one: no POs, no net terms, no invoice-first selling. That caps the kit's enterprise ceiling
regardless of how good the code is.

---

## Merchant-of-record implications

### What Polar handles

Polar is the merchant of record: "We take on the liability of international sales taxes globally for
you" — capturing and remitting VAT, GST and US sales tax, using Stripe Tax underneath, with
registrations maintained across jurisdictions and filings handled by partner accounting firms.
EU B2B reverse charge is handled without the seller registering.
([Tax](https://polar.sh/docs/merchant-of-record/tax))

### Fees (as of 2026-09-19)

Polar restructured pricing in 2026 — the widely-cited "4% + 40¢" headline is **no longer available to
new accounts**. Current published rates ([Fees](https://polar.sh/docs/merchant-of-record/fees),
[Pricing](https://polar.sh/resources/pricing)):

| Plan | Monthly | Per transaction |
| --- | --- | --- |
| Starter | Free | 5% + 50¢ |
| Pro | $20/mo | 3.8% + 40¢ |
| Growth | $100/mo | 3.6% + 35¢ |
| Scale | $400/mo | 3.4% + 30¢ |

- **Early Member** (organizations created before **2026-05-27**) is grandfathered at 4% + 40¢ with no
  monthly fee, plus +0.5% on subscription payments. Newer plans drop the subscription surcharge.
- +1.5% for international (non-US) cards.
- $15 per dispute "regardless of outcome".
- Payout fees are Stripe pass-through with no Polar markup: $2 per month with active payouts,
  0.25% + $0.25 per payout, currency conversion 0.25% (EU) to 1% elsewhere.
- Initial transaction fees are **not** refunded when you refund an order.
- Polar's own published breakeven points: Pro ≈ $1,379/mo, Growth ≈ $5,634/mo, Scale ≈ $19,048/mo.

Budget roughly **2.5–3x Stripe's 2.9% + 30¢** for the MoR convenience. That is the trade.

### Supported countries

Buyers are global (excluding US-sanctioned countries). **Sellers** are limited to countries where
Stripe Connect Express can pay out — ~150 countries listed, explicitly excluding Cuba, Russia, Iran,
North Korea and Syria. Business-type support (individual vs company vs LLC) varies by country.
([Supported countries](https://polar.sh/docs/merchant-of-record/supported-countries))

### What MoR blocks — the enterprise ceiling

This is the sharpest finding. Polar's `Order` object is a **transaction record, not an invoice-first
payment request**. Statuses are `pending`, `paid`, `refunded`, `partially_refunded`, `void`.
You can create a draft order off-session (`POST /v1/orders/`) against an existing customer with a
one-time product and finalize it (`POST /v1/orders/{id}/finalize`), and PDF invoices are generated
for paid orders — but that charges a stored payment method. ([Orders](https://polar.sh/docs/features/orders))

Not found anywhere in the docs:

- **Purchase order numbers** — no field.
- **Net terms / due dates** — no concept.
- **Send-an-invoice-for-the-buyer-to-pay** (ACH/wire against an open invoice) — not documented.
- **Custom contracts / MSAs** — inherently impossible under MoR: the contract of sale is between the
  buyer and *Polar*, not between the buyer and the kit's operator.

That last point is structural. An enterprise buyer who requires their own paper, their own DPA, or
their vendor to be the counterparty cannot be served through Polar at all. If the kit's users expect
to sell six-figure annual contracts, Polar is the wrong default and Stripe Invoicing (or a
direct-contract path alongside Polar) is required.

For self-serve and mid-market B2B — card-paid monthly/annual seats — Polar is fine, and the VAT
handling is a genuine saving.

---

## Subscription model fit

### Can a subscription be owned by an Organization rather than a User?

**Yes, natively.** This is the most important finding for this kit.

`CustomerState` is a discriminated union — `CustomerStateIndividual` and `CustomerStateTeam` — with a
`type` field of `"individual" | "team"`.
([Get customer state](https://polar.sh/docs/api-reference/2026-04/customers/get-customer-state))

`type` is settable **at creation**, not only implicitly. `POST /v1/customers` accepts `type: "team"`,
with `email` optional for teams (an `owner` member with an email must be supplied instead), plus
`external_id`, `name`, `billing_address`, `tax_id`, `metadata`, `locale`, `organization_id`, `owner`.
([Create customer](https://polar.sh/docs/api-reference/2026-04/customers/create-customer))

The seat-based pricing model defines three entities
([Seat-based pricing](https://polar.sh/docs/features/seat-based-pricing)):

- **Customer** — "the billing entity who owns subscriptions and payment methods", upgraded to
  `type: "team"` on first seat-based purchase.
- **Member** — an individual under a customer, with their own email, a role of `owner`,
  `billing_manager` or `member`, and **independent benefit grants**.
- **CustomerSeat** — links a product to a member, with status `pending` → `claimed` → `revoked` and an
  invitation token.

Crucially: *"Benefits are granted to members — identify end users by their member identity, not the
paying customer."* That is exactly the org-owns-subscription / user-consumes-entitlement split this
kit needs.

**Mapping for this kit:**

| Kit concept | Polar concept |
| --- | --- |
| `Organization` | `Customer` with `type: "team"`, `external_id = organization.id` |
| `OrganizationMember` | Polar `Member` (role `owner` / `billing_manager` / `member`) |
| Seat allocation | `CustomerSeat` (assign / claim / revoke) |
| Plan | `Product` + `Subscription` on the team Customer |
| Feature access | `granted_benefits` on customer state, per member |

Note `external_id` is "unique across your organization and can't be changed once set"
([Customer management](https://polar.sh/docs/features/customer-management)) — so the kit must key it
on an immutable org ID, never a slug.

Checkout attaches a customer via `external_customer_id` (note: the checkout field is
`external_customer_id`, while the customer object field is `external_id` — easy to get wrong), plus
`customer_billing_address`, `customer_tax_id`, `customer_metadata` and an `is_business_customer` flag
that forces billing name/address collection.
([Create checkout session](https://polar.sh/docs/api-reference/2026-04/checkouts/create-checkout-session))

### Seats

- Pricing models: fixed per seat, **graduated** tiers (each tier band at its own rate) and **volume**
  discounts (one rate chosen by total count, applied to all seats).
- Adding seats mid-cycle charges immediately, prorated; reducing seats issues a prorated credit.
- Revoking a seat removes a member's access **without** reducing the subscription quantity — reducing
  billed quantity is a separate `seats` update. This distinction is a likely source of drift bugs.
- Limits: **1,000 seats max per subscription**, claim links expire after **24 hours**, individual
  assignment only (bulk via API), 10 metadata keys / 1KB per seat, and the billing manager receives no
  product benefits themselves.
  ([Seat-based pricing](https://polar.sh/docs/features/seat-based-pricing))

### Plans, terms, upgrades, trials, discounts

All present ([Manage subscriptions](https://polar.sh/docs/features/subscriptions/manage)):

- **Upgrade/downgrade**: switch to a different recurring product via `PATCH` update-subscription.
- **Proration**: `invoice` and `prorate` apply immediately, `next_period` defers.
  ([Proration](https://polar.sh/docs/features/subscriptions/proration))
- **Quantity**: `seats` parameter.
- **Discounts**: `discount_id` attaches/removes on an active subscription, applying from the next
  cycle, not retroactively. ([Discounts](https://polar.sh/docs/features/discounts))
- **Trials**: configured on the product, checkout link or session (session overrides product);
  payment method is collected at checkout but not charged; unit is day/week/month/year; `trial_end`
  can be extended or set to `"now"`; status `trialing`; abuse prevention via email normalization and
  payment-method fingerprint. Card-free trials are **not** documented.
  ([Trials](https://polar.sh/docs/features/subscriptions/trials))
- **Pause/resume**: `pause_at_period_end`, optional `resumes_at`, `resume: true`.
- **Cancel**: `cancel_at_period_end: true`, or `DELETE` for immediate irreversible revocation;
  uncancel reverses a scheduled cancellation.
- **Reschedule renewal**: `current_billing_period_end`.
- **Usage-based**: event ingestion API + meters that filter by event name and aggregate a field;
  a "Meter Credits" benefit grants credits at each cycle start. Whether metered and seat pricing can
  coexist on one product is **not documented** — unverified.
  ([Usage-based billing](https://polar.sh/docs/features/usage-based-billing/introduction))

---

## Entitlements

Polar models feature access first-class, so the kit does **not** have to derive entitlements purely
from subscription state — though it will still want a local mirror.

Seven built-in benefit types ([Benefits](https://polar.sh/docs/features/benefits/introduction)):
Credits, License Keys, **Feature Flags**, File Downloads, GitHub repo access, Discord invite, Shared
Slack channel. There is **no generic "custom" benefit type** documented.

**Feature Flags** is the one that matters here: flags are defined in the Polar dashboard with optional
key-value metadata (e.g. role, upload limit, priority tier), granted at cycle start and revoked on
cancellation, and read through the customer state's `granted_benefits`.
([Feature flags benefit](https://polar.sh/docs/features/benefits/feature-flags))

**Customer State** is the intended integration seam: one object containing the customer, all
`active_subscriptions`, all `granted_benefits` and `active_meters` — *"with that single object, you
have all the required information to check if you should provision access to your service or not"* —
fetchable by your own external ID, and pushed via the `customer.state_changed` webhook.
([Customer state](https://polar.sh/docs/integrate/customer-state))

**Recommendation for the kit:** treat customer state as the source of truth, mirror it into a local
`entitlements` table keyed by org (and by member, for seat-granted benefits), and gate on the local
mirror. Do not call Polar on the request path. Using Polar Feature Flags as the *names* of
entitlements is tempting but couples the kit's authorization vocabulary to Polar — see swap cost.

---

## Webhooks

### Event catalogue

([Webhook events](https://polar.sh/docs/integrate/webhooks/events))

- **Checkout**: `checkout.created`, `checkout.updated`, `checkout.expired`
- **Customer**: `customer.created`, `customer.updated`, `customer.deleted`, `customer.state_changed`
- **Subscription**: `subscription.created`, `.active`, `.updated`, `.cycled`, `.canceled`,
  `.uncanceled`, `.past_due`, `.revoked`, `.paused`, `.resumed`, `.migrated`
- **Order**: `order.created`, `order.paid`, `order.updated`, `order.refunded`
- **Refund**: `refund.created`, `refund.updated`
- **Benefit grant**: `benefit_grant.created`, `.updated`, `.revoked`
- **Benefit / Product / Discount / Organization**: `benefit.created`, `benefit.updated`,
  `product.created`, `product.updated`, `discount.created`, `discount.updated`, `discount.deleted`,
  `organization.updated`

**Gap worth flagging:** no `customer_seat.*` or seat-specific events appear in the published
catalogue, and no meter/usage events. Seat assignment and claim transitions therefore surface only
indirectly — via `benefit_grant.*` for the member and `customer.state_changed`. If the kit needs to
react to "seat claimed", it will have to poll `GET /v1/customer-seats` or infer from benefit grants.

### Signature verification

Two schemes, split by secret creation date
([Webhook delivery](https://polar.sh/docs/integrate/webhooks/delivery)):

- Secrets created **on/after 2026-09-08**: [Standard Webhooks](https://www.standardwebhooks.com/),
  secret passed as-is.
- Secrets created **before** that: Polar's own HMAC, requiring the full `whsec_…` string to be
  base64-encoded before validation.

One `webhook-signature` header. SDK helpers: `validateEvent()` (TS) / `validate_event()` (Python).
The kit should create its secret fresh so it lands on Standard Webhooks and can use an off-the-shelf
verifier — this also *reduces* swap cost, since Standard Webhooks is a spec, not a Polar thing.

### Delivery guarantees

- Up to **10 retries** with exponential backoff.
- **10-second** request timeout; Polar recommends responding within **2 seconds**.
- Endpoint **auto-disabled after 10 consecutive non-2xx deliveries**, with email notification.
- **Ordering and idempotency guarantees are not documented.** Assume at-least-once and out-of-order.

**What must be mirrored locally:** org → Polar customer ID, subscription status + current period end +
product/plan, seat count and per-member seat status, and the derived entitlement set. Because
ordering is unguaranteed, the handler should be *state-refetching* rather than *event-applying*: on
any relevant event, call `GET /v1/customers/external/{id}/state` and overwrite the local mirror.
That also makes the handler idempotent for free.

---

## TypeScript SDK and sandbox

### The SDK is mid-migration — this is the biggest maintenance risk

`polarsource/polar-js` (the repo behind `@polar-sh/sdk` 0.x) carries this banner on its README as of
today:

> **This SDK is now deprecated and archived.** We now have a new TypeScript SDK with a new home:
> https://github.com/polarsource/polar/tree/main/sdk/typescript

([polar-js README](https://github.com/polarsource/polar-js))

State on npm (`registry.npmjs.org`, checked 2026-09-19):

| Package | `latest` | `next` | Published | License |
| --- | --- | --- | --- | --- |
| `@polar-sh/sdk` | 0.49.0 | 1.0.0-alpha.22 | 2026-07-20 | MIT |
| `@polar-sh/better-auth` | 1.8.4 | — | 2026-05-06 | (unset) |
| `@polar-sh/nextjs` | 0.9.6 | — | 2026-05-06 | (unset) |
| `@polar-sh/adapter-utils` | 0.4.6 | — | 2026-05-06 | Apache-2.0 |

- **0.x** is Speakeasy-generated (the README carries a Speakeasy badge), from a now-archived repo.
- **1.0 alpha** is hand-written, lives in the Polar monorepo, ESM+CJS dual build via `tsdown`,
  `sideEffects: false`, per-API-version entrypoints (`@polar-sh/sdk/2026-04`,
  `@polar-sh/sdk/2026-10`), tree-shakeable standalone functions, `engines: node >= 22`, typed with
  TypeScript 6. Ergonomics look clearly better (`createPolar({ accessToken })`,
  `polar.customers.getStateExternal(id)`).
  ([new SDK README](https://github.com/polarsource/polar/tree/main/sdk/typescript))

**The kit is choosing between a deprecated stable SDK and an alpha replacement.** Neither is
comfortable. Recommendation: pin `@polar-sh/sdk@0.49.x` behind the billing adapter now, and treat the
1.0 upgrade as an adapter-internal change — which is precisely the argument for the adapter existing.

### API versioning is a recurring tax

Versions are `YYYY-MM`. A new version ships in the first week of January, April, July and October.
Each version lives ~9 months: 3 as **Next**, 3 as **Current**, 3 as **Deprecated**, then it is removed
and returns `404`. Omitting the `Polar-Version` header means you silently ride **Current**, which
changes quarterly. Docs say explicitly: *"Pin a version in every production integration."*
([API versioning](https://polar.sh/docs/api-reference/versioning))

**Implication for a starter kit:** forked projects will need a Polar version bump roughly every 6–9
months or their integration breaks with a 404. That is a real fork-and-go hygiene concern and should
be called out in the kit's docs. Pin `2026-04` (or the then-Current version) explicitly.

### Sandbox

Separate environment at `sandbox.polar.sh` / `https://sandbox-api.polar.sh`, with its own account,
organization and access tokens (production tokens are rejected). Both SDKs take
`environment: "sandbox"`. Checkout works with Stripe test cards (`4242 4242 4242 4242`).
Limitation: customer-facing emails are only delivered to members of your own organization
(`you+test@example.com` sub-addressing works).
([Sandbox](https://polar.sh/docs/integrate/sandbox))

Good enough for CI. The email restriction means seat-invitation flows can only be end-to-end tested
with sub-addressed org-member emails — fine for the kit's own tests, worth documenting.

---

## Better Auth integration

`@polar-sh/better-auth` is an **official** plugin (built and published by Polar, source in
[`polarsource/polar-adapters`](https://github.com/polarsource/polar-adapters), Apache-2.0 repo).
It is also documented on Better Auth's own site
([better-auth.com/docs/plugins/polar](https://www.better-auth.com/docs/plugins/polar)).

### What the published version (1.8.4) assumes — user-centric

- `createCustomerOnSignUp` creates a Polar Customer **per User**, with `externalId` = the Better Auth
  user ID.
- Organization purchases are tracked only by passing a `referenceId`, which is "saved as `referenceId`
  in the metadata of the checkout, order & subscription object".
- Documented limitation: the subscription listing endpoint "will **not** return subscriptions made by
  a parent organization" unless a `referenceId` is supplied.

**For an org-scoped kit this published model is the wrong shape** — org ownership is a metadata
convention layered over user-owned customers, not a team customer.

### What is on `main` but not published — org-centric, experimental

`polar-adapters` `main` contains `packages/polar-betterauth/src/organization/` with
`hooks.ts`, `lifecycle.ts`, `roles.ts`, `seats.ts`, `sync.ts`, `types.ts`, and a `1.9.0` changeset:

> Add experimental support for mapping Better Auth organizations to Polar team billing, including
> automatic recurring product-seat checkout sizing, assignment, revocation, and subscription quantity
> synchronization.
>
> Enable organization synchronization with Better Auth's `organization` plugin and
> `experimental_organizationSync.enabled`. Automatic seat management is separately opt-in with
> `experimental_organizationSync.syncSeats` […]
>
> Do not enable this option if the application already synchronizes organization billing, because
> competing implementations can leave Better Auth and Polar in an inconsistent state.

([CHANGELOG](https://github.com/polarsource/polar-adapters/blob/main/packages/polar-betterauth/CHANGELOG.md))

What the code actually does (read from source):

- Hooks into Better Auth organization lifecycle hooks — `afterCreateOrganization`,
  `afterUpdateOrganization`, `afterAddMember`, `afterAcceptInvitation`, `afterUpdateMemberRole`,
  `afterRemoveMember` — and runs Polar sync only after the application's own after-hooks succeed.
- `ensureTeamCustomer` creates the Polar `type: "team"` Customer; identity fields (`externalId`,
  `name`, `owner`, `type`) are supplied by the integration and **cannot** be overridden by the
  `getTeamCustomerCreateParams` callback.
- Role mapping: Better Auth `creatorRole` (default `"owner"`) → Polar `owner`;
  `billingManagerRoles` (default `["admin"]`) → `billing_manager`; everything else → `member`.
  The adapter alone picks Polar's single canonical owner; `mapBetterAuthRoleToPolarRole` may only
  return `member` or `billing_manager`.
- `synchronizeOrganizationSeats` keeps seat assignment and subscription quantity in step with the
  Better Auth roster, with a concurrency limit of 5 and `Promise.allSettled`-style error tolerance.
- `selectSeatProductsForMember` allows per-member product allocation; default is every member gets
  every candidate recurring seat-based product.

**Status check (2026-09-19):** the org module landed on `main` between 2026-08-18 and 2026-09-01.
npm `latest` is still **1.8.4 (2026-05-06)** — **1.9.0 is not published**. The published 1.8.4 also
declares `peerDependencies: { "@polar-sh/sdk": "^0.47.0" }`, which under npm semver means
`>=0.47.0 <0.48.0` and therefore **does not accept the current `@polar-sh/sdk@0.49.0`** — a peer
conflict on a fresh install. `main` has already bumped the peer to `^0.49.0`, but that fix is
likewise unpublished. (Minor quality signal: the package's CHANGELOG is titled `# @polar-sh/hono`.)

**Recommendation:** design the kit's org↔billing sync as *our own code behind the billing adapter*,
modelled on what 1.9.0 does, rather than depending on an experimental unpublished plugin. The
adapter's own changelog warns against running both. Revisit adopting it once 1.9.0 ships and sheds
the `@experimental` marker.

---

## Swap cost: sizing the billing adapter

The map already rules that payments is "adapted for Polar↔Stripe swap, not portability". This sizes
that adapter.

### Generic — safe to put in the adapter interface

These concepts exist on both sides with near-identical semantics, so the interface can name them
directly:

| Concept | Polar | Stripe |
| --- | --- | --- |
| Billing account | `Customer` (+ `external_id`) | `Customer` (+ `metadata`/idempotent lookup) |
| Plan | `Product` + price | `Product` + `Price` |
| Subscription | `Subscription` w/ status, period end | `Subscription`, same |
| Quantity | `seats` | `quantity` |
| Proration | `invoice` / `prorate` / `next_period` | `proration_behavior` |
| Trials | `trial_end`, status `trialing` | `trial_end`, status `trialing` |
| Discounts | `discount_id` | `coupon` / `promotion_code` |
| Checkout | hosted Checkout Session | Checkout Session |
| Self-serve management | Customer Portal | Billing Portal |
| Cancel at period end | `cancel_at_period_end` | `cancel_at_period_end` |
| Pause | `pause_at_period_end` / `resumes_at` | `pause_collection` |
| Entitlements push | `customer.state_changed` | `entitlements.active_entitlement_summary.updated` |
| Entitlements pull | `GET customer state` | `GET /v1/entitlements/active_entitlements` |
| Usage | event ingestion + meters | meter events + meters |

The entitlements parallel is closer than expected: Stripe Billing has a real Entitlements product —
`entitlements.feature` with a unique `lookup_key`, `product_feature` attachments, and
`entitlements.active_entitlement` per customer, delivered by the
`entitlements.active_entitlement_summary.updated` webhook (capped at 10 entitlements inline, with a
`entitlements.url` for the rest), plus Stripe's own advice to "persist these entitlements
internally". ([Stripe Entitlements](https://docs.stripe.com/billing/entitlements?dashboard-or-api=api))

So an adapter method like `getEntitlements(orgId): Promise<Set<FeatureKey>>` backed by a local mirror
is portable **if** the kit owns the feature-key vocabulary and maps provider keys onto it, rather than
letting Polar's Feature Flag names leak into authorization checks.

### Polar-shaped — must stay behind the adapter

1. **Seat assignment and claiming.** Stripe has **no equivalent**. Stripe models per-seat pricing as
   `quantity` on a subscription item with proration
   ([Stripe per-seat pricing](https://docs.stripe.com/subscriptions/pricing-models/per-seat-pricing));
   who occupies a seat, invitations, claim tokens and revocation are entirely the application's
   problem. Polar's `Member` + `CustomerSeat` + 24-hour claim tokens + per-member benefit grants have
   nothing to map onto. **This is the single largest swap cost.**
2. **Team customer type.** Stripe `Customer` has no `individual`/`team` discriminant and no member
   roster. On Stripe, the kit's org roster *is* the roster; Polar duplicates it.
3. **Benefits.** License keys, file downloads, GitHub/Discord/Slack access, meter credits — no Stripe
   analogue. Only the Feature Flag benefit maps cleanly onto Stripe Entitlements.
4. **Merchant of record.** Swapping to Stripe means the kit's operator becomes the merchant: they take
   on tax registration, calculation (Stripe Tax), remittance and invoicing, and the payout model
   changes entirely. **This is not code — it is a business migration**, and no adapter interface can
   hide it.
5. **Customer Portal.** Both have one, but Polar's is unbrandable and hosted at
   `polar.sh/<org-slug>/portal`, and updating a default payment method is *only* possible in the
   hosted portal for PCI reasons ([Customer portal](https://polar.sh/docs/features/customer-portal/introduction)).
   Adapter surface should be `getBillingPortalUrl(orgId)` and nothing finer.
6. **Webhook signature scheme.** Polar (new secrets) uses Standard Webhooks; Stripe uses its own
   `Stripe-Signature` scheme. Small, but the verification step must be per-adapter.
7. **API version pinning cadence.** Polar's 9-month version lifetime with hard `404` removal has no
   Stripe equivalent (Stripe versions are effectively indefinite). Adapter-internal, but a real
   ongoing cost.

### Recommended adapter shape

Keep it deliberately narrow — roughly a dozen operations, all org-keyed, none seat-identity-aware:

```
ensureBillingAccount(org)            -> BillingAccountRef
createCheckoutSession(org, plan, qty)-> url
getBillingPortalUrl(org)             -> url
getSubscription(org)                 -> { plan, status, periodEnd, quantity } | null
changePlan(org, plan, proration)     -> void
setQuantity(org, n, proration)       -> void
cancel(org, { atPeriodEnd })         -> void
resume(org)                          -> void
getEntitlements(org)                 -> Set<FeatureKey>
verifyWebhook(rawBody, headers)      -> BillingEvent   // normalized union
```

Then **do not** put seat assignment/claiming in the adapter. Own the org roster in the kit's own
tables (it has to exist anyway for RBAC and invites), drive `setQuantity` from roster size, and let
the Polar adapter optionally mirror members into Polar `Member`s as an implementation detail. That
choice alone converts the largest swap cost into an adapter-internal concern, and it matches the kit's
existing org-invite flow rather than duplicating it.

**Estimated swap cost with that shape:** low — a Stripe adapter is a few hundred lines plus a Stripe
Tax/invoicing decision. **Without** it — if seats, benefits and Polar member identity leak into the
domain — the swap becomes a rewrite of the org model, and the MoR unwind on top.

---

## Open / unverified

- Whether metered and seat-based pricing can coexist on a single Polar product — not documented.
- Whether card-free trials (no payment method at checkout) are supported — not documented.
- Whether any `customer_seat.*` webhook events exist beyond the published catalogue.
- Webhook ordering and idempotency guarantees — not documented; assume neither.
- When `@polar-sh/better-auth@1.9.0` will publish, and when `@polar-sh/sdk@1.0` leaves alpha.
- Exact seat-quantity field on checkout session creation (confirmed on subscription *update* as
  `seats`; not seen in the checkout-session request field list).
