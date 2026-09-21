import type {
  PresignedDownload,
  PresignedUpload,
  PresignUploadInput,
  StorageAdapter,
} from "./adapter.ts";

/** What the fake holds once a presigned upload has actually been sent. */
export type StoredObject = {
  contentType: string;
  /**
   * Pinned to `ArrayBuffer` rather than the default `ArrayBufferLike`: a body
   * that might be backed by a `SharedArrayBuffer` is not a `BodyInit`, and
   * `apps/web` typechecks this file against the DOM lib.
   */
  body: Uint8Array<ArrayBuffer>;
};

// The test default and the zero-config dev default (ADR-0004). Zero-config dev
// falls out of a profile that wires fakes, not out of schema defaults — a
// default in the schema would leak into production.
//
// It serves its own transfer half: `handle` is the fetch handler the presigned
// URLs point at, so bytes are really sent and really read back. An entrypoint
// mounts it; a real provider hosts its own, which is why it is not on
// `StorageAdapter` — nothing in the kit may reach for it.
//
// Where it still diverges from S3, and the docs must say so:
//
// - It does not sign. Expiry is a query parameter it trusts, so an expired URL
//   is refused but a *tampered* one is not. S3's expiry is inside the
//   signature and cannot be edited.
// - It allows any origin. S3 grants none until the bucket carries a CORS
//   configuration, so a browser upload that works here fails there with a
//   preflight error that names nothing — the one divergence most likely to
//   reach production.
// - It enforces only what was signed here: content-type and expiry. Storage
//   class, encryption headers and multipart are absent entirely.
export type FakeStorage = StorageAdapter & {
  /** Test-only: what the fake believes it holds. Not part of StorageAdapter. */
  readonly objects: ReadonlyMap<string, StoredObject>;
  /**
   * The transfer half. Handles the presigned `PUT`, the presigned `GET` and
   * the browser's preflight; everything else is a 405.
   */
  handle(request: Request): Promise<Response>;
};

// Granted to everyone, because the fake has no bucket policy to carry one. S3
// requires this to be configured or the browser's preflight fails before any
// byte is sent.
const corsHeaders = (request: Request): Record<string, string> => ({
  "access-control-allow-origin": request.headers.get("origin") ?? "*",
  "access-control-allow-methods": "GET, PUT, OPTIONS",
  "access-control-allow-headers":
    request.headers.get("access-control-request-headers") ?? "content-type",
  "access-control-max-age": "600",
});

export const createFakeStorage = (
  options: { baseUrl?: string; ttlSeconds?: number } = {},
): FakeStorage => {
  const baseUrl = options.baseUrl ?? "memory://storage";
  const ttlSeconds = options.ttlSeconds ?? 900;
  const pending = new Map<string, PresignUploadInput>();
  const objects = new Map<string, StoredObject>();

  const expiry = () => new Date(Date.now() + ttlSeconds * 1000);

  // One path segment, so the key comes back whole however deep it is: the kit
  // mints `org/<id>/<uploadId>`, and a raw slash would make the tenant prefix
  // three segments the router would have to reassemble.
  const urlFor = (objectKey: string, expiresAt: Date, query = "") =>
    `${baseUrl}/${encodeURIComponent(objectKey)}?expires=${expiresAt.getTime()}${query}`;

  return {
    id: "fake",
    objects,
    async presignUpload(input): Promise<PresignedUpload> {
      const expiresAt = expiry();
      pending.set(input.objectKey, input);
      return {
        url: urlFor(input.objectKey, expiresAt, "&upload=1"),
        method: "PUT",
        headers: { "content-type": input.contentType },
        expiresAt,
      };
    },
    async presignDownload({ objectKey }): Promise<PresignedDownload> {
      const expiresAt = expiry();
      return { url: urlFor(objectKey, expiresAt), expiresAt };
    },
    async delete({ objectKey }) {
      // Idempotent by contract: purge deletes by enumerating upload rows, and
      // a row whose object is already gone must not fail the purge.
      objects.delete(objectKey);
      pending.delete(objectKey);
    },
    async handle(request) {
      const cors = corsHeaders(request);
      if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: cors });

      const url = new URL(request.url);
      const objectKey = decodeURIComponent(url.pathname.split("/").pop() ?? "");
      const expires = Number(url.searchParams.get("expires"));

      // 403 rather than 410: an expired presigned URL is a signature S3 will
      // no longer accept, not a resource that once existed here.
      if (!expires || Date.now() > expires) {
        return new Response("URL expired", { status: 403, headers: cors });
      }

      if (request.method === "PUT") {
        const presigned = pending.get(objectKey);
        if (!presigned) return new Response("Not presigned", { status: 403, headers: cors });

        // The content-type is signed, so sending a different one is a
        // signature mismatch on S3 rather than a mislabelled object.
        if (request.headers.get("content-type") !== presigned.contentType) {
          return new Response("Content-Type does not match the signature", {
            status: 403,
            headers: cors,
          });
        }

        objects.set(objectKey, {
          contentType: presigned.contentType,
          body: new Uint8Array(await request.arrayBuffer()),
        });
        pending.delete(objectKey);
        return new Response(null, { status: 200, headers: cors });
      }

      if (request.method === "GET") {
        const stored = objects.get(objectKey);
        if (!stored) return new Response("No such key", { status: 404, headers: cors });
        return new Response(stored.body, {
          status: 200,
          headers: { ...cors, "content-type": stored.contentType },
        });
      }

      return new Response("Method not allowed", { status: 405, headers: cors });
    },
  };
};
