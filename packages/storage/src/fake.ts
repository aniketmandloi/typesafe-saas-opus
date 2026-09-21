import type {
  PresignedDownload,
  PresignedUpload,
  PresignUploadInput,
  StorageAdapter,
} from "./adapter.ts";

// The test default and the zero-config dev default (ADR-0004). Zero-config dev
// falls out of a profile that wires fakes, not out of schema defaults — a
// default in the schema would leak into production.
//
// Where it diverges from S3, and the docs must say so: it does not enforce URL
// expiry, it has no CORS, and it does not verify that the upload's
// Content-Type matches the one that was signed. Code that passes against this
// fake can still fail against S3 for any of those three reasons.
export type FakeStorage = StorageAdapter & {
  /** Test-only: what the fake believes it holds. Not part of StorageAdapter. */
  readonly objects: ReadonlyMap<string, PresignUploadInput>;
  /** Test-only: pretend a presigned upload was completed by the client. */
  complete(objectKey: string): void;
};

export const createFakeStorage = (
  options: { baseUrl?: string; ttlSeconds?: number } = {},
): FakeStorage => {
  const baseUrl = options.baseUrl ?? "memory://storage";
  const ttlSeconds = options.ttlSeconds ?? 900;
  const pending = new Map<string, PresignUploadInput>();
  const objects = new Map<string, PresignUploadInput>();

  const expiry = () => new Date(Date.now() + ttlSeconds * 1000);

  return {
    id: "fake",
    objects,
    complete(objectKey) {
      const input = pending.get(objectKey);
      if (!input) throw new Error(`No presigned upload for ${objectKey}`);
      objects.set(objectKey, input);
      pending.delete(objectKey);
    },
    async presignUpload(input): Promise<PresignedUpload> {
      pending.set(input.objectKey, input);
      return {
        url: `${baseUrl}/${encodeURIComponent(input.objectKey)}?upload=1`,
        method: "PUT",
        headers: { "content-type": input.contentType },
        expiresAt: expiry(),
      };
    },
    async presignDownload({ objectKey }): Promise<PresignedDownload> {
      return {
        url: `${baseUrl}/${encodeURIComponent(objectKey)}`,
        expiresAt: expiry(),
      };
    },
    async delete({ objectKey }) {
      // Idempotent by contract: purge deletes by enumerating upload rows, and
      // a row whose object is already gone must not fail the purge.
      objects.delete(objectKey);
      pending.delete(objectKey);
    },
  };
};
