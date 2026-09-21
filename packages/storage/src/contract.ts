import { expect, it } from "vitest";

import type { StorageAdapter } from "./adapter.ts";

// The demand surface, executable. Every storage adapter the kit offers runs
// this suite, which is what makes "no adapter ever throws NotSupported"
// checkable rather than aspirational (ADR-0004): an adapter that cannot meet
// the surface fails here, at selection time, instead of in production.
//
// It asserts the transfer, not just the signature. A presigned URL that cannot
// receive bytes is the failure this kit is most exposed to — the bytes never
// pass through a procedure, so nothing else in the test suite would notice.
//
// `send` exists because the fake's transfer half is a fetch handler rather
// than a socket: a provider adapter leaves it alone and the suite uses real
// `fetch`, while the fake passes its own handler and exercises the identical
// code an entrypoint mounts.
//
// It does not assert expiry enforcement or CORS. Both are real demands, but
// neither can be asserted portably — expiry needs a clock the adapter does not
// expose, and CORS is bucket configuration rather than adapter behaviour.
export const storageAdapterContract = (
  name: string,
  create: () => StorageAdapter | Promise<StorageAdapter>,
  options: { send?: (request: Request) => Promise<Response> } = {},
) => {
  const send = options.send ?? ((request: Request) => fetch(request));
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

  it(`${name}: carries bytes from a presigned upload to a presigned download`, async () => {
    const storage = await create();
    const objectKey = key();
    const body = new TextEncoder().encode("the transfer half, for real");

    const upload = await storage.presignUpload({
      objectKey,
      contentType: "text/plain",
      byteSize: body.byteLength,
    });
    const put = await send(
      new Request(upload.url, { method: upload.method, headers: upload.headers, body }),
    );
    expect(put.ok).toBe(true);

    const download = await storage.presignDownload({ objectKey });
    const got = await send(new Request(download.url));
    expect(got.ok).toBe(true);
    expect(new Uint8Array(await got.arrayBuffer())).toEqual(body);
  });

  it(`${name}: refuses an upload whose content-type is not the one signed`, async () => {
    const storage = await create();
    const objectKey = key();
    const upload = await storage.presignUpload({
      objectKey,
      contentType: "image/png",
      byteSize: 4,
    });
    // S3 signs the content-type, so sending another one is a signature
    // mismatch. An adapter that let this through would store objects whose
    // declared type is a lie, and the kit's row would disagree with the object.
    const put = await send(
      new Request(upload.url, {
        method: upload.method,
        headers: { "content-type": "text/html" },
        body: new Uint8Array([1, 2, 3, 4]),
      }),
    );
    expect(put.ok).toBe(false);
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
