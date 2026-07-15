#!/usr/bin/env node
/**
 * Applies bulk i18n replacements to apps/desktop/src/renderer/app.js.
 * Run once; review diff before committing.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const root = join(import.meta.dirname, "..");
const appPath = join(root, "apps/desktop/src/renderer/app.js");
let src = readFileSync(appPath, "utf8");

if (!src.startsWith("/* global t,")) {
  src = src.replace(
    "/* global agentResume, marked, DOMPurify, hljs, NotesCodeMirror */",
    "/* global t, initI18n, applyDomI18n, setI18nBundle, getUiLocale, refreshLocalizedUi */\n/* global agentResume, marked, DOMPurify, hljs, NotesCodeMirror */"
  );
}

src = src.replace(
  "function formatTime(ms) {\n  try {\n    return new Date(ms).toLocaleString();\n  } catch {\n    return String(ms);\n  }\n}",
  'function formatTime(ms) {\n  try {\n    return new Date(ms).toLocaleString(getUiLocale());\n  } catch {\n    return String(ms);\n  }\n}'
);

src = src.replace(
  /const SETTINGS_PANE_META = \{[\s\S]*?\};/,
  `function getSettingsPaneMeta() {
  return {
    general: { title: t("desktop.settings.paneGeneral"), desc: t("desktop.settings.paneGeneralDesc") },
    models: { title: t("desktop.settings.paneModels"), desc: t("desktop.settings.paneModelsDesc") },
    sessions: { title: t("desktop.settings.paneSessions"), desc: t("desktop.settings.paneSessionsDesc") },
    workbench: { title: t("desktop.settings.paneWorkbench"), desc: t("desktop.settings.paneWorkbenchDesc") },
    report: { title: t("desktop.settings.paneReport"), desc: t("desktop.settings.paneReportDesc") },
    storage: { title: t("desktop.settings.paneStorage"), desc: t("desktop.settings.paneStorageDesc") },
    usage: { title: t("desktop.settings.paneUsage"), desc: t("desktop.settings.paneUsageDesc") }
  };
}`
);

src = src.replace("const meta = SETTINGS_PANE_META[resolved];", "const meta = getSettingsPaneMeta()[resolved];");

/** @type {Array<[string, string]>} */
const literalReplacements = [
  ['meta.textContent = "Loading…";', 'meta.textContent = t("desktop.common.loading");'],
  ['setStatus(status, "Loading usage…");', 'setStatus(status, t("desktop.usage.loading"));'],
  ['setStatus(status, "保存中…");', 'setStatus(status, t("desktop.settings.saving"));'],
  ['setStatus(status, "正在 Summarize…");', 'setStatus(status, t("desktop.sessions.summarizing"));'],
  ['setStatus(status, "Summary 已生成并写入 catalog", "ok");', 'setStatus(status, t("desktop.sessions.summaryGenerated"), "ok");'],
  ['setStatus(status, "正在 Auto Rename…");', 'setStatus(status, t("desktop.sessions.renaming"));'],
  ['setStatus(statusEl, "正在同步 Agent sessions…");', 'setStatus(statusEl, t("desktop.workbench.syncingSessions"));'],
  ['label.textContent = "全部 Sessions";', 'label.textContent = t("desktop.workbench.allSessions");'],
  ['label.title = "全部 Sessions";', 'label.title = t("desktop.workbench.allSessions");'],
  ['if (title) title.textContent = "重命名项目";', 'if (title) title.textContent = t("desktop.workbench.renameProject");'],
  ['if (title) title.textContent = "重命名 Session";', 'if (title) title.textContent = t("desktop.workbench.renameSession");'],
  ['if (input) input.setAttribute("aria-label", "项目显示名");', 'if (input) input.setAttribute("aria-label", t("desktop.workbench.renameProjectDisplay"));'],
  ['if (input) input.setAttribute("aria-label", "Session 标题");', 'if (input) input.setAttribute("aria-label", t("desktop.workbench.renameSessionTitle"));'],
  ['status.textContent = "仅改显示名，不影响磁盘路径";', 'status.textContent = t("desktop.workbench.renameDisplayHint");'],
  ['empty.textContent = wbProjectSearch.trim() ? "没有匹配的项目" : "没有符合筛选的项目";', 'empty.textContent = wbProjectSearch.trim() ? t("desktop.notes.noMatchingProjects") : t("desktop.notes.noFilterProjects");'],
  ['empty.textContent = "暂无项目";', 'empty.textContent = t("desktop.workbench.loadingProjects").replace("…", "");'],
  ['empty.textContent = wbSearch.trim() ? "没有匹配的 session" : "此项目暂无 session";', 'empty.textContent = wbSearch.trim() ? t("desktop.workbench.noMatchingSessions") : t("desktop.workbench.noSessionsInProject");'],
  ['hint.textContent = "选择项目后，新建 Terminal 或点击 session 会在该项目的工作台中打开。";', 'hint.textContent = t("desktop.workbench.selectProjectHint");'],
  ['hint.textContent = "终端模式：系统默认终端。点击左侧 session 在外部终端中恢复。";', 'hint.textContent = t("desktop.workbench.externalTerminalHint");'],
  ['hint.textContent = "选择左侧 session 以恢复终端";', 'hint.textContent = t("desktop.workbench.selectSessionHint");'],
  ['closeBtn.setAttribute("aria-label", "关闭终端");', 'closeBtn.setAttribute("aria-label", t("desktop.workbench.closeTerminal"));'],
  ['alertWorkbenchError("终端组件未加载");', 'alertWorkbenchError(t("desktop.workbench.terminalNotLoaded"));'],
  ['if (autoBtn) autoBtn.textContent = busy ? "正在自动重命名…" : "自动重命名";', 'if (autoBtn) autoBtn.textContent = busy ? t("desktop.workbench.autoRenaming") : t("desktop.workbench.autoRename");'],
  ['status.textContent = "正在根据对话内容生成标题…";', 'status.textContent = t("desktop.workbench.generatingTitle");'],
  ['status.textContent = "已填入建议标题，可编辑后点确定保存";', 'status.textContent = t("desktop.workbench.titleSuggested");'],
  ['if (!cwd) throw new Error("请选择一个 project");', 'if (!cwd) throw new Error(t("desktop.workbench.selectProject"));'],
  ['scratchBtn.textContent = "临时目录（新建）";', 'scratchBtn.textContent = t("desktop.workbench.scratchDir");'],
  ['scratchBtn.title = "在工作台临时目录中新建 session";', 'scratchBtn.title = t("desktop.workbench.scratchDirTitle");'],
  ['empty.textContent = "没有匹配的项目";', 'empty.textContent = t("desktop.notes.noMatchingProjects");'],
  ['if (!note) throw new Error("新建的笔记未找到");', 'if (!note) throw new Error(t("desktop.notes.noteNotFound"));'],
  ['const label = collapsed ? "显示侧栏" : "隐藏侧栏";', 'const label = collapsed ? t("desktop.common.showSidebar") : t("desktop.common.hideSidebar");'],
  ['h1.title = "双击编辑标题";', 'h1.title = t("desktop.notes.dblClickEdit");'],
  ['el.title = "双击编辑标题";', 'el.title = t("desktop.notes.dblClickEdit");'],
  ['if (!trimmed) return "名称不能为空";', 'if (!trimmed) return t("desktop.notes.nameEmpty");'],
  ['if (/[\\\\/]/.test(trimmed)) return "名称不能包含路径分隔符";', 'if (/[\\\\/]/.test(trimmed)) return t("desktop.notes.nameInvalid");'],
  ['input.setAttribute("aria-label", "笔记标题");', 'input.setAttribute("aria-label", t("desktop.notes.titleLabel"));'],
  ['if (diff < 60_000) return "刚刚";', 'if (diff < 60_000) return t("desktop.common.justNow");'],
  ['btn.textContent = "独立笔记区";', 'btn.textContent = t("desktop.notes.libraryArea");'],
  ['btn.title = "不关联项目或会话的个人笔记";', 'btn.title = t("desktop.notes.libraryDesc");'],
  ['empty.textContent = "暂无可用项目，请先同步 Sessions";', 'empty.textContent = t("desktop.notes.noProjectsSync");'],
  ['empty.textContent = "暂无可用会话，请先同步 Sessions";', 'empty.textContent = t("desktop.notes.noSessionsSync");'],
  ['empty.textContent = notesProjectSearch.trim() ? "没有匹配的项目" : "没有符合筛选的项目";', 'empty.textContent = notesProjectSearch.trim() ? t("desktop.notes.noMatchingProjects") : t("desktop.notes.noFilterProjects");'],
  ['empty.textContent = "暂无文件夹";', 'empty.textContent = t("desktop.notes.noFolders");'],
  ['empty.textContent = notesSearch.trim() ? "没有匹配的笔记" : "此文件夹暂无笔记";', 'empty.textContent = notesSearch.trim() ? t("desktop.notes.noMatchingNotes") : t("desktop.notes.noNotesInFolder");'],
  ['const preview = (note.contentPreview || "").trim() || "无额外文本";', 'const preview = (note.contentPreview || "").trim() || t("desktop.notes.noExtraText");'],
  ['img.title = "点击放大";', 'img.title = t("desktop.notes.clickZoom");'],
  ['if (titleEl) titleEl.textContent = "Sessions";', 'if (titleEl) titleEl.textContent = t("desktop.report.sessionsTitle");'],
  ['if (metaEl) metaEl.textContent = "加载中…";', 'if (metaEl) metaEl.textContent = t("desktop.common.loading");'],
  ['if (titleEl) titleEl.textContent = "报告详情";', 'if (titleEl) titleEl.textContent = t("desktop.report.reportDetail");'],
  ['setGenFinal("无法解析 digest id", "error");', 'setGenFinal(t("desktop.report.cannotParseDigestId"), "error");'],
  ['setGenFinal("缺少 digest id", "error");', 'setGenFinal(t("desktop.report.missingDigestId"), "error");'],
  ['runDaily(key, { reasonMessage: "手动重新生成" });', 'runDaily(key, { reasonMessage: t("desktop.report.manualRegenerate") });'],
  ['m.textContent = "更";', 'm.textContent = t("desktop.report.markStale");'],
  ['m.textContent = "未";', 'm.textContent = t("desktop.report.markMissing");'],
  ['m.textContent = "无";', 'm.textContent = t("desktop.report.markNone");'],
  ['setStatus(status, "请先在详情卡片点击「GTD分析」，指定要分析的 digest。", "error");', 'setStatus(status, t("desktop.report.gtdNoDigest"), "error");'],
  ['setStatus(status, "无效的提议项", "error");', 'setStatus(status, t("desktop.report.gtdInvalidProposal"), "error");'],
  ['btn.textContent = "添加中…";', 'btn.textContent = t("desktop.report.gtdAdding");'],
  ['btn.textContent = "添加GTD";', 'btn.textContent = t("desktop.report.gtdAddBtn");'],
  ['if (head) head.textContent = "加载中…";', 'if (head) head.textContent = t("desktop.common.loading");'],
  ['btnCopy.textContent = "复制";', 'btnCopy.textContent = t("desktop.common.copy");'],
  ['setStatus($("agentStatus"), "检索记忆…");', 'setStatus($("agentStatus"), t("desktop.agent.searchingReports"));'],
  ['delBtn.title = "删除对话";', 'delBtn.title = t("desktop.agent.deleteThreadTitle");'],
  ['const thread = await agentResume.createAgentThread({ title: "新对话" });', 'const thread = await agentResume.createAgentThread({ title: t("desktop.agent.newThread") });'],
  ['if (activeThread && activeThread.title === "新对话") {', 'if (activeThread && activeThread.title === t("desktop.agent.newThread")) {'],
  ['setStatus($("agentStatus"), "已复制回答", "ok");', 'setStatus($("agentStatus"), t("desktop.agent.copiedAnswer"), "ok");'],
  ['setStatus($("agentStatus"), "已复制", "ok");', 'setStatus($("agentStatus"), t("desktop.agent.copied"), "ok");'],
  ['setStatus($("agentStatus"), "该笔记已被删除，无法在 Notes 中打开", "error");', 'setStatus($("agentStatus"), t("desktop.agent.noteDeleted"), "error");'],
  ['setStatus($("agentStatus"), "无法解析笔记引用", "error");', 'setStatus($("agentStatus"), t("desktop.agent.cannotResolveNote"), "error");'],
  ['setStatus($("agentStatus"), "无法解析引用报告", "error");', 'setStatus($("agentStatus"), t("desktop.agent.cannotResolveReport"), "error");'],
  ['pane.innerHTML = `<p class="muted">Loading preview…</p>`;', 'pane.innerHTML = `<p class="muted">${escapeHtml(t("desktop.common.loadingPreview"))}</p>`;'],
  ['pane.innerHTML = `<p class="muted">无消息可预览。</p>`;', 'pane.innerHTML = `<p class="muted">${escapeHtml(t("desktop.sessions.noMessages"))}</p>`;'],
  ['html += `<p class="muted">（已截断）</p>`;', 'html += `<p class="muted">${escapeHtml(t("desktop.sessions.truncated"))}</p>`;'],
  ['list.innerHTML = `<p class="muted wb-list-empty">加载中…</p>`;', 'list.innerHTML = `<p class="muted wb-list-empty">${escapeHtml(t("desktop.common.loading"))}</p>`;'],
  ['librarySection.innerHTML = `<div class="notes-folder-section-label">独立笔记</div>`;', 'librarySection.innerHTML = `<div class="notes-folder-section-label">${escapeHtml(t("desktop.notes.librarySection"))}</div>`;'],
  ['section.innerHTML = `<div class="notes-folder-section-label">会话</div>`;', 'section.innerHTML = `<div class="notes-folder-section-label">${escapeHtml(t("desktop.notes.sessionsSection"))}</div>`;'],
  ['setStatus(status, "Scanning catalog…");', 'setStatus(status, t("desktop.backfill.scanning"));'],
  ['setStatus(status, "Scanning…");', 'setStatus(status, t("desktop.backfill.scanningShort"));'],
  ['setStatus(status, "Cancelled");', 'setStatus(status, t("desktop.backfill.cancelled"));'],
  ['setStatus(status, "Backfilling (daily → weekly → monthly)… this may take a while");', 'setStatus(status, t("desktop.backfill.running"));'],
  ['if (!filterActive) return "项目";', 'if (!filterActive) return t("desktop.notes.projectLabel");'],
  ['const filterLabel = filterMode === "pinned" ? "置顶" : filterMode === "active" ? "活动" : "";', 'const filterLabel = filterMode === "pinned" ? t("desktop.common.pinned") : filterMode === "active" ? t("desktop.common.active") : "";'],
  ['wbSelectedProject.kind === "project" ? `新建 Session · ${projectTitle}` : "新建 Session";', 'wbSelectedProject.kind === "project" ? t("desktop.workbench.newSessionWithProject", projectTitle) : t("desktop.workbench.newSession");'],
  ['wbSelectedProject.kind === "project" ? `新建 Terminal · ${projectTitle}` : "新建 Terminal";', 'wbSelectedProject.kind === "project" ? t("desktop.workbench.newTerminalWithProject", projectTitle) : t("desktop.workbench.newTerminal");'],
  ['wbSelectedProject.kind === "all" ? "全部 Sessions" : basename(wbSelectedProject.projectPath);', 'wbSelectedProject.kind === "all" ? t("desktop.workbench.allSessions") : basename(wbSelectedProject.projectPath);'],
  ['renderWorkbenchFolderRow("全部 Sessions", { kind: "all" }, { count: wbSessions.length });', 'renderWorkbenchFolderRow(t("desktop.workbench.allSessions"), { kind: "all" }, { count: wbSessions.length });'],
  ['renderNotesFolderRow("全部笔记", { kind: "all" }, { count: searched.length });', 'renderNotesFolderRow(t("desktop.notes.allNotes"), { kind: "all" }, { count: searched.length });'],
  ['renderNotesFolderRow("独立笔记区", { kind: "library" }, {', 'renderNotesFolderRow(t("desktop.notes.libraryArea"), { kind: "library" }, {'],
  ['title: "不关联项目或会话的个人笔记",', 'title: t("desktop.notes.libraryDesc"),'],
  ['placeholder: "编辑 Markdown…（⌘V 可粘贴图片）",', 'placeholder: t("desktop.notes.editorPlaceholder"),'],
  ['const message = error instanceof Error ? error.message : String(error ?? "未知错误");', 'const message = error instanceof Error ? error.message : String(error ?? t("desktop.common.unknownError"));'],
  ['return check.message || "日报可能不是最新的，方便的话可以再生成一次。";', 'return check.message || t("desktop.report.staleDefault");'],
  ['alertWorkbenchError(wbRenamePending?.kind === "project" ? "名称不能为空" : "标题不能为空");', 'alertWorkbenchError(wbRenamePending?.kind === "project" ? t("desktop.workbench.nameEmpty") : t("desktop.workbench.titleEmpty"));'],
  ['chip.title = "悬停预览";', 'chip.title = t("desktop.agent.citationHover");'],
  ['openButton.textContent = isNote ? "在 Notes 中查看" : "在 Memory 中查看";', 'openButton.textContent = isNote ? t("desktop.agent.openInNotes") : t("desktop.agent.openInReport");'],
  ['const levelLabel = isNote ? "笔记" : FOCUS_DIGEST_LABELS[focusType] || level;', 'const levelLabel = isNote ? t("desktop.agent.noteLevel") : FOCUS_DIGEST_LABELS[focusType] || level;'],
  ['const opLabel = NOTE_ACTION_LABELS[citation.operation] || "笔记";', 'const opLabel = NOTE_ACTION_LABELS[citation.operation] || t("desktop.agent.noteLevel");'],
  ['const title = citation.title || citation.noteId || "未命名笔记";', 'const title = citation.title || citation.noteId || t("desktop.agent.citationUnnamedNote");'],
  ['root.appendChild(buildCitationSection("report", "报告引用", memory, turnIdx));', 'root.appendChild(buildCitationSection("report", t("desktop.agent.citationReports"), memory, turnIdx));'],
  ['root.appendChild(buildCitationSection("note", "笔记引用", notes, turnIdx));', 'root.appendChild(buildCitationSection("note", t("desktop.agent.citationNotes"), notes, turnIdx));'],
  ['return turn.fallback ? "近期摘要" : "记忆检索";', 'return turn.fallback ? t("desktop.agent.recentSummary") : t("desktop.agent.reportRetrieval");'],
  ['return "正在输入…";', 'return t("desktop.agent.typing");'],
  ['btn.title = collapsed ? "显示侧栏" : "隐藏侧栏";', 'btn.title = collapsed ? t("desktop.common.showSidebar") : t("desktop.common.hideSidebar");'],
  ['btn.title = agentEnableTools ? "工具已开启：可通过对话操作笔记" : "开启后可通过对话操作笔记（新建/搜索）";', 'btn.title = agentEnableTools ? t("desktop.agent.toolsOn") : t("desktop.agent.toolsOffTitle");'],
  ['setStatus($("agentStatus"), agentEnableTools ? "工具模式已开启" : "工具模式已关闭", agentEnableTools ? "ok" : undefined);', 'setStatus($("agentStatus"), agentEnableTools ? t("desktop.agent.toolsOnStatus") : t("desktop.agent.toolsOffStatus"), agentEnableTools ? "ok" : undefined);'],
  ['event.message || "正在索引笔记…"', 'event.message || t("desktop.agent.indexingNotes")'],
  ['.join("") || `<tr><td colspan="4" class="muted">暂无数据</td></tr>`;', '.join("") || `<tr><td colspan="4" class="muted">${escapeHtml(t("desktop.usage.noData"))}</td></tr>`;'],
  ['.join("") || `<tr><td colspan="6" class="muted">暂无定时执行记录</td></tr>`;', '.join("") || `<tr><td colspan="6" class="muted">${escapeHtml(t("desktop.usage.noScheduleRuns"))}</td></tr>`;'],
  ['.join("") || `<tr><td colspan="6" class="muted">暂无调用明细（生成 digests / Ask 后会出现）</td></tr>`;', '.join("") || `<tr><td colspan="6" class="muted">${escapeHtml(t("desktop.usage.noLlmEvents"))}</td></tr>`;'],
  ['<div class="usage-card"><div class="label">Total tokens</div>', '<div class="usage-card"><div class="label">${escapeHtml(t("desktop.usage.totalTokens"))}</div>'],
  ['<div class="usage-card"><div class="label">Prompt / Completion</div>', '<div class="usage-card"><div class="label">${escapeHtml(t("desktop.usage.promptCompletion"))}</div>'],
  ['<div class="usage-card"><div class="label">Chat / Embed</div>', '<div class="usage-card"><div class="label">${escapeHtml(t("desktop.usage.chatEmbed"))}</div>'],
  ['<div class="usage-card"><div class="label">Events</div>', '<div class="usage-card"><div class="label">${escapeHtml(t("desktop.usage.events"))}</div>'],
  ['<div class="usage-card" style="grid-column:1/-1"><div class="label">By source</div>', '<div class="usage-card" style="grid-column:1/-1"><div class="label">${escapeHtml(t("desktop.usage.bySource"))}</div>'],
];

for (const [from, to] of literalReplacements) {
  if (!src.includes(from)) {
    // try alternate escaping
    continue;
  }
  src = src.split(from).join(to);
}

// Complex replacements
src = src.replace(
  /function sessionListMeta\(\) \{[\s\S]*?\}/,
  `function sessionListMeta() {
  const synced = lastSessionSyncAt ? t("desktop.sessions.lastSynced", formatTime(lastSessionSyncAt)) : "";
  const intervalLabel =
    SESSIONS_AUTO_REFRESH_MS >= 60_000 ? t("desktop.common.oneMinute") : t("desktop.common.intervalSeconds", SESSIONS_AUTO_REFRESH_MS / 1000);
  return t("desktop.sessions.meta", sessionsCache.length, intervalLabel, synced);
}`
);

src = src.replace(
  /function noteDeleteConfirmText\(note\) \{[\s\S]*?\}/,
  `function noteDeleteConfirmText(note) {
  return t("desktop.notes.deleteConfirm", note.filename);
}`
);

src = src.replace(
  /function notesRelativeTime\(ms\) \{[\s\S]*?\}/,
  `function notesRelativeTime(ms) {
  const diff = Date.now() - ms;
  if (diff < 60_000) return t("desktop.common.justNow");
  if (diff < 3_600_000) return t("desktop.common.minutesAgo", Math.floor(diff / 60_000));
  if (diff < 86_400_000) return t("desktop.common.hoursAgo", Math.floor(diff / 3_600_000));
  if (diff < 604_800_000) return t("desktop.common.daysAgo", Math.floor(diff / 86_400_000));
  try {
    return new Date(ms).toLocaleDateString(getUiLocale());
  } catch {
    return "";
  }
}`
);

src = src.replace(
  /const FOCUS_DIGEST_LABELS = \{ day: "日报", week: "周报", month: "月报" \};/,
  `const FOCUS_DIGEST_LABELS = {
  day: () => t("desktop.report.digestDaily"),
  week: () => t("desktop.report.digestWeekly"),
  month: () => t("desktop.report.digestMonthly")
};
function focusDigestLabel(type) {
  const fn = FOCUS_DIGEST_LABELS[type];
  return typeof fn === "function" ? fn() : t("desktop.report.digestReport");
}`
);

src = src.replace(
  /const FOCUS_SCOPE_WORDS = \{ day: "这一天", week: "这一周", month: "这一月" \};/,
  `const FOCUS_SCOPE_WORDS = {
  day: () => t("desktop.report.scopeDay"),
  week: () => t("desktop.report.scopeWeek"),
  month: () => t("desktop.report.scopeMonth")
};
function focusScopeWord(type) {
  const fn = FOCUS_SCOPE_WORDS[type];
  return typeof fn === "function" ? fn() : t("desktop.report.scopePeriod");
}`
);

src = src.replace(/FOCUS_DIGEST_LABELS\[(\w+)\]/g, "focusDigestLabel($1)");
src = src.replace(/FOCUS_SCOPE_WORDS\[(\w+)\]/g, "focusScopeWord($1)");

src = src.replace(
  /opt\.textContent = `\$\{y\} 年`;/,
  'opt.textContent = t("desktop.common.yearSuffix", y);'
);

src = src.replace(
  /range\.type === "day" \? `日 \$\{range\.key\}` : range\.type === "week" \? `周 \$\{range\.key\}` : `月 \$\{range\.key\}`;/,
  'range.type === "day" ? t("desktop.report.rangeDay", range.key) : range.type === "week" ? t("desktop.report.rangeWeek", range.key) : t("desktop.report.rangeMonth", range.key);'
);

src = src.replace(
  /if \(metaEl\) metaEl\.textContent = `\$\{calSessionCache\.length\} 条 · 点击预览`;/,
  'if (metaEl) metaEl.textContent = t("desktop.report.sessionCountMeta", calSessionCache.length);'
);

src = src.replace(
  /listEl\.innerHTML = `<p class="muted cal-session-empty">切换月份或选择日期 \/ 周后显示 session<\/p>`;/,
  'listEl.innerHTML = `<p class="muted cal-session-empty">${escapeHtml(t("desktop.report.sessionEmpty"))}</p>`;'
);

src = src.replace(
  /return `<p class="muted cal-session-empty">该范围内没有 session<\/p>`;/,
  'return `<p class="muted cal-session-empty">${escapeHtml(t("desktop.report.noSessionsInRange"))}</p>`;'
);

src = src.replace(
  /if \(titleEl\) titleEl\.textContent = `\$\{label\} · \$\{key\}` : "报告详情";/,
  'if (titleEl) titleEl.textContent = key ? t("desktop.report.digestDetailTitle", label, key) : t("desktop.report.reportDetail");'
);

src = src.replace(
  /const label = FOCUS_DIGEST_LABELS\[type\] \|\| "报告";/,
  'const label = focusDigestLabel(type);'
);

src = src.replace(
  /"\<p class=\\"muted\\"\>点击日期 \/ 周 \/ 月查看 session 与报告；点击 session 可在本列预览。\<\/p\>"/,
  '`<p class="muted">${escapeHtml(t("desktop.report.detailHint"))}</p>`'
);

// load/save settings uiLanguage
if (!src.includes("populateUiLanguageSelect")) {
  src = src.replace(
    "async function loadSettingsForm() {",
    `const UI_LANGUAGE_VALUES = ["auto", "en", "zh-cn", "ja", "ko", "es", "fr", "de", "pt-br", "it", "ru"];
const NATIVE_LOCALE_LABELS = {
  en: "English",
  "zh-cn": "简体中文",
  ja: "日本語",
  ko: "한국어",
  es: "Español",
  fr: "Français",
  de: "Deutsch",
  "pt-br": "Português (Brasil)",
  it: "Italiano",
  ru: "Русский"
};

function populateUiLanguageSelect(selected) {
  const form = $("settingsForm");
  const select = form?.uiLanguage;
  if (!select) return;
  const prev = selected ?? select.value;
  select.innerHTML = "";
  for (const value of UI_LANGUAGE_VALUES) {
    const opt = document.createElement("option");
    opt.value = value;
    opt.textContent =
      value === "auto" ? t("desktop.settings.fieldUiLanguageOptionAuto") : NATIVE_LOCALE_LABELS[value] || value;
    select.appendChild(opt);
  }
  select.value = UI_LANGUAGE_VALUES.includes(prev) ? prev : "auto";
}

async function loadSettingsForm() {`
  );

  src = src.replace(
    "  if (form.desktopTheme) {\n    form.desktopTheme.value = s.desktop?.theme || \"system\";\n  }",
    `  if (form.desktopTheme) {
    form.desktopTheme.value = s.desktop?.theme || "system";
  }
  populateUiLanguageSelect(s.uiLanguage || "auto");
  if (form.uiLanguage) {
    form.uiLanguage.value = s.uiLanguage || "auto";
  }`
  );

  src = src.replace(
    `    const ok = window.confirm(
      "启用定时分析后，Desktop 将在设定时刻读取 session 数据并调用工具 LLM / embedding API，可能产生费用。是否继续？"
    );`,
    'const ok = window.confirm(t("desktop.settings.memoryEnableConfirm"));'
  );

  src = src.replace(
    `    desktop: {
      ...(loadedSettings?.desktop || {}),
      theme: form.desktopTheme?.value || "system"
    }
  };`,
    `    uiLanguage: form.uiLanguage?.value || "auto",
    desktop: {
      ...(loadedSettings?.desktop || {}),
      theme: form.desktopTheme?.value || "system"
    }
  };`
  );

  src = src.replace(
    'const sched = result.schedulerEnabled ? " · 定时 ON" : " · 定时 OFF";\n    setStatus(status, `已保存${sched}`, "ok");',
    'const sched = result.schedulerEnabled ? t("desktop.settings.schedulerOn") : t("desktop.settings.schedulerOff");\n    setStatus(status, t("desktop.settings.saved", sched), "ok");'
  );
}

// boot + refreshLocalizedUiImpl
if (!src.includes("refreshLocalizedUiImpl")) {
  src = src.replace(
    "async function boot() {\n  initMarkdownHighlight();",
    `async function registerRefreshLocalizedUiImpl() {
  window.refreshLocalizedUiImpl = async () => {
    populateUiLanguageSelect($("settingsForm")?.uiLanguage?.value);
    if (activePrimaryTab === "settings") {
      const pane = document.querySelector(".settings-nav-item.active")?.dataset.settingsPane || "general";
      showSettingsPane(pane);
    }
    if (activePrimaryTab === "report") {
      ensureYearOptions();
      renderCalendar();
      await renderCalSessionList({ preserveScroll: true });
      refreshDetailFocus();
      const meta = $("sessionsMeta");
      if (meta && sessionsCache.length) meta.textContent = sessionListMeta();
    }
    if (activePrimaryTab === "agent") {
      renderAgentThreadsSidebar();
      updateAgentChatTitleHeader();
      if (agentChatRendered) renderAskChat();
    }
    if (activePrimaryTab === "workbench") {
      renderWorkbenchPanel();
      renderWorkbenchTerminalTabs();
      updateWorkbenchToolbarState();
    }
    if (activePrimaryTab === "notes" && notesLoaded) {
      renderNotesPanel();
    }
    if (isSessionsSheetOpen()) {
      const meta = $("sessionsMeta");
      if (meta) meta.textContent = sessionListMeta();
      renderSessionsList(sessionsCache);
    }
  };
}

async function boot() {
  await initI18n();
  if (typeof populateCalMonthOptions === "function") populateCalMonthOptions();
  await registerRefreshLocalizedUiImpl();
  if (typeof agentResume.onLocaleChanged === "function") {
    agentResume.onLocaleChanged((bundle) => {
      void refreshLocalizedUi(bundle);
    });
  }
  initMarkdownHighlight();`
  );
}

writeFileSync(appPath, src);
console.log("Migrated app.js — review diff for remaining literals.");