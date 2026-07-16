#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const extensionRoot = path.join(scriptDir, "..");
const manifestDir = path.join(extensionRoot, "manifest");

const variant = process.argv.includes("--variant=marketplace") ? "marketplace" : "openvsx";
const baseFile = variant === "marketplace" ? "base.marketplace.json" : "base.openvsx.json";
const outPath = process.argv.includes("--out")
  ? process.argv[process.argv.indexOf("--out") + 1]
  : path.join(extensionRoot, "package.json");

const base = JSON.parse(fs.readFileSync(path.join(manifestDir, baseFile), "utf8"));
const generated = JSON.parse(fs.readFileSync(path.join(manifestDir, "contributes.generated.json"), "utf8"));

const pkg = {
  ...base,
  contributes: {
    configuration: base.contributes?.configuration,
    viewsContainers: base.contributes?.viewsContainers,
    views: base.contributes?.views,
    commands: [...(base.contributes?.commands ?? []), ...(generated.commands ?? [])],
    submenus: generated.submenus ?? [],
    menus: generated.menus ?? {}
  }
};

fs.writeFileSync(outPath, `${JSON.stringify(pkg, null, 2)}\n`);
console.log(`Merged ${variant} manifest → ${outPath}`);
