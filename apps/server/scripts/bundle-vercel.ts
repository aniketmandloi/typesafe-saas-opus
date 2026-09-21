import { build } from "esbuild";

// One file, no runtime module resolution. #14 chose esbuild for the Lambda
// asset and the reasoning carries: the kit's packages ship raw TypeScript, and
// a deployed function cannot resolve an `exports` map that names a `.ts` file
// nothing transpiled in place.
//
// `pg-native` is external because it is an optional peer of `pg` that nothing
// here installs; bundling it would fail on a module that is meant to be absent.
await build({
  entryPoints: ["src/entrypoints/vercel.ts"],
  outfile: "api/index.js",
  bundle: true,
  platform: "node",
  target: "node24",
  format: "esm",
  external: ["pg-native"],
  // ESM output that reaches a CommonJS dependency needs `require` to exist.
  banner: {
    js: [
      "import { createRequire as __createRequire } from 'node:module';",
      "const require = __createRequire(import.meta.url);",
    ].join("\n"),
  },
  logLevel: "info",
});
