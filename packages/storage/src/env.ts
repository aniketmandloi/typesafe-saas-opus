import { fragment, shortScalar } from "@repo/env";

// The S3 adapter's slice of the environment contract (ADR-0004). A deployment
// that does not compose the S3 adapter never requires these, which is the
// whole point of fragments.
//
// No AWS credentials here: the SDK resolves its own chain from instance roles
// or web identity tokens (#15).
export const s3StorageFragment = fragment("storage-s3", {
  S3_BUCKET: shortScalar(),
  S3_REGION: shortScalar(),
});

// The fake requires nothing, which is what makes zero-config dev fall out of a
// profile rather than out of schema defaults.
export const fakeStorageFragment = fragment("storage-fake", {});
