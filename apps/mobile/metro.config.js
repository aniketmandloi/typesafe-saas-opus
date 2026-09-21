// Metro, told where the workspace is.
//
// Packages are consumed as TypeScript source with no build step (#14), and
// under pnpm they are symlinks into `.pnpm`, so Metro has to watch the repo
// root and resolve from both node_modules trees. `unstable_enableSymlinks` is
// on by default in SDK 57; watching the root is not.
const { getDefaultConfig } = require("expo/metro-config");
const path = require("node:path");

const projectRoot = __dirname;
const workspaceRoot = path.resolve(projectRoot, "../..");

const config = getDefaultConfig(projectRoot);

config.watchFolders = [workspaceRoot];
config.resolver.nodeModulesPaths = [
  path.resolve(projectRoot, "node_modules"),
  path.resolve(workspaceRoot, "node_modules"),
];
// Hierarchical lookup stays **on**, which is the opposite of the usual monorepo
// advice. That advice is written for npm and yarn, where walking up finds
// hoisted packages nobody declared. Under pnpm the layout is inverted: a
// package's own dependencies are its siblings inside `.pnpm/<pkg>/node_modules`,
// so walking up one level from `react-native/index.js` is precisely how it
// finds `invariant`. Disabling it makes React Native itself unresolvable.

module.exports = config;
