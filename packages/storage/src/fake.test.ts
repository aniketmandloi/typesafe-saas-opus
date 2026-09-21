import { describe, expect, it } from "vitest";

import { storageAdapterContract } from "./contract.ts";
import { createFakeStorage, type FakeStorage } from "./fake.ts";

// An origin that resolves to nothing on purpose: every request in this file
// goes through the fake's own handler, which is the code an entrypoint mounts.
// If a test ever leaked to real `fetch` it would fail loudly rather than
// quietly reaching a dev server someone left running.
const BASE_URL = "http://storage.invalid/__storage";

describe("the in-memory fake meets the demand surface", () => {
  // The contract builds a fresh adapter per test and the send function has to
  // reach that one, so it is captured on the way past.
  let current: FakeStorage;
  storageAdapterContract(
    "fake",
    () => {
      current = createFakeStorage({ baseUrl: BASE_URL });
      return current;
    },
    { send: (request) => current.handle(request) },
  );
});

describe("the transfer half, which is the fake's own to serve", () => {
  const sent = async (storage: FakeStorage, objectKey: string, body: string) => {
    const upload = await storage.presignUpload({
      objectKey,
      contentType: "text/plain",
      byteSize: body.length,
    });
    return storage.handle(
      new Request(upload.url, { method: upload.method, headers: upload.headers, body }),
    );
  };

  it("holds an object once the upload has really been sent", async () => {
    const storage = createFakeStorage({ baseUrl: BASE_URL });
    expect(storage.objects.has("a.png")).toBe(false);
    const put = await sent(storage, "a.png", "bytes");
    expect(put.status).toBe(200);
    expect(storage.objects.get("a.png")?.body).toEqual(new TextEncoder().encode("bytes"));
  });

  it("keeps a nested key whole, tenant prefix and all", async () => {
    // The kit mints `org/<id>/<uploadId>`, so a key that came back as its last
    // segment would collapse two tenants' objects into one.
    const storage = createFakeStorage({ baseUrl: BASE_URL });
    await sent(storage, "org/org_a/upload_1", "a");
    expect(storage.objects.has("org/org_a/upload_1")).toBe(true);
  });

  it("refuses a PUT to a key nobody presigned", async () => {
    const storage = createFakeStorage({ baseUrl: BASE_URL });
    const response = await storage.handle(
      new Request(`${BASE_URL}/never-signed.bin?expires=${Date.now() + 60_000}`, {
        method: "PUT",
        headers: { "content-type": "text/plain" },
        body: "x",
      }),
    );
    expect(response.status).toBe(403);
  });

  it("refuses an expired URL", async () => {
    const storage = createFakeStorage({ baseUrl: BASE_URL, ttlSeconds: -1 });
    const put = await sent(storage, "late.txt", "x");
    expect(put.status).toBe(403);
    expect(storage.objects.has("late.txt")).toBe(false);
  });

  it("answers the browser's preflight, which S3 does only once configured", async () => {
    const storage = createFakeStorage({ baseUrl: BASE_URL });
    const response = await storage.handle(
      new Request(`${BASE_URL}/x.bin?expires=${Date.now() + 60_000}`, {
        method: "OPTIONS",
        headers: { origin: "http://localhost:3100", "access-control-request-method": "PUT" },
      }),
    );
    expect(response.status).toBe(204);
    expect(response.headers.get("access-control-allow-origin")).toBe("http://localhost:3100");
    expect(response.headers.get("access-control-allow-methods")).toContain("PUT");
  });

  it("404s a download of a key that was never uploaded", async () => {
    const storage = createFakeStorage({ baseUrl: BASE_URL });
    const { url } = await storage.presignDownload({ objectKey: "absent.bin" });
    const response = await storage.handle(new Request(url));
    expect(response.status).toBe(404);
  });

  it("forgets an object on delete", async () => {
    const storage = createFakeStorage({ baseUrl: BASE_URL });
    await sent(storage, "b.png", "bytes");
    await storage.delete({ objectKey: "b.png" });
    expect(storage.objects.has("b.png")).toBe(false);

    const { url } = await storage.presignDownload({ objectKey: "b.png" });
    expect((await storage.handle(new Request(url))).status).toBe(404);
  });

  it("leaves a presigned-but-never-completed upload invisible", async () => {
    // This is the gap ADR-0007 names: purge enumerates upload rows, and an
    // abandoned presign has no row. A bucket lifecycle rule covers it, not the
    // runtime. The fake reproduces the shape so the slice cannot forget it.
    const storage = createFakeStorage({ baseUrl: BASE_URL });
    await storage.presignUpload({ objectKey: "c.png", contentType: "image/png", byteSize: 9 });
    expect(storage.objects.size).toBe(0);
  });
});
