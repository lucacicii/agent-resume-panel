#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { buildHandoffMenuContributionBlocks } from "./generate-handoff-menu-contributions.mjs";
import { buildProjectMenuContributionBlocks } from "./generate-project-menu-contributions.mjs";
import { buildSessionMenuContributionBlocks } from "./generate-session-menu-contributions.mjs";

const root = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.join(root, "..");

function patchPackage(fileName) {
  const filePath = path.join(repoRoot, fileName);
  const pkg = JSON.parse(fs.readFileSync(filePath, "utf8"));
  const currentContext = pkg.contributes.menus["view/item/context"];
  const handoffBlocks = buildHandoffMenuContributionBlocks();
  const projectEnd = currentContext.findIndex((entry) => entry.submenu === "agentResume.projectMore");

  if (projectEnd === -1) {
    throw new Error(`Could not locate projectMore submenu in ${fileName}`);
  }

  const projectBlocks = buildProjectMenuContributionBlocks();
  const sessionBlocks = buildSessionMenuContributionBlocks();
  const after = currentContext.slice(projectEnd);

  const openFolderProjectEntry = {
    command: "agentResume.openFolder",
    when: "view == agentResume.sessions && viewItem =~ /agentResume\\.project/",
    group: "navigation@0"
  };

  pkg.contributes.menus["view/item/context"] = [
    ...sessionBlocks.sessionMenuPrefix,
    ...sessionBlocks.mainSessionMenu,
    ...sessionBlocks.sessionMoreTrigger,
    ...sessionBlocks.sessionMenuSuffix,
    ...handoffBlocks.sessionHandoffTrigger,
    ...handoffBlocks.acpContextEntries,
    ...handoffBlocks.acpHandoffTrigger,
    openFolderProjectEntry,
    ...projectBlocks.mainProjectMenu,
    ...sessionBlocks.projectSortExtras,
    ...after
  ];

  pkg.contributes.menus["agentResume.projectMore"] = projectBlocks.moreProjectMenu;
  pkg.contributes.menus["agentResume.sessionMore"] = sessionBlocks.moreSessionMenu;
  pkg.contributes.menus["agentResume.sessionSort"] = sessionBlocks.sessionSortMenu;
  pkg.contributes.menus["agentResume.projectSort"] = sessionBlocks.projectSortMenu;

  pkg.contributes.menus[handoffBlocks.handoffSubmenu.id] = handoffBlocks.handoffSubmenuItems;

  ensureSubmenus(pkg, handoffBlocks.handoffSubmenu);
  ensureSessionCommands(pkg);
  ensureHandoffCommands(pkg, handoffBlocks.handoffCommands);
  ensureSessionConfiguration(pkg);
  ensureHandoffConfiguration(pkg, handoffBlocks.handoffConfiguration);

  fs.writeFileSync(filePath, `${JSON.stringify(pkg, null, 2)}\n`);
  console.log(`Patched ${fileName} (session + handoff menus generated)`);
}

function ensureSubmenus(pkg, handoffSubmenu) {
  const submenus = pkg.contributes.submenus ?? [];
  const required = [
    { id: "agentResume.projectMore", label: "Show More" },
    { id: "agentResume.sessionMore", label: "Show More" },
    { id: "agentResume.sessionSort", label: "Sort Project Sessions" },
    { id: "agentResume.projectSort", label: "Sort Sessions" },
    handoffSubmenu
  ];

  for (const entry of required) {
    if (!submenus.some((item) => item.id === entry.id)) {
      submenus.push(entry);
    }
  }

  pkg.contributes.submenus = submenus;
}

function ensureSessionCommands(pkg) {
  const commands = pkg.contributes.commands ?? [];
  const required = [
    ["agentResume.configureSessionMenu", "Customize Session Menu"],
    ["agentResume.sortProjectSessionsUpdatedDesc", "Sort by Updated (Newest First)"],
    ["agentResume.sortProjectSessionsUpdatedAsc", "Sort by Updated (Oldest First)"],
    ["agentResume.sortProjectSessionsTitleAsc", "Sort by Title (A–Z)"],
    ["agentResume.sortProjectSessionsTitleDesc", "Sort by Title (Z–A)"]
  ];

  for (const [command, title] of required) {
    if (!commands.some((entry) => entry.command === command)) {
      commands.push({ command, title, category: "Agent Resume" });
    }
  }

  pkg.contributes.commands = commands;
}

function ensureHandoffCommands(pkg, handoffCommands) {
  const commands = pkg.contributes.commands ?? [];
  for (const entry of handoffCommands) {
    const existing = commands.find((item) => item.command === entry.command && item.title === entry.title);
    if (!existing) {
      commands.push(entry);
    }
  }
  pkg.contributes.commands = commands;
}

function ensureHandoffConfiguration(pkg, handoffConfiguration) {
  const properties = pkg.contributes.configuration.properties;
  delete properties["agentResume.handoff.defaultDelivery"];
  for (const [key, value] of Object.entries(handoffConfiguration)) {
    if (!properties[key]) {
      properties[key] = value;
    }
  }
}

function ensureSessionConfiguration(pkg) {
  const properties = pkg.contributes.configuration.properties;
  if (!properties["agentResume.sessionMenu.mainActions"]) {
    properties["agentResume.sessionMenu.mainActions"] = {
      type: "array",
      items: {
        type: "string",
        enum: [
          "copyResumeCommand",
          "openProject",
          "openInGhostty",
          "previewSession",
          "renameSession",
          "removeSessionFromPanel",
          "autoRenameSession"
        ]
      },
      default: ["copyResumeCommand", "openProject", "previewSession", "renameSession"],
      description:
        "Session context menu items shown outside Show More. Array order is the preferred sequence. Open Folder is always visible."
    };
  }

  if (!properties["agentResume.sessionMenu.itemOrder"]) {
    properties["agentResume.sessionMenu.itemOrder"] = {
      type: "array",
      items: {
        type: "string",
        enum: [
          "copyResumeCommand",
          "openProject",
          "openInGhostty",
          "previewSession",
          "renameSession",
          "removeSessionFromPanel",
          "autoRenameSession"
        ]
      },
      default: [
        "copyResumeCommand",
        "openProject",
        "openInGhostty",
        "previewSession",
        "renameSession",
        "removeSessionFromPanel",
        "autoRenameSession"
      ],
      description: "Preferred display order for all configurable session context menu actions."
    };
  }
}

patchPackage("package.json");
patchPackage("package-vscode.json");