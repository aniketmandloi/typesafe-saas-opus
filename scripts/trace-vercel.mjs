import { nodeFileTrace } from "@vercel/nft";
import { statSync } from "node:fs";
import { resolve } from "node:path";

const base = process.cwd();

const report = async (label, files) => {
  const t0 = performance.now();
  const { fileList, warnings, reasons } = await nodeFileTrace(files, { base, ts: true });
  const list = [...fileList];
  const ws = list.filter((f) => /^(packages|apps)\//.test(f));
  const node = list.filter((f) => f.endsWith(".node"));
  const sharp = list.filter((f) => f.includes("sharp"));
  const sdk = list.filter((f) => f.includes("@aws-sdk"));
  const blob = list.filter((f) => f.includes("@vercel+blob"));
  let bytes = 0;
  for (const f of list) { try { bytes += statSync(resolve(base, f)).size; } catch {} }
  console.log(`\n## ${label}  (${Math.round(performance.now() - t0)}ms)`);
  console.log(`   files traced: ${list.length}, total ${(bytes / 1024 / 1024).toFixed(1)} MiB`);
  console.log(`   workspace files: ${ws.length} -> ${ws.slice(0, 12).join(", ")}`);
  console.log(`   @aws-sdk: ${sdk.length} files | @vercel/blob: ${blob.length} files`);
  console.log(`   sharp: ${sharp.length} files, native .node binaries: ${node.length}`);
  if (node.length) console.log(`     ${node.slice(0, 6).join("\n     ")}`);
  const warn = [...warnings].map((w) => w.message);
  console.log(`   warnings: ${warn.length}`);
  warn.slice(0, 12).forEach((w) => console.log(`     - ${w}`));
  return list;
};

await report("raw TS entrypoint (apps/server/src/entrypoints/vercel.ts)", ["apps/server/src/entrypoints/vercel.ts"]);
await report("esbuild output (dist/lambda-all-bundled/index.mjs)", ["dist/lambda-all-bundled/index.mjs"]);
