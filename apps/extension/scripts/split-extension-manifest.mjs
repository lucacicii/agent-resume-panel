#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const extensionRoot = path.join(scriptDir, "..");
const repoRoot = path.join(extensionRoot, "..", "..");
const manifestDir = path.join(extensionRoot, "manifest");

const LOCALE_PREFIX_RE = /^agentResume\.(zh-cn|ja|ko|es|fr|de|pt-br|it|ru)\./;

function isLocalizedCommand(command) {
  return LOCALE_PREFIX_RE.test(command);
}

function splitPackage(sourcePath, baseOutPath) {
  const pkg = JSON.parse(fs.readFileSync(sourcePath, "utf8"));
  const contributes = pkg.contributes ?? {};
  const allCommands = contributes.commands ?? [];
  const baseCommands = allCommands.filter((entry) => !isLocalizedCommand(entry.command));
  const localizedCommands = allCommands.filter((entry) => isLocalizedCommand(entry.command));

  const generated = {
    commands: localizedCommands,
    submenus: contributes.submenus ?? [],
    menus: contributes.menus ?? {}
  };

  const base = { ...pkg };
  delete base.workspaces;
  base.contributes = {
    configuration: contributes.configuration,
    viewsContainers: contributes.viewsContainers,
    views: contributes.views,
    commands: baseCommands
  };

  fs.mkdirSync(manifestDir, { recursive: true });
  fs.writeFileSync(baseOutPath, `${JSON.stringify(base, null, 2)}\n`);
  return { base, generated, baseCommands: baseCommands.length, localizedCommands: localizedCommands.length };
}

const openvsxSource = path.join(repoRoot, "package.json");
const marketplaceSource = path.join(repoRoot, "package-vscode.json");
const generatedPath = path.join(manifestDir, "contributes.generated.json");

const openvsx = splitPackage(openvsxSource, path.join(manifestDir, "base.openvsx.json"));
const marketplace = splitPackage(marketplaceSource, path.join(manifestDir, "base.marketplace.json"));

fs.writeFileSync(generatedPath, `${JSON.stringify(openvsx.generated, null, 2)}\n`);

console.log("Split extension manifests:");
console.log(`  base.openvsx.json       base commands: ${openvsx.baseCommands}, localized: ${openvsx.localizedCommands}`);
console.log(
  `  base.marketplace.json   base commands: ${marketplace.baseCommands}, localized: ${marketplace.localizedCommands}`
);
console.log(
  `  contributes.generated.json  commands: ${openvsx.generated.commands.length}, submenus: ${openvsx.generated.submenus.length}, menu sections: ${Object.keys(openvsx.generated.menus).length}`
);
