# Bundling a pnpm-workspace server per target — spike findings

Answers [#14](https://github.com/aniketmandloi/typesafe-saas-opus/issues/14).
Branch `spike/bundling-per-target`, throwaway. Run on macOS arm64, Node 24.16.0,
pnpm 12.3.4, 2026-09-20.

## Verdict

**Just-in-Time TypeScript works. No per-package build step is required, by any of
the four bundlers.** `tsup` vs `rolldown`/`tsdown` never had to be decided — the
fallback wasn't reached.

Every workspace package exports `"." : "./src/index.ts"` with no `main`, no `dist`,
no build script. All four bundlers consumed that directly:

| Bundler | Result | Evidence |
| --- | --- | --- |
| esbuild (CDK `NodejsFunction`) | ✅ inlines 7 workspace `.ts` files | `scripts/build-lambda.mjs` |
| `@vercel/nft` + Vercel's TS hook | ✅ traces 7 workspace `.ts`, 704 files, 4.3 MiB | `scripts/trace-vercel.mjs` |
| Next 16.3.5 (Turbopack) | ✅ **no `transpilePackages` needed** | `apps/web`, static prerender ran `slugify()` |
| Metro (Expo SDK 57) | ✅ 777 modules, 2.4 MB Hermes | `apps/mobile`, proven by a deliberate syntax error in `packages/core` |

And one the ticket didn't ask about:

| Runtime | Result |
| --- | --- |
| **Bare `node` on the raw `.ts`** | ✅ runs, no flags, no loader — Node 24 type stripping |

## The finding that reshapes the recipe: Node 24 runs the source

`node apps/server/src/entrypoints/node.ts` starts the whole server — Hono, tRPC,
drizzle, `pg`, the AWS SDK — with no bundler and no flag. Type stripping handles
`@repo/*` because **pnpm symlinks mean the realpath is outside `node_modules`**.

That is load-bearing and fragile. Materialise the same packages as real files
under `node_modules` and Node refuses:

```
ERR_UNSUPPORTED_NODE_MODULES_TYPE_STRIPPING: Stripping types is currently
unsupported for files under node_modules
```

Two ways to hit that, both plausible:

- **`node-linker=hoisted`** in `.npmrc` (or npm/yarn instead of pnpm). Verified by
  replacing one symlink with a real copy.
- **`pnpm deploy`** — it materialises workspace packages into the deploy dir's
  virtual store, whose realpath *is* under `node_modules`. Verified: the deployed
  output fails to boot.

So **`pnpm deploy` is not a container strategy for this kit.** Two that are:

1. **Bundle with esbuild** (same config as Lambda) → one 2.7 MB `.mjs` that runs
   with **no `node_modules` at all**. Verified in an empty directory. Recommended:
   it makes container and Lambda the same recipe.
2. Copy the whole workspace into the image and `pnpm install --frozen-lockfile`,
   then run the raw `.ts`. Works, but ships the workspace and every dev dep.

`node-linker` must stay pnpm's default `isolated`. That is now a kit constraint,
not a preference.

## ADR-0004's static composition, quantified

The claim was that composing adapters statically keeps unused provider SDKs out of
the bundle. Measured by `bytesInOutput` (what survives tree-shaking, not what was
scanned):

| Entrypoint | Bundle | `@aws-sdk` emitted | `@vercel/blob` emitted |
| --- | --- | --- | --- |
| static, S3 only | 1230 KiB | 334 KiB | 0 |
| static, Blob only | **663 KiB** | **0** | 22 KiB |
| runtime factory on `STORAGE_DRIVER` | 1222 KiB | 333 KiB | 22 KiB |
| Blob composed, S3 imported but unused | 663 KiB | 0 | 22 KiB |

**The claim holds: 559 KiB, 46% of the bundle, on a Blob deployment.** But the
mechanism is narrower than stated. Row 4 shows esbuild *does* shake a statically
imported adapter that is never called. What defeats tree-shaking is specifically
the **runtime factory** — a branch on an env var makes both providers reachable.
So the rule to enforce is "no runtime provider selection", not "never import an
adapter you don't compose".

## Per-target recipes

### Vercel

`@vercel/node` **does not bundle**. It calls `nodeFileTrace` with
`{ ts: true, mixedModules: true, moduleSyncCatchall: true }` and a `readFile` hook
that transpiles every `.ts`/`.tsx`/`.mts`/`.cts` before nft parses it. nft alone
cannot parse TypeScript — it fails with `Unexpected token` on a non-null assertion.

Consequences:

- **One tsconfig compiles the whole traced graph.** The hook builds its compiler
  once from the entrypoint's tsconfig and reuses it for every file, including
  `packages/*`. `apps/server`'s tsconfig governs `@repo/*` compilation on Vercel.
- Trace of the HTTP function: **704 files, 4.3 MiB** — far under the 250 MB limit.
- Two warnings are expected noise, not failures: unresolved `pg-native` (optional
  peer of `pg`) and `cloudflare:sockets` (a drizzle/`pg` edge branch).

**Pin the package manager.** Vercel's build image ships pnpm 6–12, but
`lockfileVersion` has stayed `9.0` across pnpm 9, 10, 11 and 12, so an unpinned
project is resolved **by project creation date**: pnpm 10 for anything created
after 2025-02-27, pnpm 11 only after 2027-03-01. **pnpm 12 is never a default —
it is reachable only from `package.json#packageManager` or
`package.json#devEngines.packageManager`.** Without the pin, Vercel installs the
kit's lockfile with pnpm 10 while dev and CI use 12. Root `package.json` is the
right place: the resolver walks up from the project dir to the lockfile dir and
takes the last pin it sees. (Verified in `@vercel/build-utils` source and against
[Vercel's changelog](https://vercel.com/changelog/automatic-pnpm-v10-support);
pnpm 11/12 support landed 2026-09-08, twelve days before this spike.)

### AWS Lambda (CDK `NodejsFunction` → esbuild)

Bundle, `platform: node`, `target: node24`, `format: esm`, with the
`createRequire` banner ESM output needs. 1230 KiB minified with the AWS SDK
inlined, 675 KiB with `@aws-sdk/*` external against the runtime's own copy — but
externalising pins you to the SDK version in the Lambda image, so inline it.

Cold build 688 ms; the whole workspace graph is 850 inputs.

### Container

Bundle exactly as for Lambda (see above). 2.7 MB unminified, runs standalone.

### Web and mobile

Nothing to configure for Next. For Metro, **one line diverges from Expo's own
monorepo guide**: `disableHierarchicalLookup` must stay `false`. Expo documents
turning it on for npm/yarn workspaces; under pnpm it breaks immediately, because a
package's own dependencies live in its isolated store directory rather than a
hoisted root. With it on, `expo-modules-core` is unresolvable from `expo` itself.

`watchFolders` must include the workspace root and `nodeModulesPaths` both trees.

Also: **Expo SDK 57 pins react-native 0.86.3 and react 19.2.3**, which are not npm
`latest` (0.87.1 / 19.3.0). `latest` fails with `Cannot find module
react-native/rn-get-polyfills`. Mobile's React version is set by the Expo SDK and
web's by Next — they diverge, which is fine only because UI isn't shared.

## Native modules (`sharp`)

Works through a raw-TS package under every path, including bare Node. But the
binary is per-platform and **nft traces every architecture that is installed**:

- Default Mac install → 1 `.node` file, `darwin-arm64`. Shipped to a linux Lambda,
  it breaks.
- `supportedArchitectures` in `pnpm-workspace.yaml` covering linux → 6 `.node`
  files and the worker's traced size goes **15.9 MiB → 99.1 MiB**, because nft
  cannot know the runtime platform and includes them all. It also slows every
  developer's install.

**Don't set `supportedArchitectures` workspace-wide.** Vercel builds in its own
linux image, so `current` is already correct there. For a Lambda asset built on a
developer's Mac, install the one binary into the bundling step:

```
npm i sharp --cpu=arm64 --os=linux --libc=glibc
```

`--libc` is required; without it npm installs no binary at all, silently.

Mark `sharp` external in every bundle — bundling its JS does not bundle the
`.node` file.

## Dev loop

The [#8](https://github.com/aniketmandloi/typesafe-saas-opus/issues/8) constraint
was that `moduleResolution: bundler` must be mitigated by running dev through a
bundler too, so dev and prod resolve identically.

| Approach | Edit → ready |
| --- | --- |
| esbuild incremental rebuild | **124 ms** median (201 ms cold), plus process restart |
| `node --watch` on the raw `.ts` | **~410 ms** total, no build step |
| …with `NODE_COMPILE_CACHE` | ~380 ms, not worth the wiring |

Both are comfortably usable, so the `bundler`-vs-`nodenext` choice does **not**
reopen. But the premise is worth revisiting: bare Node resolves like Node, so a
bundler-only import fails in dev the moment it is written, rather than passing dev
and failing on a target. Running dev on bare Node makes `moduleResolution:
bundler` self-policing — a stronger mitigation than bundling in dev, and it
deletes the dev build step entirely. Recommended, with the trade stated: dev is
then *stricter* than production rather than identical to it.

## Not proven here

- **No deploy was performed.** Vercel's pipeline was replicated from
  `@vercel/node`'s source (same nft options, same transpile-on-read); CDK's was
  replicated as esbuild with `NodejsFunction`'s settings.
- **No container was built** — Docker isn't installed on this machine. The bundle
  was proven to run standalone on macOS arm64, not inside a linux image.
- Sizes are for this spike's dependency set, not the finished kit.
