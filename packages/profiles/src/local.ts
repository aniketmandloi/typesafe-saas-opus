import { createFakeEmail, fakeEmailFragment } from "@repo/email";
import { authFragment, databaseFragment } from "@repo/env";
import { createFakeQueue } from "@repo/jobs";
import { createFakeStorage, fakeStorageFragment } from "@repo/storage";

import { defineProfile, schemaOf } from "./profile.ts";

const fragments = [databaseFragment, authFragment, fakeStorageFragment, fakeEmailFragment];

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
export const createLocalProfile = () => {
  const storage = createFakeStorage();
  const email = createFakeEmail();
  const queue = createFakeQueue();

  return {
    ...defineProfile({
      name: "local",
      fragments,
      serverSchema: schemaOf(...fragments),
      createAdapters: () => ({ storage, email, queue }),
    }),
    /** The fakes themselves, for tests that need to assert what was written. */
    fakes: { storage, email, queue },
  };
};
