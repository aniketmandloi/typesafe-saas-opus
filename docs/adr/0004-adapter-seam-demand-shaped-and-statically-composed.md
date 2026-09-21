# Adapter interfaces are demand-shaped and composed statically

Infrastructure capabilities — storage, email, queue, billing — sit behind kit-owned interfaces. Three decisions about those interfaces are recorded because each looks like an omission.

**The interface is the kit's demand surface, not any provider's capability surface.** It exposes what the kit's own use cases need and nothing more; storage is roughly presign-upload, presign-download, delete. The alternatives were a lowest common denominator, which cannot express the presigned direct-to-storage upload the kit requires, and a richest-provider interface with `NotSupported` errors, which offers fake portability — you discover at run time that your provider cannot do the thing. Demand-shaping means **no kit-shipped adapter ever throws `NotSupported`**: a provider that cannot meet the demand surface is not an offered provider, which turns a runtime failure into a selection-time constraint.

**Adapters are composed statically by the entrypoint, not selected at run time by an environment variable.** A runtime factory switching on an env var references every provider SDK, so every provider SDK lands in the bundle — cold-start cost on Lambda for code that never executes. The entrypoint is already the one place target-specific code may appear, and provider choice is a property of a deployment target, so the two align. Environment variables still *configure* the chosen adapter; they do not choose it.

**There is no escape hatch.** No `.raw` accessor exposing the underlying SDK client. That accessor is how a seam dies: provider types reach use-case signatures within a release or two, and the containment that justifies the billing seam evaporates. The kit is fork-and-go, so a cloner owns the adapter package outright and widening its interface is ordinary work on their own code, not circumvention.

## Consequences

Each adapter package exports an environment-schema fragment alongside its config type, and the entrypoint composes only the fragments for the adapters it composed. A deployment's env schema therefore *requires* exactly the variables its providers need, instead of making every provider's variables optional and validating nothing.

The billing seam has one implementation ([ADR-0017](./0017-polar-is-the-billing-provider.md)) and is justified by **containment, not substitutability** — keeping merchant-of-record and Team Customer concepts out of use cases. No Stripe adapter exists, so the kit does not claim a proven swap.

Image processing stays outside the storage seam. Some providers transform on read and S3 does not; folding transforms in would re-shape the interface around provider capability, which is what demand-shaping rejects.

A fork that widens an interface makes subsequent upstream merges harder. That is the accepted price of having no bypass.

**No provider implementation has ever run on a deployed target.** All three of `apps/server`'s entrypoints compose `createLocalProfile`, so every target serves the fake storage, email and queue *by construction*. The deployed slice proved the target residue — handler signature, pool policy, module-scope parse, the bundle step ([ADR-0016](./0016-deployed-server-targets-ship-a-bundle.md)) — and nothing about the adapter set: no S3 presign has been issued, no SES mail sent and no Postgres queue drained anywhere but a test. That the two are separable at all is [ADR-0006](./0006-entrypoints-parse-env-packages-never-do.md)'s split working as intended; what it costs is that the first real provider composition happens against an unexercised seam.
