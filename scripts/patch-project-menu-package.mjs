#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";
import { execSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { buildProjectMenuContributionBlocks } from "./generate-project-menu-contributions.mjs";

const root = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.join(root, "..");

function extractSessionContextBlock(viewItemContext) {
  const sessionStart = viewItemContext.findIndex((entry) => entry.command === "agentResume.openSession");
  const projectStart = viewItemContext.findIndex(
    (entry) =>
      entry.command === "agentResume.openFolder" &&
      entry.when?.includes("agentResume\\.project")
  );

  if (sessionStart === -1 || projectStart === -1 || projectStart <= sessionStart) {
    return null;
  }

  return viewItemContext.slice(sessionStart, projectStart);
}

function loadSessionContextBlock(fileName, currentContext) {
  const fromCurrent = extractSessionContextBlock(currentContext);
  if (fromCurrent && fromCurrent.length > 0) {
    return fromCurrent;
  }

  try {
    const fromGit = execSync(`git show HEAD:${fileName}`, { cwd: repoRoot, encoding: "utf8" });
    const baselineContext = JSON.parse(fromGit).contributes.menus["view/item/context"];
    const fromHead = extractSessionContextBlock(baselineContext);
    if (fromHead && fromHead.length > 0) {
      return fromHead;
    }
  } catch {
    // Fall through to the error below.
  }

  throw new Error(`Could not locate session context menu block in ${fileName}`);
}

function patchPackage(fileName) {
  const filePath = path.join(repoRoot, fileName);
  const pkg = JSON.parse(fs.readFileSync(filePath, "utf8"));
  const currentContext = pkg.contributes.menus["view/item/context"];
  const sessionBlock = loadSessionContextBlock(fileName, currentContext);
  const projectEnd = currentContext.findIndex((entry) => entry.submenu === "agentResume.projectMore");

  if (projectEnd === -1) {
    throw new Error(`Could not locate projectMore submenu in ${fileName}`);
  }

  const blocks = buildProjectMenuContributionBlocks();
  const after = currentContext.slice(projectEnd);
  const openFolderEntry = {
    command: "agentResume.openFolder",
    when: "view == agentResume.sessions && viewItem =~ /agentResume\\.project/",
    group: "navigation@0"
  };

  pkg.contributes.menus["view/item/context"] = [
    ...sessionBlock,
    openFolderEntry,
    ...blocks.mainProjectMenu,
    ...after
  ];
  pkg.contributes.menus["agentResume.projectMore"] = blocks.moreProjectMenu;

  fs.writeFileSync(filePath, `${JSON.stringify(pkg, null, 2)}\n`);
  console.log(`Patched ${fileName} (preserved ${sessionBlock.length} session menu entries)`);
}

patchPackage("package.json");
patchPackage("package-vscode.json");