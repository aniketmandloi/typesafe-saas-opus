// Replicates what CDK NodejsFunction does: esbuild, bundle, platform=node,
// depsLockFilePath at the workspace root. Two variants, to see what each costs.
import { build } from "esbuild";
import { statSync } from "node:fs";

const variants = [
  { name: "lambda-all-bundled", external: ["sharp"] },
  { name: "lambda-sdk-external", external: ["sharp", "@aws-sdk/*"] },
];

for (const v of variants) {
  const outfile = `dist/${v.name}/index.mjs`;
  const t0 = performance.now();
  const result = await build({
    entryPoints: ["apps/server/src/entrypoints/lambda.ts"],
    outfile,
    bundle: true,
    platform: "node",
    target: "node24",
    format: "esm",
    external: v.external,
    treeShaking: true,
    minify: true,
    sourcemap: false,
    metafile: true,
    banner: { js: "import{createRequire}from'node:module';const require=createRequire(import.meta.url);" },
    logLevel: "warning",
  });
  const ms = Math.round(performance.now() - t0);
  const inputs = Object.keys(result.metafile.inputs);
  const bytes = statSync(outfile).size;
  const repoInlined = inputs.filter((i) => i.includes("/packages/") && i.endsWith(".ts"));
  const blob = inputs.filter((i) => i.includes("@vercel+blob") || i.includes("storage-blob"));
  const sdk = inputs.filter((i) => i.includes("@aws-sdk"));
  const sharpIn = inputs.filter((i) => i.includes("sharp"));
  console.log(`\n## ${v.name}  (${ms}ms, ${(bytes / 1024).toFixed(0)} KiB)`);
  console.log(`   inputs: ${inputs.length}`);
  console.log(`   @repo/* raw .ts inlined: ${repoInlined.length} -> ${repoInlined.map((p) => p.split("/packages/")[1]).join(", ")}`);
  console.log(`   @aws-sdk files pulled in: ${sdk.length}`);
  console.log(`   sharp files pulled in: ${sharpIn.length}`);
  console.log(`   unused provider (@vercel/blob) present: ${blob.length > 0 ? "YES -> " + blob.join(",") : "no"}`);
}
