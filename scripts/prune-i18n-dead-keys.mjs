#!/usr/bin/env node

import { readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { CONTEXT_MENU_COMMAND_SPECS, CONTEXT_SUBMENU_SPECS } from "../apps/extension/scripts/menu-i18n.mjs";

const root = join(import.meta.dirname, "..");
const extensionRoot = join(root, "apps/extension");
const desktopRoot = join(root, "apps/desktop");

const EXTENSION_DEAD = [
  "dialog.deleteProjectNoteConfirm",
  "dialog.deleteSessionNoteConfirm",
  "error.handoffAcpNoMessages",
  "error.handoffAcpNotSupported",
  "error.handoffNoMessages",
  "error.llmTestNotConfigured",
  "error.llmTestSuccess",
  "error.previewNotSupported",
  "handoff.truncationWarningDefault",
  "handoff.truncationWarningPreview",
  "menu.handoff.submenu",
  "menu.project.newNote",
  "menu.session.newNote",
  "settings.enum.llmOutputLanguageChinese",
  "settings.enum.llmOutputLanguageEnglish",
  "settings.enum.llmOutputLanguageFrench",
  "settings.enum.llmOutputLanguageGerman",
  "settings.enum.llmOutputLanguageItalian",
  "settings.enum.llmOutputLanguageJapanese",
  "settings.enum.llmOutputLanguageKorean",
  "settings.enum.llmOutputLanguagePortuguese",
  "settings.enum.llmOutputLanguageRussian",
  "settings.enum.llmOutputLanguageSpanish",
  "terminal.nameCodexApp",
  "terminal.nameHandoff",
  "terminal.providerLabelAntigravity",
  "tree.gtd.viewTitle"
];

const DESKTOP_DEAD = [
  "desktop.agent.auditFailedPrefix",
  "desktop.agent.auditIndexWithTitle",
  "desktop.agent.errorPrefix",
  "desktop.agent.fetchingTools",
  "desktop.agent.generatingAnswer",
  "desktop.agent.persistFailed",
  "desktop.agent.renameProjectDialog",
  "desktop.agent.requestingLlm",
  "desktop.agent.requestingLlmRound",
  "desktop.agent.sendFailedPrefix",
  "desktop.agent.stopped",
  "desktop.agent.toolsMaxIterations",
  "desktop.agent.toolsNoResponse",
  "desktop.agent.toolsReady",
  "desktop.agent.traceRefresh",
  "desktop.notes.findCount",
  "desktop.notes.generatingVectors",
  "desktop.notes.indexComplete",
  "desktop.notes.indexUpToDate",
  "desktop.notes.indexingProgress",
  "desktop.notes.metaCount",
  "desktop.notes.metaSearch",
  "desktop.notes.scanningNotes",
  "desktop.report.aggregateMonthlyFromDailies",
  "desktop.report.aggregateMonthlyPlaceholder",
  "desktop.report.aggregateWeeklyFromDailies",
  "desktop.report.aggregateWeeklyPlaceholder",
  "desktop.report.backfillDailyProgress",
  "desktop.report.backfillWeeklyProgress",
  "desktop.report.dailiesCompleteMonth",
  "desktop.report.dailiesCompletePeriod",
  "desktop.report.dailiesCompleteWeek",
  "desktop.report.dailyCompleteCount",
  "desktop.report.digestFailedShort",
  "desktop.report.ensureDailiesCheckMonth",
  "desktop.report.ensureDailiesCheckPeriod",
  "desktop.report.ensureDailiesCheckWeek",
  "desktop.report.ensureWeekliesCheck",
  "desktop.report.extractDailyFromSummary",
  "desktop.report.extractMonthlyFromDailies",
  "desktop.report.extractMonthlyPlaceholder",
  "desktop.report.extractWeeklyFromDailies",
  "desktop.report.extractWeeklyPlaceholder",
  "desktop.report.freshDailiesRefreshMonth",
  "desktop.report.freshDailiesRefreshPeriod",
  "desktop.report.freshDailiesRefreshWeek",
  "desktop.report.freshDailiesUpToDateMonth",
  "desktop.report.freshDailiesUpToDatePeriod",
  "desktop.report.freshDailiesUpToDateWeek",
  "desktop.report.freshDailiesUpdateProgress",
  "desktop.report.freshWeekliesRefreshMonth",
  "desktop.report.freshWeekliesUpToDateMonth",
  "desktop.report.freshWeekliesUpdateProgress",
  "desktop.report.generatingSessionSummary",
  "desktop.report.gtdFallbackSessions",
  "desktop.report.gtdJsonParseFailed",
  "desktop.report.gtdNoLinkedSessions",
  "desktop.report.markMissing",
  "desktop.report.markNone",
  "desktop.report.markStale",
  "desktop.report.monthlyCompleteStats",
  "desktop.report.nestedDailyDetail",
  "desktop.report.nestedDailyLabel",
  "desktop.report.nestedWeeklyDetail",
  "desktop.report.nestedWeeklyLabel",
  "desktop.report.periodMissing",
  "desktop.report.periodNoSessions",
  "desktop.report.periodUnderlyingBoth",
  "desktop.report.periodUnderlyingNewOnly",
  "desktop.report.periodUnderlyingStaleOnly",
  "desktop.report.periodUpToDate",
  "desktop.report.periodUpdatedSessions",
  "desktop.report.prepareSummarize",
  "desktop.report.refreshDailyMissing",
  "desktop.report.refreshDailyUpToDateCount",
  "desktop.report.refreshNewSessionsDaily",
  "desktop.report.refreshNoSessionsSkip",
  "desktop.report.refreshUpdatedSessionsDaily",
  "desktop.report.sessionsRangeLabel",
  "desktop.report.startDaily",
  "desktop.report.summaryDone",
  "desktop.report.taskBusyMonthly",
  "desktop.report.taskBusyWeekly",
  "desktop.report.weekliesCompleteMonth",
  "desktop.report.weeklyCompleteStats",
  "desktop.report.writeEmbedding",
  "desktop.sessions.autoRenameBtn",
  "desktop.sessions.gtdAnalyze",
  "desktop.sessions.renamingBtn",
  "desktop.sessions.summarizeBtn",
  "desktop.sessions.summarizingBtn",
  "desktop.sessions.summaryLabel",
  "desktop.workbench.editorNotFound",
  "desktop.workbench.editorNotFoundAuto",
  "desktop.workbench.metaCount",
  "desktop.workbench.metaSearch",
  "desktop.workbench.sidePanelNotRepo",
  "desktop.workbench.syncedSessions",
  "desktop.agent.cancelled",
  "desktop.agent.indexProgress",
  "desktop.common.delete",
  "desktop.common.done",
  "desktop.sessions.autoRename",
  "desktop.sessions.regenerate",
  "desktop.sessions.summarize"
];

function walk(dir, filter, files = []) {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      walk(full, filter, files);
    } else if (filter(full)) {
      files.push(full);
    }
  }
  return files;
}

function pruneLocaleDir(dir, deadKeys) {
  const dead = new Set(deadKeys);
  for (const file of readdirSync(dir).filter((name) => name.endsWith(".json"))) {
    const path = join(dir, file);
    const locale = JSON.parse(readFileSync(path, "utf8"));
    let removed = 0;
    for (const key of dead) {
      if (key in locale) {
        delete locale[key];
        removed += 1;
      }
    }
    const sorted = Object.fromEntries(Object.keys(locale).sort().map((key) => [key, locale[key]]));
    writeFileSync(path, `${JSON.stringify(sorted)}\n`);
    console.log(`pruned ${removed} keys from ${path}`);
  }
}

function pruneDesktopCatalog(node, deadKeys) {
  if (!node || typeof node !== "object") {
    return 0;
  }
  let removed = 0;
  if (Array.isArray(node)) {
    for (const item of node) {
      removed += pruneDesktopCatalog(item, deadKeys);
    }
    return removed;
  }
  for (const key of Object.keys(node)) {
    if (deadKeys.has(key)) {
      delete node[key];
      removed += 1;
      continue;
    }
    removed += pruneDesktopCatalog(node[key], deadKeys);
  }
  return removed;
}

pruneLocaleDir(join(extensionRoot, "locales"), EXTENSION_DEAD);
pruneLocaleDir(join(desktopRoot, "locales"), DESKTOP_DEAD);

const catalogPath = join(root, "scripts/desktop-i18n-catalog.json");
const catalog = JSON.parse(readFileSync(catalogPath, "utf8"));
const removedCatalog = pruneDesktopCatalog(catalog, new Set(DESKTOP_DEAD));
writeFileSync(catalogPath, `${JSON.stringify(catalog, null, 2)}\n`);
console.log(`pruned ${removedCatalog} entries from desktop-i18n-catalog.json`);