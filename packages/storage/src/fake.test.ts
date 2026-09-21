import { describe, expect, it } from "vitest";

import { storageAdapterContract } from "./contract.ts";
import { createFakeStorage } from "./fake.ts";

describe("the in-memory fake meets the demand surface", () => {
  storageAdapterContract("fake", () => createFakeStorage());
});

describe("fake-only behaviour, used by tests rather than by the kit", () => {
  it("holds an object once the upload is completed", async () => {
    const storage = createFakeStorage();
    await storage.presignUpload({ objectKey: "a.png", contentType: "image/png", byteSize: 9 });
    expect(storage.objects.has("a.png")).toBe(false);
    storage.complete("a.png");
    expect(storage.objects.has("a.png")).toBe(true);
  });

  it("forgets an object on delete", async () => {
    const storage = createFakeStorage();
    await storage.presignUpload({ objectKey: "b.png", contentType: "image/png", byteSize: 9 });
    storage.complete("b.png");
    await storage.delete({ objectKey: "b.png" });
    expect(storage.objects.has("b.png")).toBe(false);
  });

  it("leaves a presigned-but-never-completed upload invisible", async () => {
    // This is the gap ADR-0007 names: purge enumerates upload rows, and an
    // abandoned presign has no row. A bucket lifecycle rule covers it, not the
    // runtime. The fake reproduces the shape so the slice cannot forget it.
    const storage = createFakeStorage();
    await storage.presignUpload({ objectKey: "c.png", contentType: "image/png", byteSize: 9 });
    expect(storage.objects.size).toBe(0);
  });
});
