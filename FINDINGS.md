# Do Metro and Turbopack accept explicit `.ts` specifiers? — spike findings

Answers [#20](https://github.com/aniketmandloi/typesafe-saas-opus/issues/20).
Branch `spike/ts-specifiers`, throwaway. Run on macOS arm64, Node 24.16.0,
pnpm 12.3.4, 2026-09-21.

Versions exercised: Next 16.3.5 (Turbopack), Expo SDK 57.0.24, react-native
0.86.3, metro / metro-resolver 0.84.5, `@expo/metro-config` 57.0.12.

## Verdict

**Yes. Both bundlers resolve explicit `./foo.ts` and `./foo.tsx` relative
specifiers, in a Just-in-Time TypeScript workspace package and in app code
alike.** [ADR-0010](docs/adr/0010-dev-runs-raw-source-on-bare-node.md) does not
reverse. No resolver hook was needed — `resolveRequest` and `resolveExtensions`
stayed untouched, and `apps/web` carries no `transpilePackages`.

| Consumer | `./x.ts` in `@repo/probe` | `./x.ts` in app code | `./X.tsx` in app code |
| --- | --- | --- | --- |
| Turbopack (`next build --turbopack`) | ✅ | ✅ | ✅ |
| Metro (`expo export --platform android`) | ✅ | ✅ | ✅ |
| Bare `node` on the raw source | ✅ | n/a | n/a |

The probe package exports `"." : "./src/index.ts"` with no `main` and no build
step. `src/index.ts` imports `./greet.ts` (sibling), `./deep/nested.ts` (nested
directory) and a type-only `import type { Who } from "./greet.ts"`.

Evidence, not just a green build — each run was checked for the probe's output
in the emitted artifact:

- Turbopack: `hello turbopack / nested-ok / local-web-ok` and `tsx-web-ok` in the
  prerendered `.next/server/app/index.html`.
- Metro: module `578` (the package's `index.ts`) is emitted with its dependency
  list `[579, 580]` — exactly `./greet.ts` and `./deep/nested.ts` — and `581` is
  the app-local `./local.ts`. Present in both the Hermes `.hbc` and the
  `--no-bytecode` JS bundle.

## Why it works, from the resolver source

`metro-resolver@0.84.5/src/resolve.js`, `resolveSourceFile`:

```js
function resolveSourceFile(context, platform) {
  let filePath = resolveSourceFileForAllExts(context, "");   // literal path first
  if (filePath) return filePath;
  const { sourceExts } = context;
  for (let i = 0; i < sourceExts.length; i++) { ... }        // then append each ext
}
```

Metro tries the **verbatim specifier first**, before it ever appends a
`sourceExts` entry. So `./greet.ts` hits the file on the first probe. This is
structural rather than incidental, which is why it is safe to depend on — and it
is also the exact reason the opposite case fails: `./greet.js` finds no literal
file, and appending extensions only ever produces `greet.js.ts`, never `greet.ts`.

## The catch: explicit `.ts` opts out of Metro platform resolution

Look again at that first call — it passes **no `platform` argument**. The
platform-variant lookup (`.android.ts`, `.ios.ts`) and the `.native` lookup
(guarded by `sourceExt !== ""`) both live inside
`resolveSourceFileForAllExts`, and neither runs on the literal-path attempt.

So an explicit extension silently disables platform-specific resolution for that
import. Proven with a `plat.ts` / `plat.android.ts` pair imported twice from the
same file:

```tsx
import { PLAT as PLAT_EXPLICIT } from "./app/plat.ts";  // -> plat.ts
import { PLAT as PLAT_BARE }     from "./app/plat";     // -> plat.android.ts
```

Both variants land in the bundle as separate modules, and the consuming module's
dependency list binds them apart: `577, [.., 583, 584, ..]` where `583` is
`PLAT-base-BASE` and `584` is `PLAT-android-OVERRIDE`.

**It fails silently.** There is no error and no warning; the base file simply
wins, and the platform override is dead code that still ships.

### What that costs this kit

Nothing that is currently decided, but it puts a fence on the invariant:

- The invariant exists because **bare Node** loads `server`-tagged and
  `universal` packages. Bare Node never loads `apps/mobile`, so app code is not
  where the requirement comes from.
- A `universal` package can therefore never carry a `.native.ts` / `.android.ts`
  variant, because its own internal imports must stay explicit for Node. Today
  that binds nothing — [#15](https://github.com/aniketmandloi/typesafe-saas-opus/issues/15)
  already ruled that each app hand-writes its own typed env access map, so
  `@repo/env` does not want a platform split, and `@repo/schema`, `@repo/core`
  and `@repo/jobs` are pure. It is a real constraint on the future, not a
  present cost.
- Inside `apps/mobile`, the extension should be dropped wherever a platform
  variant exists. Since the failure is silent, this belongs in the lint fence
  rather than in prose.

## Reproduce

```sh
pnpm install
pnpm --dir apps/web run build          # Turbopack
cd apps/mobile && npx expo export --platform android --no-bytecode --output-dir dist-js
cd packages/probe && node node-entry.mjs   # bare Node 24 on the raw source
```
