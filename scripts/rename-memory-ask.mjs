#!/usr/bin/env node
/**
 * One-shot codemod: Memory/Ask → Report/Agent across the monorepo.
 * Run from repo root: node scripts/rename-memory-ask.mjs
 */
import { readFileSync, writeFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

const root = join(import.meta.dirname, "..");

const SKIP_DIRS = new Set([
  "node_modules",
  "dist",
  "out",
  ".git",
  "agent-resume-desktop-doc",
  "agent-resume-panel-doc"
]);

const EXT = new Set([".ts", ".js", ".mjs", ".json", ".html", ".css", ".md"]);

/** Longest-first replacements to avoid partial overlaps. */
const REPLACEMENTS = [
  // i18n special keys (before prefix swaps)
  ["desktop.settings.paneMemoryDesc", "desktop.settings.paneReportDesc"],
  ["desktop.settings.paneMemory", "desktop.settings.paneReport"],
  ["desktop.tabs.memory", "desktop.tabs.report"],
  ["desktop.tabs.ask", "desktop.tabs.agent"],
  ["desktop.ask.openInMemory", "desktop.agent.openInReport"],
  ["desktop.ask.searchingMemory", "desktop.agent.searchingReports"],
  ["desktop.ask.memoryRetrieval", "desktop.agent.reportRetrieval"],
  ["desktop.ask.citationMemory", "desktop.agent.citationReports"],
  ["desktop.memory.", "desktop.report."],
  ["desktop.ask.", "desktop.agent."],

  // File/import paths
  ["./workflow/runMemoryGtdSync", "./workflow/runReportGtdSync"],
  ["../workflow/runMemoryGtdSync", "../workflow/runReportGtdSync"],
  ["./mcp/memoryTools", "./mcp/reportTools"],
  ["../mcp/memoryTools", "../mcp/reportTools"],
  ["./agent/askStore", "./agent/agentStore"],
  ["../agent/askStore", "../agent/agentStore"],
  ["./agent/ask", "./agent/agentChat"],
  ["../agent/ask", "../agent/agentChat"],
  ["./memory/", "./report/"],
  ["../memory/", "../report/"],
  ["from \"./memory/", "from \"./report/"],
  ["from '../memory/", "from '../report/"],

  // Workflow / GTD types
  ["RunMemoryGtdSyncOptions", "RunReportGtdSyncOptions"],
  ["RunMemoryGtdSyncResult", "RunReportGtdSyncResult"],
  ["PreviewMemoryGtdSyncResult", "PreviewReportGtdSyncResult"],
  ["ApplyMemoryGtdSyncOptions", "ApplyReportGtdSyncOptions"],
  ["ApplyMemoryGtdSyncResult", "ApplyReportGtdSyncResult"],
  ["previewBackfillMemoryDigests", "previewBackfillReportDigests"],
  ["BackfillMemoryDigestsOptions", "BackfillReportDigestsOptions"],
  ["BackfillMemoryDigestsResult", "BackfillReportDigestsResult"],
  ["backfillMemoryDigests", "backfillReportDigests"],
  ["runMemoryGtdSync", "runReportGtdSync"],
  ["previewMemoryGtdSync", "previewReportGtdSync"],
  ["applyMemoryGtdSync", "applyReportGtdSync"],
  ["analyzeMemoryForGtd", "analyzeReportForGtd"],

  // MCP
  ["handleMemorySearch", "handleReportSearch"],
  ["handleMemoryRead", "handleReportRead"],
  ["handleMemoryList", "handleReportList"],
  ["memorySearchSchema", "reportSearchSchema"],
  ["memoryReadSchema", "reportReadSchema"],
  ["memoryListSchema", "reportListSchema"],
  ["MEMORY_SEARCH_DEFAULT_LIMIT", "REPORT_SEARCH_DEFAULT_LIMIT"],
  ["MEMORY_SEARCH_MAX_LIMIT", "REPORT_SEARCH_MAX_LIMIT"],
  ["MEMORY_LIST_DEFAULT_LIMIT", "REPORT_LIST_DEFAULT_LIMIT"],
  ["MEMORY_LIST_MAX_LIMIT", "REPORT_LIST_MAX_LIMIT"],
  ["MEMORY_READ_DEFAULT_MAX_LENGTH", "REPORT_READ_DEFAULT_MAX_LENGTH"],
  ["MEMORY_READ_MAX_LENGTH", "REPORT_READ_MAX_LENGTH"],
  ["MemoryToolContext", "ReportToolContext"],
  ["memory_search", "report_search"],
  ["memory_read", "report_read"],
  ["memory_list", "report_list"],

  // Report store / search
  ["searchMemoryByEmbedding", "searchReportsByEmbedding"],
  ["SearchMemoryOptions", "SearchReportsOptions"],
  ["MemorySearchHit", "ReportSearchHit"],
  ["insertMemoryEntry", "insertReportEntry"],
  ["getMemoryEntryById", "getReportEntryById"],
  ["listMemoryEntriesInRange", "listReportEntriesInRange"],
  ["listMemoryEntries", "listReportEntries"],
  ["listMemoryLinks", "listReportLinks"],
  ["MemoryLinkRow", "ReportLinkRow"],
  ["upsertMemoryJob", "upsertReportJob"],
  ["getMemoryJobStatus", "getReportJobStatus"],
  ["summarizeMemoryListEntry", "summarizeReportListEntry"],
  ["clampMemorySearchLimit", "clampReportSearchLimit"],
  ["clampMemoryListLimit", "clampReportListLimit"],
  ["clampMemoryReadMaxLength", "clampReportReadMaxLength"],
  ["MEMORY_SCHEMA_SQL", "REPORT_SCHEMA_SQL"],
  ["MEMORY_MIGRATION_SQL", "REPORT_MIGRATION_SQL"],
  ["runMemoryMigrations", "runReportMigrations"],
  ["MemorySettings", "ReportSettings"],
  ["MemoryLevel", "ReportLevel"],
  ["MemoryEntry", "ReportEntry"],
  ["MemoryLink", "ReportLink"],

  // Agent chat
  ["AskMetaAgentOptions", "AgentChatOptions"],
  ["AskMetaAgentResult", "AgentChatResult"],
  ["AskStreamEvent", "AgentStreamEvent"],
  ["AskStreamPhase", "AgentStreamPhase"],
  ["askMetaAgent", "runAgentChat"],
  ["appendAskTurn", "appendAgentTurn"],
  ["clearAskMessages", "clearAgentMessages"],
  ["listAskMessagesForHistory", "listAgentMessagesForHistory"],
  ["listOlderAskMessages", "listOlderAgentMessages"],
  ["listRecentAskMessages", "listRecentAgentMessages"],
  ["listAskMessages", "listAgentMessages"],
  ["listAskThreads", "listAgentThreads"],
  ["createAskThread", "createAgentThread"],
  ["renameAskThread", "renameAgentThread"],
  ["deleteAskThread", "deleteAgentThread"],
  ["AskChatListResult", "AgentChatListResult"],
  ["AskChatMessage", "AgentChatMessage"],
  ["AskThread", "AgentThread"],
  ["insertAskNoteAudit", "insertAgentNoteAudit"],
  ["listAskNoteAudit", "listAgentNoteAudit"],
  ["updateAskNoteAuditStatus", "updateAgentNoteAuditStatus"],
  ["AskNoteAuditEvent", "AgentNoteAuditEvent"],
  ["AskNoteAuditStatus", "AgentNoteAuditStatus"],
  ["askMessageId", "agentMessageId"],

  // IPC
  ["memory:digestProgress", "report:digestProgress"],
  ["memory:needsMonthlyRefresh", "report:needsMonthlyRefresh"],
  ["memory:needsWeeklyRefresh", "report:needsWeeklyRefresh"],
  ["memory:needsDailyRefresh", "report:needsDailyRefresh"],
  ["memory:listDaily", "report:listDaily"],
  ["memory:getEntry", "report:getEntry"],
  ["memory:runDaily", "report:runDaily"],
  ["memory:runWeekly", "report:runWeekly"],
  ["memory:runMonthly", "report:runMonthly"],
  ["memory:search", "report:search"],
  ["memory:list", "report:list"],

  // Preload API
  ["onMemoryDigestProgress", "onReportDigestProgress"],
  ["getMemoryEntry", "getReportEntry"],
  ["searchMemory", "searchReports"],
  ["listMemory", "listReports"],

  // SQL tables / columns
  ["source_memory_ids", "source_report_ids"],
  ["idx_ask_note_audit_note", "idx_agent_note_audit_note"],
  ["idx_ask_note_audit_trace", "idx_agent_note_audit_trace"],
  ["idx_ask_note_audit_created", "idx_agent_note_audit_created"],
  ["ask_note_audit", "agent_note_audit"],
  ["ask_message_id", "agent_message_id"],
  ["idx_ask_messages_order", "idx_agent_messages_order"],
  ["idx_ask_messages_thread", "idx_agent_messages_thread"],
  ["idx_ask_threads_updated", "idx_agent_threads_updated"],
  ["ask_messages", "agent_messages"],
  ["ask_threads", "agent_threads"],
  ["idx_memory_entries_level", "idx_report_entries_level"],
  ["idx_memory_links_session", "idx_report_links_session"],
  ["idx_memory_links_memory", "idx_report_links_report"],
  ["memory_entries", "report_entries"],
  ["memory_links", "report_links"],
  ["memory_jobs", "report_jobs"],
  ["memory_id", "report_id"],

  // UI identifiers
  ["data-settings-pane=\"memory\"", "data-settings-pane=\"report\""],
  ["settingsPaneMemory", "settingsPaneReport"],
  ["btnRefreshMemory", "btnRefreshReport"],
  ["memoryStatus", "reportStatus"],
  ["tab-memory", "tab-report"],
  ["tab-ask", "tab-agent"],
  ['data-tab="memory"', 'data-tab="report"'],
  ['data-tab="ask"', 'data-tab="agent"'],
  ["memory-toolbar", "report-toolbar"],
  ["memory-layout", "report-layout"],
  ["memory-cal-pane", "report-cal-pane"],
  ["memory-session-pane", "report-session-pane"],
  ["memory-detail-pane", "report-detail-pane"],
  ["memory-detail-head", "report-detail-head"],
  ["memory-detail-back", "report-detail-back"],
  ["ask-sidebar-pane", "agent-sidebar-pane"],
  ["ask-sidebar-list", "agent-sidebar-list"],
  ["ask-layout", "agent-layout"],
  ["ask-panel", "agent-panel"],
  ["ask-index-progress-bar", "agent-index-progress-bar"],
  ["ask-index-progress", "agent-index-progress"],
  ["ask-audit-panel", "agent-audit-panel"],
  ["ask-audit-list", "agent-audit-list"],
  ["ask-audit-empty", "agent-audit-empty"],
  ["ask-audit-action", "agent-audit-action"],
  ["ask-audit-status", "agent-audit-status"],
  ["askRenameDialog", "agentRenameDialog"],
  ["askRenameTitle", "agentRenameTitle"],
  ["askRenameInput", "agentRenameInput"],
  ["askChatTitle", "agentChatTitle"],
  ["askIndexProgressText", "agentIndexProgressText"],
  ["askIndexProgressCount", "agentIndexProgressCount"],
  ["askIndexProgressBar", "agentIndexProgressBar"],
  ["askIndexProgress", "agentIndexProgress"],
  ["askAuditPanel", "agentAuditPanel"],
  ["askAuditList", "agentAuditList"],
  ["askSidebarPane", "agentSidebarPane"],
  ["askSidebarList", "agentSidebarList"],
  ["btnAskRenameConfirm", "btnAgentRenameConfirm"],
  ["btnAskAuditRefresh", "btnAgentAuditRefresh"],
  ["btnAskToggleSidebar", "btnAgentToggleSidebar"],
  ["btnAskRenameChat", "btnAgentRenameChat"],
  ["btnAskAudit", "btnAgentAudit"],
  ["btnAskNewChat", "btnAgentNewChat"],
  ["askChatLoadedFromDb", "agentChatLoadedFromDb"],
  ["askChatRendered", "agentChatRendered"],
  ["askChatHasMoreOlder", "agentChatHasMoreOlder"],
  ["askChatLoadingOlder", "agentChatLoadingOlder"],
  ["askChatOldestSortOrder", "agentChatOldestSortOrder"],
  ["askChatLoadPromise", "agentChatLoadPromise"],
  ["askThreads", "agentThreads"],
  ["activeAskThreadId", "activeAgentThreadId"],
  ["askIndexProgressHideTimer", "agentIndexProgressHideTimer"],
  ["askAuditLoaded", "agentAuditLoaded"],
  ["askAuditLoading", "agentAuditLoading"],
  ["askEnableTools", "agentEnableTools"],
  ["askAuditStatusLabel", "agentAuditStatusLabel"],
  ["askAuditActionLabel", "agentAuditActionLabel"],
  ["updateAskChatTitleHeader", "updateAgentChatTitleHeader"],
  ["renderAskThreadsSidebar", "renderAgentThreadsSidebar"],
  ["loadAskThreads", "loadAgentThreads"],
  ["openAskRenameDialog", "openAgentRenameDialog"],
  ["deleteAskThread", "deleteAgentThread"],
  ["switchTab(\"memory\")", 'switchTab("report")'],
  ['activePrimaryTab === "memory"', 'activePrimaryTab === "report"'],
  ['activePrimaryTab = "memory"', 'activePrimaryTab = "report"'],
  ['name === "ask"', 'name === "agent"'],
  ['name !== "ask"', 'name !== "agent"'],
  ['activePrimaryTab === "ask"', 'activePrimaryTab === "agent"'],
  ['paneIds = ["general", "models", "sessions", "workbench", "memory", "storage", "usage"]', 'paneIds = ["general", "models", "sessions", "workbench", "report", "storage", "usage"]'],
  ["paneMemory", "paneReport"],
  ["paneMemoryDesc", "paneReportDesc"],

  // settings.json field
  ["settings.memory?", "settings.report?"],
  ["settings.memory.", "settings.report."],
  ["partial.memory", "partial.report"],
  ["raw.memory", "raw.report"],
  ["memory?: ReportSettings", "report?: ReportSettings"],
  ["memory?: MemorySettings", "report?: ReportSettings"],
  ["  memory:", "  report:"],

  // Citation / semantic
  ['source === "memory"', 'source === "report"'],
  ['source?: "memory"', 'source?: "report"'],
  ['"memory" | "note"', '"report" | "note"'],
  ["buildCitationSection(\"memory\"", 'buildCitationSection("report"'],
  ["memoryId", "reportId"],
  ["memoryCtx", "reportCtx"],

  // Prompts text
  ["Memory Sources", "Report Sources"],
  ["available memory and notes", "available reports and notes"],

  // Actor default
  ['actor || "ask"', 'actor || "agent"'],
  ['event.actor || "ask"', 'event.actor || "agent"'],

  // Menu doc
  ["memory-gtd.md", "report-gtd.md"],

  // Comments in HTML
  ["<!-- Memory home -->", "<!-- Report home -->"],
  ["<!-- Ask (merged Agent + semantic search) -->", "<!-- Agent chat -->"],
];

function walk(dir, out = []) {
  for (const name of readdirSync(dir)) {
    if (SKIP_DIRS.has(name)) continue;
    const full = join(dir, name);
    const st = statSync(full);
    if (st.isDirectory()) walk(full, out);
    else if (EXT.has(full.slice(full.lastIndexOf(".")))) out.push(full);
  }
  return out;
}

const targets = [
  join(root, "packages/core/src"),
  join(root, "packages/core/test"),
  join(root, "apps/desktop/src"),
  join(root, "src"),
  join(root, "locales"),
  join(root, "scripts"),
  join(root, ".agents"),
  join(root, "apps/desktop/README.md")
].flatMap((p) => {
  try {
    return statSync(p).isDirectory() ? walk(p) : [p];
  } catch {
    return [];
  }
});

let changed = 0;
for (const file of targets) {
  if (file.endsWith("rename-memory-ask.mjs")) continue;
  let text = readFileSync(file, "utf8");
  const before = text;
  for (const [from, to] of REPLACEMENTS) {
    text = text.split(from).join(to);
  }
  if (text !== before) {
    writeFileSync(file, text);
    changed++;
    console.log("updated", file.replace(root + "/", ""));
  }
}

console.log(`Done. ${changed} files updated.`);