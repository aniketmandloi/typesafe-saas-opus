import { createFakeEmail, fakeEmailFragment } from "@repo/email";
import { authFragment, composeServerSchema, databaseFragment } from "@repo/env";
import { createFakeQueue } from "@repo/jobs";
import { createFakeStorage, fakeStorageFragment } from "@repo/storage";

import { defineProfile } from "./profile.ts";

// A tuple, not an array: the composed schema's static shape is derived from
// these entries, and a widened `EnvFragment[]` erases it back to
// Record<string, unknown> at the exact point env reaches an entrypoint.
const fragments = [databaseFragment, authFragment, fakeStorageFragment, fakeEmailFragment] as const;

/**
 * The profile a clean checkout runs under, and the one the tests use.
 *
 * Zero-config falls out of **composition**, not defaults: every adapter here
 * declares an empty fragment, so the deployment requires nothing beyond a
 * database and an auth secret. A `.default()` inside a shared fragment would
 * apply in production too, and the day someone omitted `S3_BUCKET` on an AWS
 * deployment they would get a dev fallback instead of the boot failure this
 * design exists to produce (#15).
 *
 * The fakes are held per profile instance rather than per call, so a test can
 * read the outbox and the object store the request wrote to. That is also why
 * `createLocalProfile` is a factory: two tests must not share an outbox.
 */
export const createLocalProfile = (options: { storageBaseUrl?: string } = {}) => {
  // The fake serves its own transfer half, and only the entrypoint knows the
  // URL this process answers on — so the profile takes it rather than reading
  // it. Left unset (every in-process test), the fake presigns `memory://` URLs
  // that nothing can send to, which is the honest shape for a test that never
  // transfers a byte.
  const storage = createFakeStorage(
    options.storageBaseUrl ? { baseUrl: options.storageBaseUrl } : {},
  );
  const email = createFakeEmail();
  const queue = createFakeQueue();

  return {
    ...defineProfile({
      name: "local",
      fragments: [...fragments],
      // Composed here rather than behind a helper: a helper taking
      // `...fragments: EnvFragment[]` widens the tuple and the schema's static
      // shape goes with it.
      serverSchema: composeServerSchema(...fragments),
      createAdapters: () => ({ storage, email, queue }),
    }),
    /** The fakes themselves, for tests that need to assert what was written. */
    fakes: { storage, email, queue },
  };
};
