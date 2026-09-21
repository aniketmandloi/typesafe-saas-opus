import { expect, it } from "vitest";

import type { StorageAdapter } from "./adapter.ts";

// The demand surface, executable. Every storage adapter the kit offers runs
// this suite, which is what makes "no adapter ever throws NotSupported"
// checkable rather than aspirational (ADR-0004): an adapter that cannot meet
// the surface fails here, at selection time, instead of in production.
//
// It asserts only what the kit actually demands. It does not assert expiry
// enforcement, CORS or content-type verification, because the in-memory fake
// legitimately does not have them — those differences are real and belong in
// the cloner-facing docs, not in a suite the fake is expected to fail.
export const storageAdapterContract = (
  name: string,
  create: () => StorageAdapter | Promise<StorageAdapter>,
) => {
  const key = () => `contract/${Math.random().toString(36).slice(2)}.bin`;

  it(`${name}: presigns an upload the client can actually send`, async () => {
    const storage = await create();
    const objectKey = key();
    const presigned = await storage.presignUpload({
      objectKey,
      contentType: "image/png",
      byteSize: 1024,
    });
    expect(presigned.url).toMatch(/^[a-z][a-z0-9+.-]*:/);
    expect(presigned.method === "PUT" || presigned.method === "POST").toBe(true);
    // Whatever the client must send has to be stated, or the signature fails
    // with a message about the signature rather than about the headers.
    expect(presigned.headers["content-type"]).toBe("image/png");
    expect(presigned.expiresAt.getTime()).toBeGreaterThan(Date.now());
  });

  it(`${name}: presigns a download`, async () => {
    const storage = await create();
    const presigned = await storage.presignDownload({ objectKey: key() });
    expect(presigned.url).toMatch(/^[a-z][a-z0-9+.-]*:/);
    expect(presigned.expiresAt.getTime()).toBeGreaterThan(Date.now());
  });

  it(`${name}: deletes idempotently, because purge depends on it`, async () => {
    const storage = await create();
    const objectKey = key();
    await expect(storage.delete({ objectKey })).resolves.toBeUndefined();
    await expect(storage.delete({ objectKey })).resolves.toBeUndefined();
  });

  it(`${name}: gives distinct keys distinct URLs`, async () => {
    const storage = await create();
    const a = await storage.presignUpload({
      objectKey: key(),
      contentType: "text/plain",
      byteSize: 1,
    });
    const b = await storage.presignUpload({
      objectKey: key(),
      contentType: "text/plain",
      byteSize: 1,
    });
    expect(a.url).not.toBe(b.url);
  });

  it(`${name}: identifies itself`, async () => {
    const storage = await create();
    expect(storage.id.length).toBeGreaterThan(0);
  });
};
