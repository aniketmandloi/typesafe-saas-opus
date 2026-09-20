// sharp is a dependency of @repo/images, not of apps/server — pnpm's isolation
// means the server cannot import it directly, only through the package that owns it.
import { solidPng, thumbnail } from "@repo/images";

const out = await thumbnail(await solidPng(64), 32);
console.log("native sharp through a raw-TS package:", out.byteLength, "bytes webp");
