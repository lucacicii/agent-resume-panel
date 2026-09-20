#!/usr/bin/env node

import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { overridesByLocale } from "./desktop-settings-i18n-overrides.mjs";

const root = join(import.meta.dirname, "..");
const catalogPath = join(root, "scripts", "desktop-i18n-catalog.json");
const aliasesPath = join(root, "scripts", "desktop-settings-i18n-aliases.json");
const extensionLocalesDir = join(root, "apps", "extension", "locales");
const desktopLocalesDir = join(root, "apps", "desktop", "locales");
const settingsOverlayLocales = new Set(["ja"]);
const obsoleteDesktopKeys = new Set([
  "desktop.agent.toolCategory.projects",
  // Agent chat backend (core agent/{agentChat,agentStore,toolLoop,prompts,noteAudit}) removed;
  // these keys had no remaining renderer/main consumer.
  "desktop.agent.fetchingTools",
  "desktop.agent.newThread",
  "desktop.agent.persistFailed",
  "desktop.agent.requestingLlm",
  "desktop.agent.requestingLlmRound",
  "desktop.agent.toolsMaxIterations",
  "desktop.agent.toolsNoResponse",
  "desktop.agent.toolsOffTitle",
  "desktop.agent.toolsOn",
  "desktop.agent.toolsReady",
  "desktop.agent.toolsToggle",
  "desktop.notes.projectLabel",
  "desktop.notes.targetLibrary",
  "desktop.settings.projectMenu.note",
  "desktop.settings.projectMenu.noteDesc",
  "desktop.settings.visualTheme",
  "desktop.settings.visualThemeDesc",
  "desktop.settings.visualThemeClassic",
  "desktop.settings.visualThemeClassicDesc",
  "desktop.settings.visualThemeCyberpunk",
  "desktop.settings.visualThemeCyberpunkDesc",
  "desktop.settings.visualThemeDos",
  "desktop.settings.visualThemeDosDesc",
  "desktop.settings.themeDarkOnly",
  "desktop.settings.themeEffects",
  "desktop.settings.themeEffectsDesc",
  "desktop.settings.themeEffectsFull",
  "desktop.settings.themeEffectsReduced",
  "desktop.settings.dosStyle",
  "desktop.settings.dosStyleDesc",
  "desktop.settings.dosStyleAmber",
  "desktop.settings.dosStyleGreen",
  "desktop.workbench.terminalScrollPosition",
  "desktop.workbench.sidePanelBack",
  // Quick Access project picker: the workbench switches tasks, not projects.
  "desktop.workbench.quickAccessSwitchProject",
  // Session "move to project" replaced by "move to task".
  "desktop.workbench.moveToProject",
  "desktop.workbench.moveToProjectTitle",
  "desktop.workbench.moveToProjectHint",
  "desktop.workbench.moveToProjectRunning",
  "desktop.workbench.moveToProjectDone",
  "desktop.workbench.moveToProjectNoTargets",
  "desktop.workbench.renameSession",
  "desktop.workbench.renameSessionTitle",
  "desktop.workbench.generatingTitle",
  "desktop.workbench.titleSuggested",
  "desktop.workbench.titleEmpty",
  "desktop.im.emptyRoomNoFolder",
  // Settings → Models replaced by Settings → Providers (provider pool)
  "desktop.settings.paneModels",
  "desktop.settings.paneModelsDesc",
  "desktop.settings.toolLlm",
  "desktop.settings.toolLlmFootnote",
  "desktop.settings.chatLlm",
  "desktop.settings.chatModel",
  "desktop.settings.chatModelFootnote",
  "desktop.settings.embedding",
  "desktop.settings.embeddingFootnote",
  "desktop.settings.model",
  "desktop.settings.baseUrlOptional",
  "desktop.settings.apiKeyOptional",
  "desktop.settings.testConnectionHint",
  // Persisted session delivery state removed; live session status now comes from the agent-status daemon.
  "desktop.report.insightsCompleted",
  "desktop.report.insightsActive",
  "desktop.report.insightsBlocked",
  "desktop.report.insightsBlockedList",
  "desktop.report.insightsFilterStatus",
  "desktop.sessions.statusLabel",
  "desktop.sessions.statusUpdated",
  // Archive tab removed; digests stay on the scheduler + MCP.
  "desktop.tabs.report",
  "desktop.im.openInReport",
  "desktop.archive.decision",
  "desktop.archive.historyEmpty",
  "desktop.archive.lastExitWaiting",
  "desktop.archive.loadEarlier",
  "desktop.archive.needsMe",
  "desktop.archive.nextAction",
  "desktop.archive.noWorkItemSelected",
  "desktop.archive.openRoom",
  "desktop.archive.projects",
  "desktop.archive.reportMentioned",
  "desktop.archive.reportsTitle",
  "desktop.archive.search",
  "desktop.archive.searchPlaceholder",
  "desktop.archive.sessionsAllTime",
  "desktop.archive.unassignedEmpty",
  "desktop.archive.unassignedHint",
  "desktop.archive.workItemsCount",
  "desktop.archive.workItemsEmpty",
  "desktop.archive.workItemsTitle",
  // Settings → Report pane removed; scheduler uses code defaults.
  "desktop.settings.paneReport",
  "desktop.settings.paneReportDesc",
  "desktop.settings.enableSchedule",
  "desktop.settings.enableScheduleDesc",
  "desktop.settings.scheduledDigests",
  "desktop.settings.scheduleRuntimeNote",
  "desktop.settings.scheduleLastRunTitle",
  "desktop.settings.scheduleLastRunNone",
  "desktop.settings.scheduleLastRunOk",
  "desktop.settings.scheduleLastRunRunning",
  "desktop.settings.scheduleLastRunError",
  "desktop.settings.scheduleRefreshStatus",
  "desktop.settings.scheduleViewLog",
  "desktop.settings.schedulerOn",
  "desktop.settings.schedulerOff",
  "desktop.settings.dailyHour",
  "desktop.settings.weeklyHour",
  "desktop.settings.monthlyHour",
  "desktop.settings.maxDigestLlmCalls",
  "desktop.settings.maxDigestLlmCallsDesc",
  "desktop.settings.maxSessionsPerDigest",
  "desktop.settings.maxSessionsPerDigestDesc",
  "desktop.settings.memoryEnableConfirm",
  "desktop.settings.backfillTitle",
  "desktop.settings.backfillCallout",
  "desktop.settings.backfillMaxDays",
  "desktop.settings.backfillSkipExisting",
  "desktop.settings.backfillSkipEmbedding",
  "desktop.settings.backfillPreview",
  "desktop.settings.backfillRun",
  "desktop.backfill.cancelled",
  "desktop.backfill.confirm",
  "desktop.backfill.dateRange",
  "desktop.backfill.noActivity",
  "desktop.backfill.preview",
  "desktop.backfill.previewRange",
  "desktop.backfill.running",
  "desktop.backfill.scanning",
  "desktop.backfill.scanningShort",
  "desktop.backfill.stats",
  // Sessions reference sheet retired: Archive is the session browser now.
  "desktop.sessions.sheetTitle",
  "desktop.sessions.refreshList",
  "desktop.sessions.previewHint",
  "desktop.sessions.meta",
  "desktop.sessions.lastSynced",
  // Flow DAG: removed desktop tab, inspector copy, and Ask tool category
  "desktop.tabs.flow",
  "desktop.agent.toolCategory.flow",
  "desktop.flow.addNode",
  "desktop.flow.created",
  "desktop.flow.currentRun",
  "desktop.flow.defaultName",
  "desktop.flow.deleteConfirm",
  "desktop.flow.empty",
  "desktop.flow.emptyHint",
  "desktop.flow.emptyTitle",
  "desktop.flow.inspector",
  "desktop.flow.namePrompt",
  "desktop.flow.native",
  "desktop.flow.nativePermissionHint",
  "desktop.flow.nativeSession",
  "desktop.flow.nativeSessionRequired",
  "desktop.flow.newFlow",
  "desktop.flow.newNode",
  "desktop.flow.newYolo",
  "desktop.flow.nodeInspector",
  "desktop.flow.nodeRunning",
  "desktop.flow.nodeTitle",
  "desktop.flow.project",
  "desktop.flow.projectPathRequired",
  "desktop.flow.provider",
  "desktop.flow.removeNode",
  "desktop.flow.retryNode",
  "desktop.flow.run",
  "desktop.flow.runCompleted",
  "desktop.flow.runStopped",
  "desktop.flow.saveTemplate",
  "desktop.flow.saved",
  "desktop.flow.selectNodeHint",
  "desktop.flow.selectSession",
  "desktop.flow.sessionMode",
  "desktop.flow.sessionStartFailed",
  "desktop.flow.setStatus",
  "desktop.flow.skipNode",
  "desktop.flow.stop",
  "desktop.flow.templateNamePrompt",
  "desktop.flow.templateSaved",
  "desktop.flow.templates",
  "desktop.flow.title",
  "desktop.flow.viewNote",
  "desktop.flow.viewSession",
  "desktop.flow.workflows",
  "desktop.flow.yoloHint",
  // Auto tagging feature removed
  "desktop.agent.toolCategory.tags",
  "desktop.notes.entityTags",
  "desktop.notes.filterTags",
  "desktop.notes.noEntityTags",
  "desktop.notes.noTags",
  "desktop.notes.retagEntity",
  "desktop.notes.showObsoleteTags",
  "desktop.notes.tagCount",
  "desktop.notes.tagsView",
  "desktop.report.insightsFilterTag",
  "desktop.report.insightsNoTags",
  "desktop.report.insightsTags",
  "desktop.settings.autoTagConsensusFactor",
  "desktop.settings.autoTagConsensusFactorHint",
  "desktop.settings.autoTagHalfLifeDays",
  "desktop.settings.autoTagHalfLifeDaysHint",
  "desktop.settings.autoTagHitBoost",
  "desktop.settings.autoTagHitBoostHint",
  "desktop.settings.autoTagMaxTagsPerItem",
  "desktop.settings.autoTagMaxTagsPerItemHint",
  "desktop.settings.autoTagPruneThreshold",
  "desktop.settings.autoTagPruneThresholdHint",
  "desktop.settings.autoTagging",
  "desktop.settings.autoTaggingEnabled",
  "desktop.settings.autoTaggingEnabledDesc",
  "desktop.tagging.category.architecture",
  "desktop.tagging.category.business_domain",
  "desktop.tagging.category.concept_knowledge",
  "desktop.tagging.category.context_env",
  "desktop.tagging.category.problem_domain",
  "desktop.tagging.category.task_type",
  "desktop.tagging.category.tech_stack",
  "desktop.tagging.consensusBadge",
  "desktop.tagging.emptyEntity",
  "desktop.tagging.retag",
  "desktop.tagging.status.active",
  "desktop.tagging.status.obsolete",
  "desktop.workbench.allTagCategories",
  "desktop.workbench.entityTags",
  "desktop.workbench.filterTags",
  "desktop.workbench.noTags",
  "desktop.workbench.showObsoleteTags",
  "desktop.workbench.tagCount",
  "desktop.workbench.tagSessionsMeta",
  "desktop.workbench.tagsView",
  // Retired command palette dead view/session navigation keys
  "desktop.workbench.quickAccessShowReport",
  "desktop.workbench.quickAccessShowAgent",
  "desktop.workbench.quickAccessOpenSessions",
  // IM module removed: task rooms, role templates, delegation, knowledge, and the
  // room/discussion-room Workbench chrome are gone. Selection actions moved to
  // Settings → Selection and are dropped by prefix below.
  "desktop.workbench.openRoom",
  "desktop.workbench.closeRoom",
  "desktop.workbench.imSessionBadge",
  "desktop.workbench.imSessionBadgeHint",
  "desktop.settings.paneIm",
  "desktop.settings.paneImDesc",
  "desktop.settings.selectionActionKind",
  "desktop.settings.selectionActionKindContext",
  "desktop.settings.selectionActionKindIndependent",
  // Settings panes auto-save now; the manual Save/Discard buttons and the
  // unsaved-changes confirmation banner were removed.
  "desktop.settings.save",
  "desktop.settings.discard",
  "desktop.settings.cancel",
  "desktop.settings.saveAndContinue",
  "desktop.settings.discardAndContinue",
  "desktop.settings.unsavedHint",
  "desktop.settings.unsavedConfirm",
  // Project context menu removed: projects are no longer a browsable list and
  // nothing opens a project menu (the workbench groups sessions under tasks).
  "desktop.settings.projectContextMenuGroup",
  "desktop.settings.projectContextMenuDesc",
  "desktop.settings.projectContextMenuEmpty",
  "desktop.settings.projectMenu.pin",
  "desktop.settings.projectMenu.pinDesc",
  "desktop.settings.projectMenu.newSession",
  "desktop.settings.projectMenu.newSessionDesc",
  "desktop.settings.projectMenu.editor",
  "desktop.settings.projectMenu.editorDesc",
  "desktop.settings.projectMenu.rename",
  "desktop.settings.projectMenu.renameDesc",
  "desktop.settings.projectMenu.setLocalPath",
  "desktop.settings.projectMenu.setLocalPathDesc",
  "desktop.settings.projectMenu.copyPath",
  "desktop.settings.projectMenu.copyPathDesc",
  "desktop.settings.projectMenu.reveal",
  "desktop.settings.projectMenu.revealDesc",
  "desktop.settings.projectMenu.merge",
  "desktop.settings.projectMenu.mergeDesc",
  "desktop.settings.projectMenu.split",
  "desktop.settings.projectMenu.splitDesc",
  "desktop.settings.projectMenu.remove",
  "desktop.settings.projectMenu.removeDesc",
  "desktop.workbench.pinProject",
  "desktop.workbench.unpinProject",
  "desktop.workbench.openInApp",
  "desktop.workbench.renameProject",
  "desktop.workbench.renameProjectDisplay",
  "desktop.workbench.nameEmpty",
  "desktop.workbench.setLocalFolder",
  "desktop.workbench.setLocalFolderTitle",
  "desktop.workbench.localPathSet",
  "desktop.workbench.copyLocalPath",
  "desktop.workbench.pathCopied",
  "desktop.workbench.mergeIntoProject",
  "desktop.workbench.mergeNoTargets",
  "desktop.workbench.mergeDialogTitle",
  "desktop.workbench.mergeDialogHint",
  "desktop.workbench.mergeRunning",
  "desktop.workbench.mergeDone",
  "desktop.workbench.splitProjectPath",
  "desktop.workbench.splitNeedVariants",
  "desktop.workbench.splitDialogTitle",
  "desktop.workbench.splitDialogHint",
  "desktop.workbench.splitRunning",
  "desktop.workbench.splitDone",
  "desktop.workbench.removeProjectFromPanel",
]);

/** Keys retired with the IM module (rooms, roles, delegation) or renamed out of `desktop.im.`. */
function isObsoleteDesktopKey(key) {
  if (obsoleteDesktopKeys.has(key)) return true;
  if (key.startsWith("desktop.im.")) return true;
  // `desktop.settings.imAction*` / `imDelegation*` / `imRoutingModelUse*` etc.,
  // but never the unrelated `desktop.settings.image*` keys.
  if (/^desktop\.settings\.im(?!age)/.test(key)) return true;
  // Link Graph feature removed (Workbench panel + MCP tool).
  if (key.startsWith("desktop.workbench.linkGraph")) return true;
  if (key === "desktop.workbench.sidePanelLinkGraph" || key === "desktop.workbench.quickAccessShowLinkGraph") return true;
  if (key === "desktop.agent.toolCategory.link_graph") return true;
  return false;
}

function normalizePlaceholders(value) {
  const names = [];
  const normalized = value.replace(/\{\{(\w+)\}\}/g, (_match, name) => {
    if (!names.includes(name)) {
      names.push(name);
    }
    return `{${names.indexOf(name)}}`;
  });
  return normalized;
}

function flattenCatalog(node, out = {}) {
  if (typeof node === "string") {
    return out;
  }
  for (const [key, value] of Object.entries(node)) {
    if (typeof value === "string") {
      out[key] = normalizePlaceholders(value);
    } else if (value && typeof value === "object") {
      flattenCatalog(value, out);
    }
  }
  return out;
}

function writeLocale(filePath, locale) {
  const desktopOnly = Object.fromEntries(
    Object.entries(locale)
      .filter(([key]) => key.startsWith("desktop."))
      .sort(([a], [b]) => a.localeCompare(b))
  );
  writeFileSync(filePath, `${JSON.stringify(desktopOnly)}\n`);
}

const catalog = JSON.parse(readFileSync(catalogPath, "utf8"));
const enKeys = flattenCatalog(catalog.en ?? catalog);
const zhKeys = catalog["zh-cn"] ? flattenCatalog(catalog["zh-cn"]) : {};
const jaKeys = catalog.ja ? flattenCatalog(catalog.ja) : {};
const catalogSources = { en: enKeys, "zh-cn": zhKeys, ja: jaKeys };
const settingsAliases = JSON.parse(readFileSync(aliasesPath, "utf8"));
const settingsOverrides = overridesByLocale();

function loadExtensionLocale(localeCode) {
  const localePath = join(extensionLocalesDir, `${localeCode}.json`);
  if (!existsSync(localePath)) {
    return {};
  }
  return JSON.parse(readFileSync(localePath, "utf8"));
}

function applyDesktopSettingsOverlay(localeCode, locale) {
  const extensionLocale = loadExtensionLocale(localeCode);
  let applied = 0;
  const overrides = settingsOverrides[localeCode] ?? {};
  const settingsKeys = new Set([
    ...Object.keys(locale).filter((key) => key.startsWith("desktop.settings.")),
    ...Object.keys(overrides).filter((key) => key.startsWith("desktop.settings."))
  ]);
  for (const desktopKey of settingsKeys) {
    if (overrides[desktopKey]) {
      locale[desktopKey] = overrides[desktopKey];
      applied += 1;
      continue;
    }
    const aliasKey = settingsAliases[desktopKey];
    if (aliasKey && typeof extensionLocale[aliasKey] === "string") {
      locale[desktopKey] = extensionLocale[aliasKey];
      applied += 1;
    }
  }
  for (const [key, value] of Object.entries(overrides)) {
    if (!key.startsWith("desktop.tabs.") && !key.startsWith("desktop.workbench.")) continue;
    locale[key] = value;
    applied += 1;
  }
  if (settingsOverlayLocales.has(localeCode)) {
    return applied;
  }
  return applied;
}

mkdirSync(desktopLocalesDir, { recursive: true });

for (const file of readdirSync(desktopLocalesDir).filter((name) => name.endsWith(".json"))) {
  const localeCode = file.replace(/\.json$/, "");
  const localePath = join(desktopLocalesDir, file);
  const locale = existsSync(localePath) ? JSON.parse(readFileSync(localePath, "utf8")) : {};
  const localizedSource =
    localeCode === "zh-cn" && Object.keys(zhKeys).length
      ? zhKeys
      : localeCode === "ja" && Object.keys(jaKeys).length
        ? jaKeys
        : enKeys;
  // Keep every generated locale structurally complete when a localized catalog
  // lags behind English; untranslated entries intentionally fall back to en.
  const source = localeCode === "en" ? enKeys : { ...enKeys, ...localizedSource };
  for (const key of Object.keys(locale)) {
    if (isObsoleteDesktopKey(key)) delete locale[key];
  }
  for (const [key, value] of Object.entries(source)) {
    if (!key.startsWith("desktop.")) continue;
    locale[key] = value;
  }
  const overlayCount = applyDesktopSettingsOverlay(localeCode, locale);
  for (const key of Object.keys(locale)) {
    if (isObsoleteDesktopKey(key)) delete locale[key];
  }
  if (localeCode !== "en") {
    const englishLocale = JSON.parse(readFileSync(join(desktopLocalesDir, "en.json"), "utf8"));
    for (const [key, value] of Object.entries(englishLocale)) {
      if (!(key in locale)) locale[key] = value;
    }
    for (const key of Object.keys(locale)) {
      if (!(key in englishLocale)) delete locale[key];
    }
  }
  writeLocale(localePath, locale);
  const overlayNote = overlayCount ? ` (+${overlayCount} settings i18n)` : "";
  console.log(`merged ${Object.keys(source).length} desktop keys into apps/desktop/locales/${file}${overlayNote}`);
}

const desktopDistLocales = join(root, "apps", "desktop", "dist", "locales");
if (existsSync(desktopLocalesDir)) {
  mkdirSync(desktopDistLocales, { recursive: true });
  let copied = 0;
  for (const name of readdirSync(desktopLocalesDir)) {
    if (!name.endsWith(".json")) continue;
    copyFileSync(join(desktopLocalesDir, name), join(desktopDistLocales, name));
    copied += 1;
  }
  console.log(`copied ${copied} locale files → apps/desktop/dist/locales`);
}
