// Standard Expo monorepo config: watch the workspace root and resolve from both
// node_modules trees.
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
// pnpm keeps a package's own deps in its isolated store dir, so hierarchical
// lookup must stay ON — the setting Expo's npm/yarn monorepo guide turns off.
config.resolver.disableHierarchicalLookup = false;

module.exports = config;
