// Measures the dev loop: esbuild incremental rebuild vs Node's own type stripping.
import { context } from "esbuild";
import { appendFileSync, readFileSync, writeFileSync } from "node:fs";

const file = "packages/core/src/index.ts";
const original = readFileSync(file, "utf8");

const ctx = await context({
  entryPoints: ["apps/server/src/entrypoints/node.ts"],
  outfile: "dist/dev/index.mjs",
  bundle: true, platform: "node", target: "node24", format: "esm",
  external: ["sharp"], sourcemap: true, logLevel: "error",
  banner: { js: "import{createRequire}from'node:module';const require=createRequire(import.meta.url);" },
});

const t0 = performance.now();
await ctx.rebuild();
console.log(`esbuild cold build:        ${Math.round(performance.now() - t0)}ms`);

const times = [];
for (let i = 0; i < 5; i++) {
  appendFileSync(file, `\nexport const touch${i} = ${i};\n`);
  const t = performance.now();
  await ctx.rebuild();
  times.push(performance.now() - t);
}
writeFileSync(file, original);
await ctx.dispose();
console.log(`esbuild incremental rebuild: ${times.map((t) => Math.round(t)).join(", ")}ms  (median ${Math.round(times.sort((a, b) => a - b)[2])}ms)`);
