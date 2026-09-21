// The kit's demand surface for object storage, not any provider's capability
// surface (ADR-0004). Three operations, because three is what the kit asks for.
//
// No adapter may throw NotSupported. A provider that cannot meet this surface
// is not an offered provider — which turns a runtime failure into a
// selection-time constraint. There is also no escape hatch: no `.raw` accessor
// onto the underlying SDK, because that is how a seam dies. A cloner who needs
// more edits the adapter package they own.
//
// Everything here is presigned and direct-to-storage. That is not a preference:
// Vercel caps request and response at 4.5 MB and Lambda at 6 MB, so proxying
// uploads through the server is not portable. Transforms are deliberately
// absent — image processing sits outside this seam, because folding it in
// would reshape the interface around provider capability (Vercel Blob
// transforms on read; S3 does not).

export type PresignUploadInput = {
  objectKey: string;
  contentType: string;
  byteSize: number;
};

export type PresignedUpload = {
  url: string;
  method: "PUT" | "POST";
  /** Headers the client must send with the upload for the signature to verify. */
  headers: Record<string, string>;
  expiresAt: Date;
};

export type PresignedDownload = {
  url: string;
  expiresAt: Date;
};

export type StorageAdapter = {
  readonly id: string;
  presignUpload(input: PresignUploadInput): Promise<PresignedUpload>;
  presignDownload(input: { objectKey: string }): Promise<PresignedDownload>;
  /** Idempotent: deleting an absent object is not an error. Purge depends on this. */
  delete(input: { objectKey: string }): Promise<void>;
};
