import { mkdir, writeFile } from "node:fs/promises";
import { build } from "esbuild";

// Emits the Build Output API directly, rather than a file for Vercel to
// discover.
//
// Discovery is the trap: Vercel globs `api/**` from the *source* tree before
// the build command runs, so a bundle written during the build is never seen
// and every route 404s. Writing `.vercel/output` ourselves removes the
// ordering question entirely — Vercel deploys what is there.
//
// The bundle exists for the reason #14 gave for Lambda: the kit's packages
// ship raw TypeScript (ADR-0010), and every builder that transpiles them in
// place leaves their `exports` maps pointing at `./src/index.ts`. One file has
// no cross-package resolution left to get wrong.
const OUT = ".vercel/output";
const FUNC = `${OUT}/functions/api.func`;

await mkdir(FUNC, { recursive: true });
await mkdir(`${OUT}/static`, { recursive: true });

await build({
  entryPoints: ["src/entrypoints/vercel.ts"],
  outfile: `${FUNC}/index.js`,
  bundle: true,
  platform: "node",
  target: "node24",
  format: "esm",
  // An optional peer of `pg` that nothing here installs. Bundling it fails on
  // a module that is meant to be absent.
  external: ["pg-native"],
  // ESM output reaching a CommonJS dependency needs `require` to exist.
  banner: {
    js: [
      "import { createRequire as __createRequire } from 'node:module';",
      "const require = __createRequire(import.meta.url);",
    ].join("\n"),
  },
  logLevel: "info",
});

await writeFile(`${FUNC}/package.json`, `${JSON.stringify({ type: "module" }, null, 2)}\n`);

await writeFile(
  `${FUNC}/.vc-config.json`,
  `${JSON.stringify(
    {
      runtime: "nodejs24.x",
      handler: "index.js",
      launcherType: "Nodejs",
      // The helpers consume the request stream to populate `req.body`, which
      // leaves the entrypoint's listener waiting for a body already read —
      // the most likely mechanism behind honojs/node-server#306, where POST
      // hangs on Vercel while GET works.
      shouldAddHelpers: false,
      supportsResponseStreaming: true,
    },
    null,
    2,
  )}\n`,
);

await writeFile(
  `${OUT}/config.json`,
  `${JSON.stringify({ version: 3, routes: [{ src: "/(.*)", dest: "/api" }] }, null, 2)}\n`,
);

console.log(`Build Output API written to ${OUT}`);
