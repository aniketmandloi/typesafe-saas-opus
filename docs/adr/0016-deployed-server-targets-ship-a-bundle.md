# Every deployed server target ships a bundle

Every deployed `server` entrypoint is an esbuild bundle: one file, running in a directory with no `node_modules`, with no cross-package resolution left to get wrong. That holds for the container, for Lambda, and for Vercel — where `apps/server/scripts/bundle-vercel.ts` emits the Build Output API directly rather than leaving a file for Vercel to discover. `pnpm deploy` is not a container strategy for this kit.

This is the price of [ADR-0010](./0010-dev-runs-raw-source-on-bare-node.md)'s raw-TypeScript packages, and it is recorded because the kit pays it where nobody expects to: Vercel transpiles TypeScript itself, so a reader reasonably assumes the platform already handles this and that a build step there is cargo cult. [Bundling a pnpm-workspace server per target](https://github.com/aniketmandloi/typesafe-saas-opus/issues/14) assumed exactly that, and the deployment in [the vertical slice](https://github.com/aniketmandloi/typesafe-saas-opus/issues/12) proved it wrong.

**The transferable lesson: a local `nodeFileTrace` proves transpilation, not resolution.** [#14](https://github.com/aniketmandloi/typesafe-saas-opus/issues/14) replicated Vercel's pipeline from `@vercel/node`'s source and measured a real trace — 704 files, seven workspace `.ts`, each transpiled through the builder's `readFile` hook before nft parsed it, exactly as documented. The verification was sound as far as it went, and the deploy failed anyway: every package's `exports` map still named `./src/index.ts`, and pnpm's `@repo` symlinks are gone at runtime. A transpiled graph still has to **resolve**. No local trace can see that, which is the whole argument for the *proven* tier ([#13](https://github.com/aniketmandloi/typesafe-saas-opus/issues/13)) — and the slice demonstrated it on itself.

Four smaller facts sit under this decision, each having cost a real failure:

- **Function detection runs before the build command.** Vercel globs `api/**` in the *source* tree, so a bundle generated during the build is never found and every route 404s. Writing `.vercel/output` ourselves removes the ordering question entirely. It passed locally only because a stale manual bundle was sitting on disk — a false pass worth remembering.
- **The Node launcher never reads a Web handler.** With a prebuilt Build Output there is no `@vercel/node` wrapping in between, so a `Request → Response` export is never called: the launcher passes `(req, res)`, nothing writes to `res`, and the request hangs with no status and no log line. The entrypoint exports `getRequestListener(app.fetch)`. `shouldAddHelpers` stays off for the matching reason — the helpers consume the request stream to populate `req.body`, leaving the listener waiting for a body that has already been read, which is the most likely mechanism behind [honojs/node-server#306](https://github.com/honojs/node-server/issues/306), where POST hangs on Vercel while GET works.
- **`typeRoots` is named explicitly.** Vercel's compiler runs where TypeScript's default upward walk does not reach the workspace's `@types`, and `TS2688` against a config that compiles clean locally is otherwise baffling.
- **`framework: null`, or the preset claims the project.** The Hono preset transpiles `apps/server`'s own files and leaves `@repo/*` as the raw TypeScript they are published as; the function boots and dies on `Cannot find module '@repo/api/src/index.ts'`.

## Considered options

**`pnpm deploy` for the container** is the obvious shape, and its output does not boot. It materialises workspace packages into the deploy directory's virtual store, which puts their realpath under `node_modules`, and Node refuses type stripping there — `ERR_UNSUPPORTED_NODE_MODULES_TYPE_STRIPPING`. The same failure is one `node-linker=hoisted` away, which is why that setting is asserted at preinstall rather than documented ([ADR-0010](./0010-dev-runs-raw-source-on-bare-node.md)). Copying the workspace and running `pnpm install --frozen-lockfile` works and ships every dev dependency. So the container runs the same artifact as Lambda: one ~2.7 MB `.mjs` in an empty directory.

**A per-package build step** — `tsup`, or `rolldown`/`tsdown` — was the standing fallback if any bundler refused raw workspace TypeScript, and was never reached. esbuild under CDK, `@vercel/nft`, Next 16 under Turbopack and Metro under Expo SDK 57 all consume `"." : "./src/index.ts"` directly, with no `transpilePackages` and no `dist`. The bundle step is forced by *deployment*, not by any bundler's inability to read the source.

## Consequences

**The AWS SDK is inlined into the Lambda bundle rather than left external.** Externalising it pins the kit to whatever SDK version the Lambda image happens to ship.

**`sharp` stays external in every bundle, and its binary is installed per target.** nft traces every architecture that is *installed*, so a workspace-wide `supportedArchitectures` takes the worker's traced size from 15.9 MiB to 99.1 MiB and slows every developer's install. Vercel builds in its own linux image, so `current` is already right; a Lambda asset built on a developer's Mac installs the one binary in the bundling step with `npm i sharp --cpu=arm64 --os=linux --libc=glibc`. **`--libc` is required** — without it npm silently installs no binary at all.

**`packageManager` must stay pinned in the root `package.json`.** `lockfileVersion` has stayed `9.0` across pnpm 9 through 12, so Vercel resolves an unpinned project *by project creation date*; pnpm 12 is never a default and is reachable only from the pin. Without it, Vercel installs this lockfile with pnpm 10 while dev and CI use 12.

**Where `@vercel/nft`'s transpiling hook is in play, one tsconfig governs the whole traced graph** — it builds its compiler once from the entrypoint's tsconfig and reuses it for every file, so `apps/server`'s tsconfig compiles `@repo/*` there.

**Nothing in the dev loop exercises the bundle**, because dev runs the raw source; that is what [ADR-0010](./0010-dev-runs-raw-source-on-bare-node.md)'s per-PR CI builds of every server artifact exist to cover. Dev and production no longer share a module reality, and there is no configuration that would make them.
