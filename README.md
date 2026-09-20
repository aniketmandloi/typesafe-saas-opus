# Bundling spike — branch `spike/bundling-per-target`

Throwaway workspace answering issue #14: can a Hono server importing raw-TypeScript
`@repo/*` workspace packages be bundled and deployed to every supported target?

Not production build config, and not on `main` — `main` keeps only the decision.

```
pnpm install
node scripts/build-lambda.mjs         # esbuild, as CDK NodejsFunction runs it
node scripts/compare-composition.mjs  # static composition vs runtime factory
node scripts/trace-vercel.mjs         # @vercel/nft
```

Findings: `FINDINGS.md`.
