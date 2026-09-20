// The two enforced axes from #2: layer order and platform tag. Everything else
// about the package graph is convention; these two are checked.
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

type Platform = "universal" | "server" | "web" | "native" | "none";

type Pkg = {
  name: string;
  dir: string;
  isApp: boolean;
  layer: number;
  platform: Platform;
  deps: string[];
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
    deps: Object.keys({ ...json.dependencies, ...json.devDependencies }).filter((d) =>
      d.startsWith("@repo/"),
    ),
  };
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
  for (const dep of pkg.deps) {
    const target = byName.get(dep);
    if (!target) {
      errors.push(`${pkg.name} depends on ${dep}, which is not a workspace package`);
      continue;
    }
    if (target.isApp) {
      errors.push(`${pkg.name} imports the app ${dep}. Nothing imports an app.`);
    }
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
}

if (errors.length > 0) {
  console.error(`Package graph violations:\n\n${errors.map((e) => `  - ${e}`).join("\n")}\n`);
  process.exit(1);
}
console.log(`Package graph OK (${packages.length} packages).`);
