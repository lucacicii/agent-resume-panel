#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { buildHandoffMenuContributionBlocks } from "./generate-handoff-menu-contributions.mjs";
import { buildProjectMenuContributionBlocks } from "./generate-project-menu-contributions.mjs";
import { buildSessionMenuContributionBlocks } from "./generate-session-menu-contributions.mjs";
import {
  UI_LOCALES,
  buildLocalizedContextMenuCommands,
  buildLocalizedContextSubmenus,
  expandMenuEntriesForLocales,
  localizedSubmenuId,
  loadAllLocaleCatalogs
} from "./menu-i18n.mjs";

const root = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.join(root, "..");

function expandBlock(entries) {
  return expandMenuEntriesForLocales(entries);
}

function assignLocalizedSubmenus(pkg, baseId, entries) {
  for (const locale of UI_LOCALES) {
    pkg.contributes.menus[localizedSubmenuId(baseId, locale)] = expandBlock(entries);
  }
}

function patchPackage(fileName) {
  const filePath = path.join(repoRoot, fileName);
  const pkg = JSON.parse(fs.readFileSync(filePath, "utf8"));
  const catalogs = loadAllLocaleCatalogs(repoRoot);
  const handoffBlocks = buildHandoffMenuContributionBlocks();
  const projectBlocks = buildProjectMenuContributionBlocks();
  const sessionBlocks = buildSessionMenuContributionBlocks();

  const projectMoreTrigger = {
    submenu: "agentResume.projectMore",
    when: "view == agentResume.sessions && viewItem =~ /agentResume\\.project/",
    group: "navigation@50"
  };

  const openFolderProjectEntry = {
    command: "agentResume.openFolder",
    when: "view == agentResume.sessions && viewItem =~ /agentResume\\.project/",
    group: "navigation@0"
  };

  const notesContextEntries = [
    {
      command: "agentResume.openNote",
      when: "view == agentResume.notes && viewItem == agentResume.notes.note",
      group: "inline@1"
    },
    {
      command: "agentResume.renameNote",
      when: "view == agentResume.notes && viewItem == agentResume.notes.note",
      group: "1_notes@1"
    },
    {
      command: "agentResume.deleteNote",
      when: "view == agentResume.notes && viewItem == agentResume.notes.note",
      group: "1_notes@2"
    },
    {
      command: "agentResume.revealNoteInOS",
      when: "view == agentResume.notes && viewItem == agentResume.notes.note",
      group: "1_notes@3"
    },
    {
      command: "agentResume.copyNotePath",
      when: "view == agentResume.notes && viewItem == agentResume.notes.note",
      group: "1_notes@4"
    },
    {
      command: "agentResume.newNote",
      when:
        "view == agentResume.notes && (viewItem == agentResume.notes.project || viewItem == agentResume.notes.session)",
      group: "inline@1"
    },
    {
      command: "agentResume.importNotes",
      when:
        "view == agentResume.notes && (viewItem == agentResume.notes.project || viewItem == agentResume.notes.session || viewItem == agentResume.notes.note)",
      group: "1_notes@import"
    }
  ];

  const notesTitleEntries = [
    {
      command: "agentResume.filterNotes",
      when: "view == agentResume.notes",
      group: "navigation@0"
    },
    {
      command: "agentResume.clearNotesFilter",
      when: "view == agentResume.notes",
      group: "navigation@1"
    },
    {
      command: "agentResume.newNote",
      when: "view == agentResume.notes",
      group: "navigation@2"
    },
    {
      command: "agentResume.importNotes",
      when: "view == agentResume.notes",
      group: "navigation@3"
    },
    {
      command: "agentResume.refreshNotes",
      when: "view == agentResume.notes",
      group: "navigation@4"
    },
    {
      command: "agentResume.openNotesFolder",
      when: "view == agentResume.notes",
      group: "navigation@5"
    }
  ];

  pkg.contributes.menus["view/item/context"] = [
    ...expandBlock(notesContextEntries),
    ...expandBlock(sessionBlocks.sessionMenuPrefix),
    ...expandBlock(sessionBlocks.mainSessionMenu),
    ...expandBlock(sessionBlocks.sessionMoreTrigger),
    ...expandBlock(sessionBlocks.sessionMenuSuffix),
    ...handoffBlocks.sessionHandoffTrigger,
    ...handoffBlocks.acpContextEntries,
    ...handoffBlocks.acpHandoffTrigger,
    ...expandBlock([openFolderProjectEntry]),
    ...expandBlock(projectBlocks.mainProjectMenu),
    ...expandBlock(sessionBlocks.projectSortExtras),
    ...expandBlock([projectMoreTrigger])
  ];

  // Keep non-notes title menus, then append localized Notes title actions.
  const previousTitle = pkg.contributes.menus["view/title"] ?? [];
  pkg.contributes.menus["view/title"] = [
    ...previousTitle.filter((entry) => !String(entry.when ?? "").includes("view == agentResume.notes")),
    ...expandBlock(notesTitleEntries),
    {
      command: "agentResume.openSettings",
      when: "view == agentResume.notes",
      group: "navigation@6"
    }
  ];

  assignLocalizedSubmenus(pkg, "agentResume.projectMore", projectBlocks.moreProjectMenu);
  assignLocalizedSubmenus(pkg, "agentResume.sessionMore", sessionBlocks.moreSessionMenu);
  assignLocalizedSubmenus(pkg, "agentResume.sessionSort", sessionBlocks.sessionSortMenu);
  assignLocalizedSubmenus(pkg, "agentResume.projectSort", sessionBlocks.projectSortMenu);

  pkg.contributes.menus[handoffBlocks.handoffSubmenu.id] = handoffBlocks.handoffSubmenuItems;

  ensureSubmenus(pkg, handoffBlocks.handoffSubmenu, catalogs);
  ensureLocalizedContextMenuCommands(pkg, catalogs);
  ensureHandoffCommands(pkg, handoffBlocks.handoffCommands);
  ensureSessionConfiguration(pkg);
  ensureHandoffConfiguration(pkg, handoffBlocks.handoffConfiguration);

  fs.writeFileSync(filePath, `${JSON.stringify(pkg, null, 2)}\n`);
  console.log(`Patched ${fileName} (session + project menus with locale variants)`);
}

function ensureSubmenus(pkg, handoffSubmenu, catalogs) {
  const localized = buildLocalizedContextSubmenus(catalogs);
  const submenus = (pkg.contributes.submenus ?? []).filter(
    (item) =>
      item.id !== handoffSubmenu.id &&
      !/^agentResume\.(projectMore|sessionMore|sessionSort|projectSort)(\.|$)/.test(item.id)
  );
  submenus.push(...localized, handoffSubmenu);
  pkg.contributes.submenus = submenus;
}

function ensureLocalizedContextMenuCommands(pkg, catalogs) {
  const localized = buildLocalizedContextMenuCommands(catalogs);
  const localizedIds = new Set(localized.map((entry) => entry.command));
  const commands = (pkg.contributes.commands ?? []).filter((entry) => !localizedIds.has(entry.command));
  commands.push(...localized);
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