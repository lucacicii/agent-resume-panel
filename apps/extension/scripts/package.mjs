import { readFileSync } from "node:fs";
import { join } from "node:path";

import { packageVsix } from "./vsix-output.mjs";

const root = join(import.meta.dirname, "..");
const pkg = JSON.parse(readFileSync(join(root, "package.json"), "utf-8"));
const outPath = packageVsix(`${pkg.name}-${pkg.version}.vsix`);

console.log(`Packaged: ${outPath}`);