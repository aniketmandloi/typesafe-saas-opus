import { describe, expect, it } from "vitest";
import { z } from "zod";

import { authFragment, databaseFragment, directDatabaseFragment } from "./base.ts";
import { composeServerSchema, fragment, shortScalar } from "./fragment.ts";
import { PUBLIC_PHYSICAL_NAMES, publicSchema } from "./public.ts";

describe("a deployment requires exactly its providers' variables", () => {
  const storage = fragment("storage-s3", { S3_BUCKET: shortScalar(), S3_REGION: shortScalar() });
  const email = fragment("email-ses", { SES_FROM_ADDRESS: shortScalar() });

  it("composes only the fragments it is given", () => {
    const schema = composeServerSchema(databaseFragment, authFragment, storage);
    expect(Object.keys(schema.shape).sort()).toEqual([
      "APP_URL",
      "BETTER_AUTH_SECRET",
      "DATABASE_URL",
      "S3_BUCKET",
      "S3_REGION",
    ]);
  });

  it("leaves out an unused provider's variables entirely", () => {
    const schema = composeServerSchema(databaseFragment, storage);
    expect(Object.keys(schema.shape)).not.toContain("SES_FROM_ADDRESS");
    expect(email.server.SES_FROM_ADDRESS).toBeDefined();
  });

  // The migrate profile composes no adapters at all and holds the direct URL,
  // which the serving profile never sees (ADR-0012).
  it("keeps the direct connection out of the serving profile", () => {
    const serving = composeServerSchema(databaseFragment, authFragment, storage, email);
    const migrate = composeServerSchema(directDatabaseFragment);
    expect(Object.keys(serving.shape)).not.toContain("DATABASE_URL_DIRECT");
    expect(Object.keys(migrate.shape)).toEqual(["DATABASE_URL_DIRECT"]);
  });

  // Asserted by tsc, not at runtime. A composed schema that parses to
  // Record<string, unknown> would force every entrypoint to cast, which is the
  // duplicate declaration the kit's typesafety contract forbids — spelled as a
  // cast rather than as an interface.
  it("composes to a statically known shape", () => {
    const parsed = composeServerSchema(databaseFragment, authFragment, storage).parse({
      DATABASE_URL: "postgres://localhost:5432/kit",
      BETTER_AUTH_SECRET: "test-only-secret-at-least-thirty-two-characters",
      APP_URL: "http://localhost:3000",
      S3_BUCKET: "bucket",
      S3_REGION: "eu-west-1",
    });
    const url: string = parsed.DATABASE_URL;
    const bucket: string = parsed.S3_BUCKET;
    expect([url, bucket]).toEqual(["postgres://localhost:5432/kit", "bucket"]);

    const withoutStorage = composeServerSchema(databaseFragment).parse({
      DATABASE_URL: "postgres://localhost:5432/kit",
    });
    // @ts-expect-error S3_BUCKET is not on a schema that composed no storage
    // fragment, so reaching for it is a build failure rather than undefined.
    expect(withoutStorage.S3_BUCKET).toBeUndefined();
  });

  it("refuses two fragments claiming the same variable", () => {
    const rogue = fragment("storage-other", { S3_BUCKET: shortScalar() });
    expect(() => composeServerSchema(storage, rogue)).toThrow(/declared by both/);
  });

  it("allows a fragment composed twice", () => {
    expect(() => composeServerSchema(storage, storage)).not.toThrow();
  });
});

describe("values ineligible for env are rejected at parse time", () => {
  const schema = z.object({ KEY: shortScalar() });

  it("accepts a short scalar", () => {
    expect(schema.parse({ KEY: "sk_live_abc" })).toEqual({ KEY: "sk_live_abc" });
  });

  it("rejects a multi-line value", () => {
    const pem = "-----BEGIN PRIVATE KEY-----\nMIIEvQ==\n-----END PRIVATE KEY-----";
    const result = schema.safeParse({ KEY: pem });
    expect(result.success).toBe(false);
    expect(result.error?.issues[0]?.message).toMatch(/secrets manager/);
  });

  it("rejects an unbounded value", () => {
    expect(schema.safeParse({ KEY: "x".repeat(2000) }).success).toBe(false);
  });

  it("rejects an empty value, which is how a missing var usually arrives", () => {
    expect(schema.safeParse({ KEY: "" }).success).toBe(false);
  });
});

describe("the public side is flat and has no adapter variables", () => {
  it("parses", () => {
    expect(publicSchema.parse({ apiUrl: "https://api.example.com" })).toEqual({
      apiUrl: "https://api.example.com",
    });
  });

  it("names one physical variable per app for each logical key", () => {
    for (const key of Object.keys(publicSchema.shape)) {
      const names = PUBLIC_PHYSICAL_NAMES[key as keyof typeof PUBLIC_PHYSICAL_NAMES];
      expect(names.web.startsWith("NEXT_PUBLIC_")).toBe(true);
      expect(names.native.startsWith("EXPO_PUBLIC_")).toBe(true);
    }
  });

  it("has no fragment carrying a public variable", () => {
    // Structural: EnvFragment has no `public` field, so this cannot regress
    // without a type change. Asserted anyway because the invariant is the
    // reason the public schema needs no composition at all.
    const anyFragment = databaseFragment as Record<string, unknown>;
    expect(anyFragment.public).toBeUndefined();
  });
});
