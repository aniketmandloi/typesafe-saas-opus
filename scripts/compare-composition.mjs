import { build } from "esbuild";
import { statSync } from "node:fs";

// metafile.inputs lists what was *scanned*; outputs[].inputs[].bytesInOutput is
// what actually survived tree-shaking. The second is the only honest measure.
const emitted = (meta, out, match) => {
  const o = meta.outputs[out];
  return Object.entries(o.inputs)
    .filter(([p]) => p.includes(match))
    .reduce((n, [, v]) => n + v.bytesInOutput, 0);
};

const cases = [
  ["static (s3 only)", "apps/server/src/entrypoints/lambda.ts"],
  ["static (blob only)", "apps/server/src/entrypoints/blob-only-lambda.ts"],
  ["runtime factory (env var)", "apps/server/src/entrypoints/factory-lambda.ts"],
  ["blob composed, s3 imported unused", "apps/server/src/entrypoints/unused-import-lambda.ts"],
];

for (const [label, entry] of cases) {
  const out = `dist/cmp/${entry.split("/").pop()}.mjs`;
  const r = await build({
    entryPoints: [entry], outfile: out, bundle: true, platform: "node", target: "node24",
    format: "esm", external: ["sharp"], minify: true, metafile: true, logLevel: "error",
    banner: { js: "import{createRequire}from'node:module';const require=createRequire(import.meta.url);" },
  });
  const total = statSync(out).size / 1024;
  const sdk = emitted(r.metafile, out, "@aws-sdk") / 1024;
  const blob = emitted(r.metafile, out, "@vercel+blob") / 1024;
  console.log(
    label.padEnd(34) +
    `${total.toFixed(0).padStart(5)} KiB total | @aws-sdk emitted ${sdk.toFixed(0).padStart(4)} KiB | @vercel/blob emitted ${blob.toFixed(0)} KiB`
  );
}
