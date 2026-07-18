import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { distVsixPath } from "./vsix-output.mjs";

const extensionRoot = join(import.meta.dirname, "..");
const pkg = JSON.parse(readFileSync(join(extensionRoot, "package.json"), "utf8"));
const vsixPath = distVsixPath(pkg.name, pkg.version);

if (!existsSync(vsixPath)) {
  throw new Error(`VSIX not found: ${vsixPath}\nRun pnpm run build:openvsx first.`);
}

console.log(`Publishing to Open VSX: ${vsixPath}`);
execFileSync("pnpm", ["exec", "ovsx", "publish", vsixPath], {
  cwd: extensionRoot,
  stdio: "inherit",
  env: process.env
});
