// The two enforced axes from #2: layer order and platform tag. Everything else
// about the package graph is convention; these two are checked.
//
// Plus the type-only edge #2 carved out for AppRouter, which ADR-0009's
// @repo/auth-client now also needs. #2 put that rule in ESLint; #8 removed
// ESLint, and Biome has no equivalent, so it is enforced here instead.
import { type Dirent, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

type Platform = "universal" | "server" | "web" | "native" | "none";

type Pkg = {
  name: string;
  dir: string;
  isApp: boolean;
  layer: number;
  platform: Platform;
  deps: string[];
  thirdParty: string[];
  typeOnly: string[];
};

// What a package of each platform is allowed to import. A tag is a promise about
// where the code can run, so it can only ever narrow as you go up the graph.
const MAY_IMPORT: Record<Platform, Platform[]> = {
  universal: ["universal"],
  server: ["universal", "server"],
  web: ["universal", "web"],
  native: ["universal", "native"],
  none: [],
};

const SOURCE = /\.(ts|tsx|mts|cts)$/;

// Third-party packages a `universal` package may not declare (ADR-0013).
// The platform tag cannot police this: it only ranks `@repo/*` edges, so a
// universal package is free to depend on anything off npm. These two ship the
// Drizzle table machinery, and reaching for them here is how validators derived
// at run time — and `drizzle-orm/pg-core` with them — end up in a phone's
// bundle. The cost is bytes, not correctness, which is why it is a denylist
// rather than a layer rule.
const UNIVERSAL_DENYLIST = ["drizzle-orm", "drizzle-zod"];

const read = (dir: string): Pkg | undefined => {
  let raw: string;
  try {
    raw = readFileSync(join(dir, "package.json"), "utf8");
  } catch {
    return undefined;
  }
  const json = JSON.parse(raw);
  const repo = json.repo ?? {};
  return {
    name: json.name,
    dir,
    isApp: dir.startsWith("apps/"),
    layer: repo.layer,
    platform: repo.platform,
    typeOnly: repo.typeOnly ?? [],
    deps: Object.keys({ ...json.dependencies, ...json.devDependencies }).filter((d) =>
      d.startsWith("@repo/"),
    ),
    thirdParty: Object.keys({ ...json.dependencies, ...json.devDependencies }).filter(
      (d) => !d.startsWith("@repo/"),
    ),
  };
};

const sourcesOf = (dir: string): { path: string; text: string }[] => {
  let entries: Dirent[];
  try {
    entries = readdirSync(dir, { recursive: true, withFileTypes: true });
  } catch {
    return [];
  }
  return entries.flatMap((entry) => {
    if (!entry.isFile() || !SOURCE.test(entry.name)) return [];
    if (entry.parentPath.includes("node_modules")) return [];
    const path = join(entry.parentPath, entry.name);
    return [{ path, text: readFileSync(path, "utf8") }];
  });
};

// A dep declared typeOnly must never survive erasure, so every import of it has
// to be `import type` / `export type`. A value import would put a server package
// in a mobile bundle, which is the whole thing the platform tag promises.
const runtimeImportsOf = (text: string, dep: string): string[] => {
  const spec = `${dep.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(?:/[^"']*)?`;
  const found: string[] = [];
  // Anchor on the specifier and read *backwards* to the keyword that opens the
  // statement. Matching forwards from `import` needs a wildcard for the clause,
  // and that wildcard happily spans earlier statements — which reported the
  // first import in the file as importing whatever the last one did.
  const specifier = new RegExp(String.raw`\bfrom\s*["']${spec}["']`, "g");
  for (const match of text.matchAll(specifier)) {
    const before = text.slice(0, match.index);
    const opener = /\b(import|export)\b(\s+type\b)?(?![\s\S]*\b(?:import|export)\b)/.exec(before);
    // No opening keyword means this is not an import statement at all.
    if (!opener) continue;
    if (!opener[2]) {
      found.push(`${before.slice(opener.index).trim()} ${match[0]}`.replace(/\s+/g, " "));
    }
  }
  const sideEffect = new RegExp(String.raw`(?:^|[\n;])\s*import\s*["']${spec}["']`, "g");
  for (const match of text.matchAll(sideEffect)) {
    found.push(match[0].trim());
  }
  return found;
};

const packages = ["apps", "packages"].flatMap((root) => {
  let entries: string[];
  try {
    entries = readdirSync(root);
  } catch {
    return [];
  }
  return entries.flatMap((name) => read(join(root, name)) ?? []);
});

const byName = new Map(packages.map((p) => [p.name, p]));
const errors: string[] = [];

for (const pkg of packages) {
  if (typeof pkg.layer !== "number" || !(pkg.platform in MAY_IMPORT)) {
    errors.push(`${pkg.dir}: package.json needs "repo": { "layer": <number>, "platform": <tag> }`);
    continue;
  }

  if (pkg.platform === "universal") {
    for (const dep of UNIVERSAL_DENYLIST) {
      if (pkg.thirdParty.includes(dep)) {
        errors.push(
          `${pkg.name} is "universal" but depends on ${dep}, which no universal package may declare.`,
        );
      }
    }
  }

  for (const dep of pkg.typeOnly) {
    if (!pkg.deps.includes(dep)) {
      errors.push(`${pkg.name} declares ${dep} as typeOnly but does not depend on it`);
    }
  }

  for (const dep of pkg.deps) {
    const target = byName.get(dep);
    if (!target) {
      errors.push(`${pkg.name} depends on ${dep}, which is not a workspace package`);
      continue;
    }
    if (target.isApp) {
      errors.push(`${pkg.name} imports the app ${dep}. Nothing imports an app.`);
    }
    // A type-only edge is erased before any bundler sees it, so it carries
    // neither layer nor platform meaning. It still has to be proven erased.
    if (pkg.typeOnly.includes(dep)) continue;
    if (target.layer >= pkg.layer) {
      errors.push(
        `${pkg.name} (layer ${pkg.layer}) imports ${dep} (layer ${target.layer}). Imports go strictly downward.`,
      );
    }
    if (!MAY_IMPORT[pkg.platform].includes(target.platform)) {
      errors.push(
        `${pkg.name} is "${pkg.platform}" but imports ${dep}, which is "${target.platform}".`,
      );
    }
  }

  if (pkg.typeOnly.length > 0) {
    for (const source of sourcesOf(pkg.dir)) {
      for (const dep of pkg.typeOnly) {
        for (const statement of runtimeImportsOf(source.text, dep)) {
          errors.push(
            `${source.path}: ${dep} is typeOnly for ${pkg.name}, so this must be "import type":\n      ${statement}`,
          );
        }
      }
    }
  }
}

if (errors.length > 0) {
  console.error(`Package graph violations:\n\n${errors.map((e) => `  - ${e}`).join("\n")}\n`);
  process.exit(1);
}
console.log(`Package graph OK (${packages.length} packages).`);
