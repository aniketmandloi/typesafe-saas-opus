import { fragment, shortScalar } from "@repo/env";

// SES is the AWS reference deployment's provider. No region here: the SDK
// resolves it from the same chain it resolves credentials from, and a schema
// demanding one would fail a correctly configured Fargate task (#15).
export const sesEmailFragment = fragment("email-ses", {
  SES_FROM_ADDRESS: shortScalar(),
});

// Requires nothing, so zero-config dev falls out of a profile composing it
// rather than out of a default that would also apply in production.
export const fakeEmailFragment = fragment("email-fake", {});
