// ADR-0010. Type stripping is refused for any file whose realpath sits under
// node_modules, so a `hoisted` linker makes every @repo/* package fail with
// ERR_UNSUPPORTED_NODE_MODULES_TYPE_STRIPPING — a message that reads like a Node
// bug rather than like a pnpm setting. Fail here instead, naming the cause.
import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

const REQUIRED = "isolated";

const fromNpmrc = (path: string): string | undefined => {
  let contents: string;
  try {
    contents = readFileSync(path, "utf8");
  } catch {
    return undefined;
  }
  // Last assignment wins, matching npm/pnpm config precedence within one file.
  let found: string | undefined;
  for (const line of contents.split("\n")) {
    const match = /^\s*node-linker\s*=\s*(\S+)/.exec(line);
    if (match) found = match[1];
  }
  return found;
};

const configured =
  process.env.npm_config_node_linker ??
  fromNpmrc(join(process.cwd(), ".npmrc")) ??
  fromNpmrc(join(homedir(), ".npmrc")) ??
  REQUIRED;

if (configured !== REQUIRED) {
  console.error(`
  node-linker is "${configured}", and this workspace requires "${REQUIRED}".

  Packages here are consumed as raw TypeScript with no build step. Node strips
  types only for files whose realpath is outside node_modules, and "${configured}"
  materialises @repo/* packages inside it. Every import of one would fail with
  ERR_UNSUPPORTED_NODE_MODULES_TYPE_STRIPPING, which does not mention pnpm.

  Restore node-linker=isolated in .npmrc. If you changed it to work around an
  unrelated dependency problem, that problem needs a different fix.
`);
  process.exit(1);
}
