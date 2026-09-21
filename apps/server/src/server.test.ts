import { ORGANIZATION_HEADER } from "@repo/api";
import { createLocalProfile } from "@repo/profiles";
import { describe, expect, it } from "vitest";

import { createRuntime } from "./runtime.ts";

// The first test in the kit that runs the whole server. It runs under the
// **local profile**, which is what makes "works on a clean checkout" and "the
// tests pass" keep implying each other (#15).
//
// No database is dialled, so everything here stops at the point a query would
// be issued. What it proves is composition: that the app mounts, that the
// contract is reachable over HTTP, and that a job enqueued by a use case is
// rendered and sent by the handler that drains it.

const STORAGE_BASE_URL = "http://localhost:3001/__storage";

// `storage` mirrors the node entrypoint: the fake serves its own bytes only
// where something hosts them, so a boot without it is a deployment whose
// storage lives elsewhere — which is every real one.
const boot = ({ storage }: { storage?: boolean } = {}) => {
  const profile = createLocalProfile(storage ? { storageBaseUrl: STORAGE_BASE_URL } : {});
  const env = profile.serverSchema.parse({
    DATABASE_URL: "postgres://localhost:5432/never-connected",
    BETTER_AUTH_SECRET: "test-only-secret-at-least-thirty-two-characters",
    APP_URL: "http://localhost:3000",
  });
  return {
    profile,
    runtime: createRuntime({
      env,
      profile,
      target: { pool: { max: 1 } },
      ...(storage
        ? { storageTransfer: (request: Request) => profile.fakes.storage.handle(request) }
        : {}),
    }),
  };
};

describe("the app mounts", () => {
  it("serves a health check that touches nothing", async () => {
    const { runtime } = boot();
    const response = await runtime.app.request("/health");
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ ok: true });
  });

  it("mounts Better Auth on its own route surface", async () => {
    const { runtime } = boot();
    const response = await runtime.app.request("/api/auth/ok");
    // Anything but a 404 means the handler owns the path. Better Auth's own
    // answer is its business; what is asserted here is that Hono handed it over.
    expect(response.status).not.toBe(404);
  });

  it("refuses an unauthenticated contract call over HTTP", async () => {
    const { runtime } = boot();
    const response = await runtime.app.request("/api/trpc/projects.list?input=%7B%7D", {
      headers: { [ORGANIZATION_HEADER]: "org_a" },
    });
    expect(response.status).toBe(401);
    const body = (await response.json()) as { error: { data: { code: string } } };
    expect(body.error.data.code).toBe("UNAUTHORIZED");
  });
});

describe("a job enqueued by a use case is rendered and sent by the handler", () => {
  // The exact payload members.invite enqueues. If that call site changes shape,
  // this fails — which is the point: the queue boundary is deliberately
  // unstructured (#6), so the type cannot catch a drift here.
  const payload = {
    to: "grace@example.com",
    template: "organization-invitation",
    variables: {
      invitationId: "inv_1",
      organizationId: "org_a",
      organizationName: "Acme",
      inviterName: "Ada",
    },
  };

  it("carries the invitation from the queue to the outbox", async () => {
    const { profile, runtime } = boot();

    await profile.fakes.queue.enqueue("email.send", payload);
    // Nothing is sent yet: enqueueing and running are different events.
    expect(profile.fakes.email.outbox).toHaveLength(0);

    await profile.fakes.queue.drain(runtime.handlers);

    const [sent] = profile.fakes.email.outbox;
    expect(sent?.to).toBe("grace@example.com");
    expect(sent?.subject).toBe("Ada invited you to Acme");
    expect(sent?.text).toContain("http://localhost:3000/invitations/inv_1");
    expect(sent?.html).toContain("http://localhost:3000/invitations/inv_1");
  });

  it("escapes what it interpolates into the HTML body", async () => {
    const { profile, runtime } = boot();
    await profile.fakes.queue.enqueue("email.send", {
      ...payload,
      variables: { ...payload.variables, organizationName: '<script>alert("x")</script>' },
    });
    await profile.fakes.queue.drain(runtime.handlers);

    const [sent] = profile.fakes.email.outbox;
    expect(sent?.html).not.toContain("<script>");
    expect(sent?.html).toContain("&lt;script&gt;");
  });

  it("rejects a malformed payload where it is enqueued", async () => {
    const { profile } = boot();
    await expect(
      profile.fakes.queue.enqueue("email.send", { ...payload, to: "not-an-email" }),
    ).rejects.toThrow();
  });
});

describe("the transfer half, mounted", () => {
  it("carries bytes from a presigned PUT to a presigned GET", async () => {
    const { profile, runtime } = boot({ storage: true });
    const objectKey = "org/org_a/upload_1";

    const presigned = await profile.fakes.storage.presignUpload({
      objectKey,
      contentType: "text/plain",
      byteSize: 5,
    });
    // Through the app rather than through the adapter: what is being proved
    // here is the mount, so a presigned URL that no route answers fails.
    const put = await runtime.app.request(presigned.url, {
      method: "PUT",
      headers: presigned.headers,
      body: "hello",
    });
    expect(put.status).toBe(200);

    const { url } = await profile.fakes.storage.presignDownload({ objectKey });
    const got = await runtime.app.request(url);
    expect(got.status).toBe(200);
    await expect(got.text()).resolves.toBe("hello");
  });

  it("mounts nothing when storage hosts its own transfer", async () => {
    // The shape of every deployed profile: S3 answers its own presigned URLs,
    // and an app that also answered them would be proxying bytes it cannot
    // afford to proxy (ADR-0004).
    const { runtime } = boot();
    const response = await runtime.app.request("/__storage/anything");
    expect(response.status).toBe(404);
  });
});
