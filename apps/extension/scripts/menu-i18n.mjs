import { existsSync, readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

export const UI_LOCALES = ["en", "zh-cn", "ja"];
export const UI_LOCALE_CONTEXT = "agentResume.uiLocale";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");

/** Commands shown in session/project view context menus (base IDs, English). */
export const CONTEXT_MENU_COMMAND_SPECS = [
  { base: "agentResume.openSession", key: "tree.commandResumeSession" },
  { base: "agentResume.copyResumeCommand", key: "menu.session.copyResumeCommand" },
  { base: "agentResume.openFolder", key: "menu.openFolder" },
  { base: "agentResume.openProject", key: "menu.session.openProject" },
  { base: "agentResume.openInGhostty", key: "menu.session.openInGhostty" },
  { base: "agentResume.previewSession", key: "menu.session.previewSession" },
  { base: "agentResume.renameSession", key: "menu.session.renameSession" },
  { base: "agentResume.removeSessionFromPanel", key: "menu.session.removeSessionFromPanel" },
  { base: "agentResume.autoRenameSession", key: "menu.session.autoRenameSession" },
  { base: "agentResume.setSessionGtdStatus", key: "menu.session.setGtdStatus" },
  { base: "agentResume.openSessionNote", key: "menu.session.openNote" },
  { base: "agentResume.deleteSessionNote", key: "menu.session.deleteNote" },
  { base: "agentResume.openProjectNote", key: "menu.project.openNote" },
  { base: "agentResume.deleteProjectNote", key: "menu.project.deleteNote" },
  { base: "agentResume.setNoteGtdStatus", key: "menu.notes.setGtdStatus" },
  { base: "agentResume.openNote", key: "menu.notes.open" },
  { base: "agentResume.renameNote", key: "menu.notes.rename" },
  { base: "agentResume.deleteNote", key: "menu.notes.delete" },
  { base: "agentResume.revealNoteInOS", key: "menu.notes.revealInOS" },
  { base: "agentResume.copyNotePath", key: "menu.notes.copyPath" },
  { base: "agentResume.newNote", key: "menu.notes.new", icon: "$(plus)" },
  { base: "agentResume.importNotes", key: "menu.notes.import", icon: "$(desktop-download)" },
  { base: "agentResume.filterNotes", key: "menu.notes.filter", icon: "$(filter)" },
  { base: "agentResume.clearNotesFilter", key: "menu.notes.clearFilter", icon: "$(clear-all)" },
  { base: "agentResume.refreshNotes", key: "menu.notes.refresh", icon: "$(refresh)" },
  { base: "agentResume.openNotesFolder", key: "menu.notes.openFolder", icon: "$(folder-opened)" },
  { base: "agentResume.insertNoteImage", key: "menu.notes.insertImage" },
  { base: "agentResume.configureSessionMenu", key: "menu.configureSessionMenu" },
  { base: "agentResume.openInCodexApp", key: "menu.resumeInCodexApp" },
  { base: "agentResume.openInClaudeCodePanel", key: "menu.resumeInClaudeCodePanel" },
  { base: "agentResume.openInCodexIdePanel", key: "menu.resumeInCodexIdePanel" },
  { base: "agentResume.sortProjectSessionsUpdatedDesc", key: "menu.sort.updatedDesc" },
  { base: "agentResume.sortProjectSessionsUpdatedAsc", key: "menu.sort.updatedAsc" },
  { base: "agentResume.sortProjectSessionsTitleAsc", key: "menu.sort.titleAsc" },
  { base: "agentResume.sortProjectSessionsTitleDesc", key: "menu.sort.titleDesc" },
  { base: "agentResume.favoriteProject", key: "menu.addFavorite" },
  { base: "agentResume.unfavoriteProject", key: "menu.removeFavorite" },
  { base: "agentResume.setProjectAlias", key: "menu.project.setProjectAlias" },
  { base: "agentResume.configureProjectMenu", key: "menu.configureProjectMenu" },
  { base: "agentResume.newChatSession", key: "menu.project.newChatSession" },
  { base: "agentResume.newCodexSession", key: "menu.project.newCodexSession" },
  { base: "agentResume.newClaudeSession", key: "menu.project.newClaudeSession" },
  { base: "agentResume.newAgySession", key: "menu.project.newAgySession" },
  { base: "agentResume.newGrokSession", key: "menu.project.newGrokSession" },
  { base: "agentResume.newOpenCodeSession", key: "menu.project.newOpenCodeSession" },
  { base: "agentResume.newPiSession", key: "menu.project.newPiSession" },
  { base: "agentResume.newCodexAppSession", key: "menu.project.newCodexAppSession" }
];

export const CONTEXT_SUBMENU_SPECS = [
  { base: "agentResume.projectMore", key: "tree.showMore" },
  { base: "agentResume.sessionMore", key: "tree.showMore" },
  { base: "agentResume.sessionSort", key: "menu.sort.sessionSubmenu" },
  { base: "agentResume.projectSort", key: "menu.sort.projectSubmenu" }
];

export function localizedMenuCommandId(baseCommand, locale) {
  if (locale === "en") {
    return baseCommand;
  }
  const prefix = "agentResume.";
  if (!baseCommand.startsWith(prefix)) {
    return baseCommand;
  }
  return `${prefix}${locale}.${baseCommand.slice(prefix.length)}`;
}

export function localizedSubmenuId(baseId, locale) {
  if (locale === "en") {
    return baseId;
  }
  return `${baseId}.${locale}`;
}

export function localeWhenClause(locale) {
  return locale === "en" ? `${UI_LOCALE_CONTEXT} == en` : `${UI_LOCALE_CONTEXT} == '${locale}'`;
}

export function withLocaleWhen(baseWhen, locale) {
  return `${baseWhen} && ${localeWhenClause(locale)}`;
}

export function expandMenuEntriesForLocales(entries) {
  const output = [];
  for (const locale of UI_LOCALES) {
    for (const entry of entries) {
      const expanded = { ...entry };
      expanded.when = withLocaleWhen(entry.when, locale);
      if (entry.command) {
        expanded.command = localizedMenuCommandId(entry.command, locale);
      }
      if (entry.submenu) {
        expanded.submenu = localizedSubmenuId(entry.submenu, locale);
      }
      output.push(expanded);
    }
  }
  return output;
}

export function loadAllLocaleCatalogs(root = repoRoot) {
  const catalogs = {};
  for (const locale of UI_LOCALES) {
    const filePath = join(root, "locales", `${locale}.json`);
    if (!existsSync(filePath)) {
      continue;
    }
    catalogs[locale] = JSON.parse(readFileSync(filePath, "utf8"));
  }
  return catalogs;
}

export function titleForKey(catalogs, locale, key, fallback = key) {
  return catalogs[locale]?.[key] ?? catalogs.en?.[key] ?? fallback;
}

export function buildLocalizedContextMenuCommands(catalogs) {
  const commands = [];
  const seen = new Set();

  for (const spec of CONTEXT_MENU_COMMAND_SPECS) {
    for (const locale of UI_LOCALES) {
      const command = localizedMenuCommandId(spec.base, locale);
      if (seen.has(command)) {
        continue;
      }
      seen.add(command);
      const entry = {
        command,
        title: titleForKey(catalogs, locale, spec.key),
        category: "Agent Resume"
      };
      if (spec.icon) {
        entry.icon = spec.icon;
      }
      commands.push(entry);
    }
  }

  return commands;
}

export function buildLocalizedContextSubmenus(catalogs) {
  const submenus = [];
  for (const spec of CONTEXT_SUBMENU_SPECS) {
    for (const locale of UI_LOCALES) {
      submenus.push({
        id: localizedSubmenuId(spec.base, locale),
        label: titleForKey(catalogs, locale, spec.key)
      });
    }
  }
  return submenus;
}