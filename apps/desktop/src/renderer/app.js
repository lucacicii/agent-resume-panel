/* global agentResume, marked, DOMPurify, hljs, NotesCodeMirror */

function $(id) {
  return document.getElementById(id);
}

function setStatus(el, text, kind) {
  el.textContent = text || "";
  el.classList.remove("ok", "error");
  if (kind) {
    el.classList.add(kind);
  }
}

function formatTime(ms) {
  try {
    return new Date(ms).toLocaleString();
  } catch {
    return String(ms);
  }
}

function basename(p) {
  if (!p) return "";
  const parts = p.replace(/\\/g, "/").split("/");
  return parts[parts.length - 1] || p;
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

/** Provider pill in session list meta line (codex, claude, grok, …). */
function providerTagHtml(provider) {
  const p = provider || "unknown";
  return `<span class="s-provider-tag" data-provider="${escapeHtml(p)}">${escapeHtml(p)}</span>`;
}

let markdownHighlightReady = false;

function initMarkdownHighlight() {
  if (markdownHighlightReady) return;
  if (typeof marked?.use !== "function" || typeof hljs?.highlight !== "function") return;
  marked.use({
    renderer: {
      code({ text, lang }) {
        const language = String(lang ?? "").trim();
        if (language && hljs.getLanguage(language)) {
          try {
            const highlighted = hljs.highlight(text, { language, ignoreIllegals: true }).value;
            return `<pre><code class="hljs language-${escapeHtml(language)}">${highlighted}</code></pre>`;
          } catch {
            // fall through to auto-detect
          }
        }
        const auto = hljs.highlightAuto(text);
        const langClass = auto.language ? ` language-${escapeHtml(auto.language)}` : "";
        return `<pre><code class="hljs${langClass}">${auto.value}</code></pre>`;
      }
    }
  });
  markdownHighlightReady = true;
}

function renderMarkdown(value) {
  const source = String(value ?? "");
  try {
    initMarkdownHighlight();
    if (typeof marked?.parse !== "function" || typeof DOMPurify?.sanitize !== "function") {
      throw new Error("Markdown renderer is unavailable");
    }

    const parsed = marked.parse(source, { gfm: true, breaks: true });
    const sanitized = DOMPurify.sanitize(parsed, {
      USE_PROFILES: { html: true },
      FORBID_TAGS: ["script", "style", "iframe", "object", "embed"],
      FORBID_ATTR: ["style"],
      ALLOW_UNKNOWN_PROTOCOLS: false
    });
    const template = document.createElement("template");
    template.innerHTML = sanitized;
    template.content.querySelectorAll("a[href]").forEach((link) => {
      link.setAttribute("target", "_blank");
      link.setAttribute("rel", "noopener noreferrer");
    });
    return template.innerHTML;
  } catch {
    return `<pre class="markdown-fallback">${escapeHtml(source)}</pre>`;
  }
}

/** @type {boolean} */
let askChatLoadedFromDb = false;
/** @type {boolean} */
let askChatRendered = false;
/** @type {boolean} */
let askChatHasMoreOlder = false;
/** @type {boolean} */
let askChatLoadingOlder = false;
/** @type {number | null} */
let askChatOldestSortOrder = null;
/** @type {Promise<void> | null} */
let askChatLoadPromise = null;
const ASK_CHAT_PAGE_SIZE = 40;

/** @type {any[]} */
let askThreads = [];
/** @type {string | null} */
let activeAskThreadId = null;
/** @type {boolean} */
let askSidebarCollapsed = false;
let askEnableTools = true;

function mapAskMessages(messages) {
  return (messages || []).map((m) => ({
    role: m.role,
    content: m.content,
    citations: m.citations || [],
    fallback: m.fallback,
    sortOrder: m.sortOrder
  }));
}

function syncAskChatCursor() {
  const orders = chatTurns.map((t) => t.sortOrder).filter((n) => Number.isFinite(n));
  askChatOldestSortOrder = orders.length ? Math.min(...orders) : null;
}

let activePrimaryTab = "memory";

function switchTab(name) {
  if (!name || name === activePrimaryTab) return;
  activePrimaryTab = name;

  if (name !== "ask") {
    hideCitationPreview();
  }

  document.querySelectorAll(".primary-tabs .tab").forEach((btn) => {
    btn.classList.toggle("active", btn.dataset.tab === name);
  });
  document.querySelectorAll("main > .panel").forEach((panel) => {
    panel.classList.toggle("active", panel.id === `tab-${name}`);
  });

  if (name === "ask") {
    void ensureAskChatVisible();
  }
  if (name === "workbench") {
    void ensureWorkbenchVisible();
  }
  if (name === "notes") {
    void ensureNotesVisible();
  }
  if (name !== "notes") {
    void flushNotesSave();
  }
}

async function ensureAskChatVisible() {
  if (!askChatLoadedFromDb) {
    await loadAskChat({ render: true });
    return;
  }
  if (!askChatRendered) {
    renderAskChat();
  }
}

function todayInputValue() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function monthInputValue() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

/** @type {any[]} */
let sessionsCache = [];
/** @type {string | null} */
let activeSessionKey = null;
/** @type {{ provider: string, id: string, title: string } | null} */
let activePreviewSession = null;
/** @type {ReturnType<typeof setInterval> | null} */
let lastSessionSyncAt = 0;
/** Fingerprint of last painted list (skip redraw when unchanged). */
let sessionsListFingerprint = "";
/** Prevent overlapping list loads. */
let sessionsLoadInFlight = false;

const SESSIONS_AUTO_REFRESH_MS = 60_000;

function isSessionsSheetOpen() {
  const sheet = $("sheetSessions");
  return !!(sheet && !sheet.hidden);
}

function sessionsFingerprint(list) {
  return (list || [])
    .map((s) => `${s.provider}:${s.id}:${s.title}:${s.updatedAt}:${s.sessionSummary ? 1 : 0}`)
    .join("|");
}

function renderSessionsList(sessions) {
  const list = $("sessionsList");
  if (!list) return;
  const frag = document.createDocumentFragment();
  for (const s of sessions) {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "session-row";
    btn.dataset.key = `${s.provider}:${s.id}`;
    if (activeSessionKey && btn.dataset.key === activeSessionKey) {
      btn.classList.add("active");
    }
    btn.innerHTML = `
      <div class="s-title">${escapeHtml(s.title)}</div>
      <div class="s-meta">${providerTagHtml(s.provider)} · ${escapeHtml(basename(s.projectPath))} · ${escapeHtml(
        formatTime(s.updatedAt)
      )}</div>
    `;
    btn.addEventListener("click", () => openSessionPreview(s));
    frag.appendChild(btn);
  }
  list.innerHTML = "";
  list.appendChild(frag);
}

/** Highlight active session row and scroll it to the center of the list. */
function scrollActiveSessionIntoView() {
  if (!activeSessionKey) return;
  const list = $("sessionsList");
  if (!list) return;
  const rows = list.querySelectorAll(".session-row");
  let target = null;
  rows.forEach((el) => {
    const on = el.dataset.key === activeSessionKey;
    el.classList.toggle("active", on);
    if (on) target = el;
  });
  if (target) {
    // Double rAF: wait for sheet layout after open
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        target.scrollIntoView({ block: "center", inline: "nearest", behavior: "smooth" });
      });
    });
  }
}

/**
 * @param {{ quiet?: boolean, preserveScroll?: boolean }} [opts]
 * quiet: auto-refresh — no full-list Loading flash; skip paint if unchanged
 */
async function loadSessions(opts = {}) {
  const quiet = opts.quiet === true;
  const preserveScroll = opts.preserveScroll === true;
  const list = $("sessionsList");
  const meta = $("sessionsMeta");
  if (!list || !meta) return;
  if (sessionsLoadInFlight) {
    // Wait briefly for in-flight load so open-from-calendar can focus the row
    for (let i = 0; i < 40 && sessionsLoadInFlight; i++) {
      await new Promise((r) => setTimeout(r, 50));
    }
    if (sessionsLoadInFlight) return;
  }
  sessionsLoadInFlight = true;
  const previousScrollTop = list.scrollTop;

  if (!quiet) {
    list.innerHTML = "";
    meta.textContent = "Loading…";
  }

  try {
    const next = await agentResume.listSessions(500);
    const fp = sessionsFingerprint(next);
    sessionsCache = next;

    if (quiet && fp === sessionsListFingerprint) {
      meta.textContent = sessionListMeta();
      // Still refresh active highlight / scroll target
      if (!preserveScroll) scrollActiveSessionIntoView();
      return;
    }

    sessionsListFingerprint = fp;
    renderSessionsList(sessionsCache);
    meta.textContent = sessionListMeta();
    if (preserveScroll) list.scrollTop = previousScrollTop;
    else scrollActiveSessionIntoView();
  } catch (error) {
    if (!quiet || !sessionsCache.length) {
      meta.textContent = error instanceof Error ? error.message : String(error);
    }
  } finally {
    sessionsLoadInFlight = false;
  }
}

function sessionListMeta() {
  const synced = lastSessionSyncAt ? ` · 最近同步 ${formatTime(lastSessionSyncAt)}` : "";
  const intervalLabel =
    SESSIONS_AUTO_REFRESH_MS >= 60_000 ? "1 分钟" : `${SESSIONS_AUTO_REFRESH_MS / 1000}s`;
  return `${sessionsCache.length} sessions · 可见时每 ${intervalLabel} 同步${synced} · 点击预览`;
}

function startSessionsAutoRefresh() {
  // The main process owns the visibility-aware timer.
}

function stopSessionsAutoRefresh() {
  // The main process owns the visibility-aware timer.
}

async function refreshProjectAliases() {
  if (typeof agentResume.listProjectAliases !== "function") {
    projectAliasMap = {};
    return;
  }
  try {
    projectAliasMap = await agentResume.listProjectAliases();
  } catch {
    // keep existing map
  }
}

function refreshPinnedProjects() {
  pinnedProjects = loadPinnedProjects();
}

function projectFolderBaseName(projectPath) {
  if (!projectPath || projectPath === "(no project)") return projectPath || "";
  return basename(projectPath);
}

function projectDisplayTitle(projectPath) {
  const alias = projectAliasMap[projectPath]?.trim();
  const base = projectFolderBaseName(projectPath);
  return alias || base;
}

function projectFolderRowInnerHtml(prefix, projectPath, options = {}) {
  const title = projectDisplayTitle(projectPath);
  const base = projectFolderBaseName(projectPath);
  const hasAlias = Boolean(projectAliasMap[projectPath]?.trim());
  const tooltip = options.title || projectPath;
  const descHtml = hasAlias
    ? `<span class="${prefix}-folder-row-desc">${escapeHtml(base)}</span>`
    : "";
  const countHtml =
    options.count != null ? `<span class="${prefix}-folder-row-count">${options.count}</span>` : "";
  return `
    <span class="${prefix}-folder-row-text" title="${escapeHtml(tooltip)}">
      <span class="${prefix}-folder-row-label">${escapeHtml(title)}</span>
      ${descHtml}
    </span>
    ${countHtml}
  `;
}

function projectActivityDotHtml() {
  return '<span class="wb-folder-activity-dot" aria-hidden="true"></span>';
}

function workbenchSessionActivityDotHtml() {
  return '<span class="wb-session-activity-dot" aria-hidden="true"></span>';
}

function projectPinIconHtml() {
  return '<span class="project-pin-icon" aria-hidden="true">★</span>';
}

async function applyProjectAliasUpdate(projectPath, alias) {
  const base = projectFolderBaseName(projectPath);
  const trimmed = (alias || "").trim();
  const toSave = !trimmed || trimmed === base ? "" : trimmed;
  await agentResume.setProjectAlias({ projectPath, alias: toSave });
  await refreshProjectAliases();
  renderWorkbenchFolders();
  if (notesLoaded) renderNotesFolders();
}

function configureRenameDialog(mode) {
  const title = $("wbRenameTitle");
  const autoBtn = $("btnWbRenameAuto");
  const input = $("wbRenameInput");
  const status = $("wbRenameStatus");
  if (mode === "project") {
    if (title) title.textContent = "重命名项目";
    if (autoBtn) autoBtn.hidden = true;
    if (input) input.setAttribute("aria-label", "项目显示名");
    if (status) {
      status.hidden = false;
      status.textContent = "仅改显示名，不影响磁盘路径";
    }
  } else {
    if (title) title.textContent = "重命名 Session";
    if (autoBtn) autoBtn.hidden = false;
    if (input) input.setAttribute("aria-label", "Session 标题");
  }
}

function showProjectRenamePrompt(projectPath) {
  return new Promise((resolve) => {
    const dialog = $("wbRenameDialog");
    const input = $("wbRenameInput");
    if (!dialog || !input) {
      resolve(null);
      return;
    }
    const base = projectFolderBaseName(projectPath);
    const current = projectAliasMap[projectPath]?.trim() || base;
    wbRenamePending = { kind: "project", projectPath, resolve };
    resetWorkbenchRenameDialogUi();
    configureRenameDialog("project");
    input.value = current;
    dialog.hidden = false;
    requestAnimationFrame(() => {
      input.focus();
      input.select();
    });
  });
}

async function promptRenameProject(projectPath) {
  const outcome = await showProjectRenamePrompt(projectPath);
  if (!outcome?.title) return;
  try {
    await applyProjectAliasUpdate(projectPath, outcome.title);
  } catch (error) {
    alert(error instanceof Error ? error.message : String(error));
  }
}

async function refreshSessionViews(opts = {}) {
  const quiet = opts.quiet !== false;
  await refreshProjectAliases();
  await Promise.all([
    isSessionsSheetOpen() ? loadSessions({ quiet, preserveScroll: true }) : Promise.resolve(),
    isWorkbenchActive() ? loadWorkbenchSessions({ quiet }) : Promise.resolve(),
    refreshMonthSessionActivity({ preserveScroll: true })
  ]);
}

async function syncAndRefreshSessionViews(statusEl) {
  if (statusEl) setStatus(statusEl, "正在同步 Agent sessions…");
  try {
    const result = await agentResume.syncSessions();
    lastSessionSyncAt = result.syncedAt || Date.now();
    await refreshSessionViews({ quiet: true });
    const warning = result.warnings?.join(" · ") || "";
    if (statusEl) setStatus(statusEl, warning || `已同步 ${result.sessionCount} sessions`, warning ? "error" : "ok");
    return result;
  } catch (error) {
    if (statusEl) setStatus(statusEl, error instanceof Error ? error.message : String(error), "error");
    throw error;
  }
}

/**
 * @param {any} session
 * @param {{ summary?: string, statusHtml?: string }} [opts]
 */
async function openSessionSheetPreview(session) {
  if (!session?.provider || !session?.id) return;
  activeSessionKey = `${session.provider}:${session.id}`;
  wbActiveKey = activeSessionKey;
  highlightWorkbenchSession(activeSessionKey);
  openSheet("sheetSessions");
  await loadSessions({ quiet: true });
  scrollActiveSessionIntoView();
  await openSessionPreview(session);
}

async function openSessionPreview(session, opts = {}) {
  const paneId = opts.paneId || "sessionPreview";
  activeSessionKey = `${session.provider}:${session.id}`;
  activePreviewSession = {
    provider: session.provider,
    id: session.id,
    title: session.title
  };
  scrollActiveSessionIntoView();
  highlightWorkbenchSession(activeSessionKey);
  const pane = $(paneId);
  if (!pane) return;
  pane.innerHTML = `<p class="muted">Loading preview…</p>`;
  try {
    const { session: s, preview } = await agentResume.previewSession({
      provider: session.provider,
      id: session.id
    });
    activePreviewSession = {
      provider: s.provider,
      id: s.id,
      title: preview.title || s.title
    };
    const summaryText = opts.summary ?? s.sessionSummary ?? "";
    renderSessionPreviewPane(s, preview, summaryText, opts.statusHtml || "", {
      paneId,
      idPrefix: opts.idPrefix || ""
    });
  } catch (error) {
    pane.innerHTML = `<p class="status error">${escapeHtml(
      error instanceof Error ? error.message : String(error)
    )}</p>`;
  }
}

/**
 * @param {any} s
 * @param {any} preview
 * @param {string} summaryText
 * @param {string} statusHtml
 */
function renderSessionPreviewPane(s, preview, summaryText, statusHtml, renderOpts = {}) {
  const paneId = renderOpts.paneId || "sessionPreview";
  const idPrefix = renderOpts.idPrefix || "";
  const pane = $(paneId);
  let html = `
    <div class="session-preview-head">
      <h3 class="session-preview-title" id="${idPrefix}sessionPreviewTitle">${escapeHtml(
        preview.title || s.title
      )}</h3>
      <div class="session-preview-actions">
        <button type="button" class="tool-btn" id="${idPrefix}btnSessionSummarize">Summarize</button>
        <button type="button" class="tool-btn" id="${idPrefix}btnSessionAutoRename">Auto Rename</button>
      </div>
    </div>
    <div class="muted session-preview-meta">
      ${escapeHtml(s.provider)} · ${escapeHtml(s.id)} · ${escapeHtml(s.projectPath)}
    </div>
    <p class="status" id="${idPrefix}sessionAssistStatus">${statusHtml || ""}</p>
    <div class="session-summary-box ${summaryText ? "" : "hidden"}" id="${idPrefix}sessionSummaryBox">
      <div class="session-summary-label">Summary</div>
      <div class="session-summary-body" id="${idPrefix}sessionSummaryBody">${escapeHtml(summaryText)}</div>
    </div>`;
  if (preview.warning) {
    html += `<p class="status error">${escapeHtml(preview.warning)}</p>`;
  }
  if (!preview.messages?.length) {
    html += `<p class="muted">无消息可预览。</p>`;
  } else {
    for (const m of preview.messages) {
      html += `
        <div class="preview-msg ${escapeHtml(m.role)}">
          <div class="role">${escapeHtml(m.role)}</div>
          <div>${escapeHtml(m.text)}</div>
        </div>`;
    }
    if (preview.truncated) {
      html += `<p class="muted">（已截断）</p>`;
    }
  }
  pane.innerHTML = html;
  $(`${idPrefix}btnSessionSummarize`)?.addEventListener("click", () =>
    runSessionSummarize({ idPrefix, paneId })
  );
  $(`${idPrefix}btnSessionAutoRename`)?.addEventListener("click", () =>
    runSessionAutoRename({ idPrefix, paneId })
  );
}

function setSessionAssistBusy(busy, label, idPrefix = "") {
  const sumBtn = $(`${idPrefix}btnSessionSummarize`);
  const renBtn = $(`${idPrefix}btnSessionAutoRename`);
  if (sumBtn) {
    sumBtn.disabled = busy;
    if (!busy) sumBtn.textContent = "Summarize";
  }
  if (renBtn) {
    renBtn.disabled = busy;
    if (!busy) renBtn.textContent = "Auto Rename";
  }
  if (busy && label === "summarize" && sumBtn) sumBtn.textContent = "Summarizing…";
  if (busy && label === "rename" && renBtn) renBtn.textContent = "Renaming…";
}

async function runSessionSummarize(opts = {}) {
  if (!activePreviewSession) return;
  const idPrefix = opts.idPrefix || "";
  const status = $(`${idPrefix}sessionAssistStatus`);
  setSessionAssistBusy(true, "summarize", idPrefix);
  setStatus(status, "正在 Summarize…");
  try {
    const result = await agentResume.summarizeSession({
      provider: activePreviewSession.provider,
      id: activePreviewSession.id
    });
    const box = $(`${idPrefix}sessionSummaryBox`);
    const body = $(`${idPrefix}sessionSummaryBody`);
    if (box && body) {
      box.classList.remove("hidden");
      body.textContent = result.summary;
    }
    await refreshSessionViews({ quiet: true });
    setStatus(status, "Summary 已生成并写入 catalog", "ok");
  } catch (error) {
    setStatus(status, error instanceof Error ? error.message : String(error), "error");
  } finally {
    setSessionAssistBusy(false, "", idPrefix);
  }
}

async function runSessionAutoRename(opts = {}) {
  if (!activePreviewSession) return;
  const idPrefix = opts.idPrefix || "";
  const status = $(`${idPrefix}sessionAssistStatus`);
  setSessionAssistBusy(true, "rename", idPrefix);
  setStatus(status, "正在 Auto Rename…");
  try {
    const result = await agentResume.autoRenameSession({
      provider: activePreviewSession.provider,
      id: activePreviewSession.id
    });
    activePreviewSession.title = result.title;
    const titleEl = $(`${idPrefix}sessionPreviewTitle`);
    if (titleEl) titleEl.textContent = result.title;

    const row = document.querySelector(`.session-row[data-key="${activeSessionKey}"] .s-title`);
    if (row) row.textContent = result.title;
    const wbRow = document.querySelector(`.wb-list-item[data-key="${activeSessionKey}"] .wb-list-item-title`);
    if (wbRow) wbRow.textContent = result.title;
    const calRow = document.querySelector(
      `.cal-session-row[data-provider="${activePreviewSession.provider}"][data-id="${activePreviewSession.id}"] .s-title`
    );
    if (calRow) calRow.textContent = result.title;
    if (
      calDetailMode === "session" &&
      calDetailSessionKey?.provider === activePreviewSession.provider &&
      calDetailSessionKey?.id === activePreviewSession.id
    ) {
      const detailTitle = $("calDetailTitle");
      if (detailTitle) detailTitle.textContent = result.title;
    }
    const cached = sessionsCache.find(
      (s) => s.provider === activePreviewSession.provider && s.id === activePreviewSession.id
    );
    if (cached) cached.title = result.title;
    await refreshSessionViews({ quiet: true });

    let msg = `已重命名为「${result.title}」`;
    if (!result.nativeRenamed && result.nativeError) {
      msg += `（catalog 已更新；原生存储：${result.nativeError}）`;
    }
    setStatus(status, msg, result.nativeRenamed || !result.nativeError ? "ok" : "error");
  } catch (error) {
    setStatus(status, error instanceof Error ? error.message : String(error), "error");
  } finally {
    setSessionAssistBusy(false, "", idPrefix);
  }
}

// --- Workbench ---

const WB_PROJECT_KEY = "workbench-selected-project";
const PINNED_PROJECTS_KEY = "pinned-projects";
/** @type {Record<string, string>} */
let projectAliasMap = {};
let pinnedProjects = [];
let wbSessions = [];
let wbActiveKey = "";
let wbSearch = "";
/** @type {{ kind: "all" } | { kind: "project"; projectPath: string }} */
let wbSelectedProject = { kind: "all" };
/** @type {Map<string, { terminalPanes: Map<string, { key: string, projectKey: string, projectPath: string, title: string, ptyId: number, term: any, fitAddon: any, paneEl: HTMLElement, hostEl: HTMLElement, cwd: string }>, activeTerminalKey: string, activeSessionKey: string }>} */
const wbProjectDetails = new Map();
let wbTerminalIpcReady = false;
let wbContextNode = null;
let wbLoaded = false;
let wbResizeObserver = null;
let wbBlankTerminalSeq = 0;
let wbTargetPopoverSearch = "";
let wbCreateBusy = false;
let wbRenamePending = null;
let wbProjectEditorInfo = null;
let wbTargetPopoverMode = "session";

function isWorkbenchActive() {
  return !!document.querySelector('.tab[data-tab="workbench"]')?.classList.contains("active");
}

function wbProjectKey(folder) {
  if (folder.kind === "all") return "all";
  return `project:${folder.projectPath}`;
}

function wbProjectKeyFromPath(projectPath) {
  return `project:${projectPath || "(no project)"}`;
}

function normalizeProjectPath(projectPath) {
  return projectPath || "(no project)";
}

function loadPinnedProjects() {
  try {
    const raw = localStorage.getItem(PINNED_PROJECTS_KEY);
    const parsed = raw ? JSON.parse(raw) : [];
    if (!Array.isArray(parsed)) return [];
    const seen = new Set();
    return parsed
      .map((value) => normalizeProjectPath(String(value || "")))
      .filter((value) => {
        if (!value || seen.has(value)) return false;
        seen.add(value);
        return true;
      });
  } catch {
    return [];
  }
}

function savePinnedProjects() {
  try {
    localStorage.setItem(PINNED_PROJECTS_KEY, JSON.stringify(pinnedProjects));
  } catch {
    // ignore
  }
}

function isProjectPinned(projectPath) {
  return pinnedProjects.includes(normalizeProjectPath(projectPath));
}

function setProjectPinned(projectPath, pinned) {
  const normalized = normalizeProjectPath(projectPath);
  const current = new Set(pinnedProjects);
  if (pinned) current.add(normalized);
  else current.delete(normalized);
  pinnedProjects = [...current];
  savePinnedProjects();
  renderWorkbenchFolders();
  if (notesLoaded) renderNotesFolders();
}

function currentWorkbenchProjectKey() {
  return wbProjectKey(wbSelectedProject);
}

function ensureWorkbenchProjectDetail(projectKey = currentWorkbenchProjectKey()) {
  let detail = wbProjectDetails.get(projectKey);
  if (!detail) {
    detail = { terminalPanes: new Map(), activeTerminalKey: "", activeSessionKey: "" };
    wbProjectDetails.set(projectKey, detail);
  }
  return detail;
}

function getWorkbenchProjectDetail(projectKey = currentWorkbenchProjectKey()) {
  return wbProjectDetails.get(projectKey) || null;
}

function getActiveWorkbenchProjectPath() {
  return wbSelectedProject.kind === "project" ? wbSelectedProject.projectPath : "";
}

function hasWorkbenchProjectActivity(projectPath) {
  const detail = getWorkbenchProjectDetail(wbProjectKeyFromPath(projectPath));
  return Boolean(detail && (detail.terminalPanes.size > 0 || Boolean(detail.activeSessionKey)));
}

function hasWorkbenchSessionActivity(session) {
  const key = workbenchSessionKey(session);
  if (!key) return false;
  if (wbActiveKey === key) return true;
  for (const detail of wbProjectDetails.values()) {
    if (detail.activeSessionKey === key) return true;
    if (detail.terminalPanes.has(key)) return true;
  }
  return false;
}

function isSameWbProject(a, b) {
  return wbProjectKey(a) === wbProjectKey(b);
}

function loadWbProjectState() {
  try {
    const raw = localStorage.getItem(WB_PROJECT_KEY);
    if (!raw) return;
    const parsed = JSON.parse(raw);
    if (parsed?.kind === "project" && parsed.projectPath) {
      wbSelectedProject = { kind: "project", projectPath: parsed.projectPath };
    } else {
      wbSelectedProject = { kind: "all" };
    }
  } catch {
    wbSelectedProject = { kind: "all" };
  }
}

function saveWbProjectState() {
  try {
    localStorage.setItem(WB_PROJECT_KEY, JSON.stringify(wbSelectedProject));
  } catch {
    // ignore
  }
}

function selectWorkbenchProject(folder) {
  wbSelectedProject = folder;
  saveWbProjectState();
  const detail = getWorkbenchProjectDetail();
  wbActiveKey = detail?.activeSessionKey || "";
  renderWorkbenchPanel();
  requestAnimationFrame(() => fitWorkbenchTerminal());
}

function alertWorkbenchError(error) {
  const message = error instanceof Error ? error.message : String(error ?? "未知错误");
  window.alert(message);
}

function filterWorkbenchSessionsByProject(sessions) {
  if (wbSelectedProject.kind === "all") return sessions;
  return sessions.filter((s) => (s.projectPath || "(no project)") === wbSelectedProject.projectPath);
}

function filterWorkbenchSessionsBySearch(sessions) {
  if (!wbSearch.trim()) return sessions;
  const q = wbSearch.trim().toLowerCase();
  return sessions.filter((s) => {
    const haystack = [s.title, s.id, s.provider, s.projectPath, s.projectPath ? basename(s.projectPath) : ""]
      .filter(Boolean)
      .join("\n")
      .toLowerCase();
    return haystack.includes(q);
  });
}

function visibleWorkbenchSessions() {
  return filterWorkbenchSessionsBySearch(filterWorkbenchSessionsByProject(wbSessions)).sort(
    (a, b) => (b.updatedAt || 0) - (a.updatedAt || 0)
  );
}

function updateWorkbenchToolbarState() {
  const removeBtn = $("btnWorkbenchRemove");
  if (removeBtn) removeBtn.disabled = !wbActiveKey;
  const newSessionBtn = $("btnWorkbenchNewSession");
  const newTerminalBtn = $("btnWorkbenchNewTerminal");
  const title = wbSelectedProject.kind === "project"
    ? `当前项目：${projectDisplayTitle(wbSelectedProject.projectPath)}`
    : "选择项目后创建";
  if (newSessionBtn) newSessionBtn.title = wbSelectedProject.kind === "project" ? `新建 Session · ${projectDisplayTitle(wbSelectedProject.projectPath)}` : "新建 Session";
  if (newTerminalBtn) newTerminalBtn.title = wbSelectedProject.kind === "project" ? `新建 Terminal · ${projectDisplayTitle(wbSelectedProject.projectPath)}` : title;
}

function updateWorkbenchDetailHeader() {
  const label = $("wbDetailProjectLabel");
  if (!label) return;
  if (wbSelectedProject.kind !== "project") {
    label.textContent = "全部 Sessions";
    label.title = "全部 Sessions";
    return;
  }
  const display = projectDisplayTitle(wbSelectedProject.projectPath);
  label.textContent = display;
  label.title = wbSelectedProject.projectPath;
}

function getActiveWorkbenchSession() {
  if (!wbActiveKey) return null;
  return wbSessions.find((s) => workbenchSessionKey(s) === wbActiveKey) || null;
}

function groupSessionsByProject(sessions) {
  const byPath = new Map();
  for (const s of sessions) {
    const key = s.projectPath || "(no project)";
    if (!byPath.has(key)) byPath.set(key, []);
    byPath.get(key).push(s);
  }
  return [...byPath.entries()]
    .map(([projectPath, list]) => ({
      projectPath,
      sessions: list.sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0))
    }))
    .sort(
      (a, b) => {
        const pinnedDiff = Number(isProjectPinned(b.projectPath)) - Number(isProjectPinned(a.projectPath));
        return pinnedDiff ||
          (b.sessions[0]?.updatedAt || 0) - (a.sessions[0]?.updatedAt || 0) ||
          a.projectPath.localeCompare(b.projectPath);
      }
    );
}

function syncWorkbenchListItemActivity(el) {
  const key = el.dataset.key || "";
  const hasActivity = wbSessions.some(
    (s) => workbenchSessionKey(s) === key && hasWorkbenchSessionActivity(s)
  );
  el.classList.toggle("has-wb-activity", hasActivity);
  const wrap = el.querySelector(".wb-session-title-wrap");
  if (!wrap) return;
  const dot = wrap.querySelector(".wb-session-activity-dot");
  if (hasActivity && !dot) {
    wrap.insertAdjacentHTML("afterbegin", workbenchSessionActivityDotHtml());
  } else if (!hasActivity && dot) {
    dot.remove();
  }
}

function highlightWorkbenchSession(key) {
  wbActiveKey = key || "";
  const detail = getWorkbenchProjectDetail();
  if (detail) detail.activeSessionKey = wbActiveKey;
  document.querySelectorAll(".wb-list-item").forEach((el) => {
    el.classList.toggle("active", el.dataset.key === wbActiveKey);
    syncWorkbenchListItemActivity(el);
  });
  renderWorkbenchFolders();
  updateWorkbenchToolbarState();
}

function scrollWorkbenchSessionIntoView() {
  if (!wbActiveKey) return;
  const list = $("wbList");
  if (!list) return;
  const target = list.querySelector(`.wb-list-item[data-key="${CSS.escape(wbActiveKey)}"]`);
  if (target) {
    requestAnimationFrame(() => {
      target.scrollIntoView({ block: "nearest", inline: "nearest", behavior: "smooth" });
    });
  }
}

function renderWorkbenchFolderRow(label, folder, options = {}) {
  const btn = document.createElement("button");
  btn.type = "button";
  btn.className = "wb-folder-row";
  if (isSameWbProject(wbSelectedProject, folder)) btn.classList.add("active");
  const hasActivity = folder.kind === "project" && hasWorkbenchProjectActivity(folder.projectPath);
  const isPinned = folder.kind === "project" && isProjectPinned(folder.projectPath);
  if (hasActivity) btn.classList.add("has-wb-activity");
  if (isPinned) btn.classList.add("is-pinned");
  const inner =
    folder.kind === "project" && folder.projectPath
      ? `${isPinned ? projectPinIconHtml() : ""}${hasActivity ? projectActivityDotHtml() : ""}${projectFolderRowInnerHtml("wb", folder.projectPath, options)}`
      : `
    <span class="wb-folder-row-label" title="${escapeHtml(options.title || label)}">${escapeHtml(label)}</span>
    ${options.count != null ? `<span class="wb-folder-row-count">${options.count}</span>` : ""}
  `;
  btn.innerHTML = inner;
  btn.addEventListener("click", () => selectWorkbenchProject(folder));
  if (folder.kind === "project") {
    btn.addEventListener("contextmenu", (e) => {
      e.preventDefault();
      showWorkbenchContextMenu({ kind: "project", projectPath: folder.projectPath }, e.clientX, e.clientY);
    });
  }
  return btn;
}

function renderWorkbenchFolders() {
  const host = $("wbFolders");
  if (!host) return;
  host.innerHTML = "";

  const projects = groupSessionsByProject(wbSessions);
  const allBtn = renderWorkbenchFolderRow("全部 Sessions", { kind: "all" }, { count: wbSessions.length });
  host.appendChild(allBtn);

  if (projects.length) {
    const section = document.createElement("div");
    section.className = "wb-folder-section";
    section.innerHTML = `<div class="wb-folder-section-label">项目</div>`;
    for (const project of projects) {
      const folder = { kind: "project", projectPath: project.projectPath };
      section.appendChild(
        renderWorkbenchFolderRow(projectDisplayTitle(project.projectPath), folder, {
          title: project.projectPath,
          count: project.sessions.length
        })
      );
    }
    host.appendChild(section);
  }

  if (!projects.length && !wbSessions.length) {
    const empty = document.createElement("p");
    empty.className = "muted wb-folders-empty";
    empty.textContent = "暂无项目";
    host.appendChild(empty);
  }
}

function renderWorkbenchSessionList() {
  const list = $("wbList");
  const meta = $("wbMeta");
  if (!list) return;

  const sessions = visibleWorkbenchSessions();
  list.innerHTML = "";

  if (meta) {
    const folderLabel =
      wbSelectedProject.kind === "all" ? "全部 Sessions" : basename(wbSelectedProject.projectPath);
    meta.textContent = wbSearch.trim()
      ? `${folderLabel} · 搜索「${wbSearch.trim()}」· ${sessions.length} 条`
      : `${folderLabel} · ${sessions.length} 条`;
  }

  if (!sessions.length) {
    const empty = document.createElement("p");
    empty.className = "muted wb-list-empty";
    empty.textContent = wbSearch.trim() ? "没有匹配的 session" : "此项目暂无 session";
    list.appendChild(empty);
    return;
  }

  for (const s of sessions) {
    const key = workbenchSessionKey(s);
    const hasActivity = hasWorkbenchSessionActivity(s);
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "wb-list-item";
    if (wbActiveKey === key) btn.classList.add("active");
    if (hasActivity) btn.classList.add("has-wb-activity");
    btn.dataset.key = key;
    btn.dataset.provider = s.provider;
    btn.dataset.id = s.id;
    const preview = [providerTagHtml(s.provider), basename(s.projectPath || "")].filter(Boolean).join(" · ");
    btn.innerHTML = `
      <div class="wb-list-item-top">
        <span class="wb-session-title-wrap">
          ${hasActivity ? workbenchSessionActivityDotHtml() : ""}
          <span class="wb-list-item-title">${escapeHtml(s.title || s.id)}</span>
        </span>
        <span class="wb-list-item-date">${escapeHtml(notesRelativeTime(s.updatedAt || 0))}</span>
      </div>
      <span class="wb-list-item-preview">${preview}</span>
    `;
    btn.addEventListener("click", () => void openWorkbenchSession(s));
    btn.addEventListener("contextmenu", (e) => {
      e.preventDefault();
      showWorkbenchContextMenu({ kind: "session", session: s }, e.clientX, e.clientY);
    });
    list.appendChild(btn);
  }

  const activeBtn = list.querySelector(`.wb-list-item[data-key="${CSS.escape(wbActiveKey)}"]`);
  activeBtn?.scrollIntoView({ block: "nearest" });
}

function renderWorkbenchPanel() {
  renderWorkbenchFolders();
  renderWorkbenchSessionList();
  updateWorkbenchDetailHeader();
  renderWorkbenchTerminalTabs();
  syncWorkbenchTerminalVisibility();
  updateWorkbenchTerminalHint();
  updateWorkbenchToolbarState();
}

async function loadWorkbenchSessions(opts = {}) {
  const quiet = opts.quiet === true;
  const list = $("wbList");
  if (!list) return;
  refreshPinnedProjects();
  if (!quiet) list.innerHTML = `<p class="muted wb-list-empty">加载中…</p>`;
  try {
    wbSessions = await agentResume.listSessions(2000);
    if (wbSelectedProject.kind === "project") {
      const hasProject = wbSessions.some(
        (s) => (s.projectPath || "(no project)") === wbSelectedProject.projectPath
      );
      if (!hasProject) wbSelectedProject = { kind: "all" };
    }
    renderWorkbenchPanel();
  } catch (error) {
    if (!quiet) {
      list.innerHTML = `<p class="status error">${escapeHtml(
        error instanceof Error ? error.message : String(error)
      )}</p>`;
    } else {
      alertWorkbenchError(error);
    }
  }
}

function isWorkbenchExternalTerminalMode(settings = loadedSettings) {
  const mode = settings?.workbench?.terminalMode;
  return mode === "external-system" || mode === "external-ghostty";
}

async function refreshLoadedSettings() {
  loadedSettings = await agentResume.getSettings();
  wbProjectEditorInfo = null;
  return loadedSettings;
}

async function refreshWorkbenchProjectEditor() {
  if (typeof agentResume.workbenchGetProjectEditor !== "function") return null;
  wbProjectEditorInfo = await agentResume.workbenchGetProjectEditor();
  return wbProjectEditorInfo;
}

async function ensureWorkbenchVisible() {
  const list = $("wbList");
  const previousScrollTop = list?.scrollTop ?? 0;
  if (!wbLoaded) {
    loadWbProjectState();
    wbLoaded = true;
  }
  await refreshLoadedSettings();
  await loadWorkbenchSessions({ quiet: true });
  if (list) list.scrollTop = previousScrollTop;
  updateWorkbenchToolbarState();
  await ensureDefaultWorkbenchTerminal();
  updateWorkbenchTerminalHint();
  // Double rAF: panel was display:none while on other tabs — wait for layout before fit.
  requestAnimationFrame(() => {
    requestAnimationFrame(() => fitWorkbenchTerminal());
  });
}

function defaultWorkbenchTerminalCwd() {
  const projectPath = getActiveWorkbenchProjectPath();
  if (projectPath) return projectPath;
  const scratch = loadedSettings?.workbench?.scratchDir?.trim();
  if (scratch) return scratch;
  const panelHome = loadedSettings?.panelHome?.trim();
  if (panelHome) return panelHome;
  return "~";
}

function workbenchBlankTerminalKey() {
  return `term:${++wbBlankTerminalSeq}`;
}

function nextBlankTerminalTitle(projectKey = currentWorkbenchProjectKey()) {
  const detail = getWorkbenchProjectDetail(projectKey);
  const count = detail ? [...detail.terminalPanes.keys()].filter((k) => k.startsWith("term:")).length : 0;
  return `终端 ${count + 1}`;
}

async function openBlankWorkbenchTerminal() {
  if (wbSelectedProject.kind !== "project") {
    openWorkbenchTargetPopover("terminal");
    return null;
  }
  return openWorkbenchTerminal({
    key: workbenchBlankTerminalKey(),
    projectPath: wbSelectedProject.projectPath,
    title: nextBlankTerminalTitle(),
    cwd: defaultWorkbenchTerminalCwd()
  });
}

async function ensureDefaultWorkbenchTerminal() {
  if (wbSelectedProject.kind !== "project") return;
  const detail = getWorkbenchProjectDetail();
  if (detail && detail.terminalPanes.size > 0) return;
  if (isWorkbenchExternalTerminalMode()) return;
  await openBlankWorkbenchTerminal();
}

function workbenchSessionKey(session) {
  return `${session.provider}:${session.id}`;
}

function workbenchNewSessionKey(cwd, provider) {
  return `new:${provider}:${cwd}:${Date.now()}:${Math.random().toString(36).slice(2, 7)}`;
}

function getActiveWorkbenchTerminalPane() {
  const detail = getWorkbenchProjectDetail();
  if (!detail?.activeTerminalKey) return null;
  return detail.terminalPanes.get(detail.activeTerminalKey) || null;
}

function getActiveWorkbenchTerminalKey() {
  const detail = getWorkbenchProjectDetail();
  return detail?.activeTerminalKey || "";
}

function updateWorkbenchTerminalHint() {
  const hint = $("wbTerminalHint");
  if (!hint) return;
  const detail = getWorkbenchProjectDetail();
  if (detail && detail.terminalPanes.size > 0) {
    hint.classList.add("hidden");
    return;
  }
  hint.classList.remove("hidden");
  if (wbSelectedProject.kind !== "project") {
    hint.textContent = "选择项目后，新建 Terminal 或点击 session 会在该项目的工作台中打开。";
    return;
  }
  if (isWorkbenchExternalTerminalMode()) {
    hint.textContent = "终端模式：系统默认终端。点击左侧 session 在外部终端中恢复。";
  } else {
    hint.textContent = "选择左侧 session 以恢复终端";
  }
}

function ensureWorkbenchTerminalIpc() {
  if (wbTerminalIpcReady) return;
  wbTerminalIpcReady = true;

  agentResume.onTerminalData((payload) => {
    for (const detail of wbProjectDetails.values()) {
      for (const pane of detail.terminalPanes.values()) {
        if (pane.ptyId === payload.id && pane.term) {
          pane.term.write(payload.data);
        }
      }
    }
  });
  agentResume.onTerminalRespawned((payload) => {
    for (const detail of wbProjectDetails.values()) {
      for (const pane of detail.terminalPanes.values()) {
        if (pane.ptyId === payload.id && pane.term) {
          pane.term.write("\r\n\x1b[90m[已恢复交互式 shell]\x1b[0m\r\n");
        }
      }
    }
  });
  agentResume.onTerminalExit((payload) => {
    for (const detail of wbProjectDetails.values()) {
      for (const pane of detail.terminalPanes.values()) {
        if (pane.ptyId === payload.id && pane.term) {
          pane.term.write("\r\n\x1b[90m[终端已关闭]\x1b[0m\r\n");
        }
      }
    }
  });
}

function syncWorkbenchTerminalVisibility() {
  const activeProjectKey = currentWorkbenchProjectKey();
  for (const [projectKey, detail] of wbProjectDetails) {
    for (const [paneKey, pane] of detail.terminalPanes) {
      const active = projectKey === activeProjectKey && paneKey === detail.activeTerminalKey;
      pane.paneEl.classList.toggle("active", active);
    }
  }
}

function renderWorkbenchTerminalTabs() {
  const tabsEl = $("wbTerminalTabs");
  if (!tabsEl) return;
  const detail = getWorkbenchProjectDetail();
  const terminalPanes = detail?.terminalPanes || new Map();
  tabsEl.hidden = terminalPanes.size === 0;
  tabsEl.innerHTML = "";

  for (const [key, pane] of terminalPanes) {
    const tab = document.createElement("div");
    tab.className = "wb-terminal-tab";
    tab.dataset.key = key;
    if (key === detail?.activeTerminalKey) tab.classList.add("active");

    const label = document.createElement("button");
    label.type = "button";
    label.className = "wb-terminal-tab-label";
    label.textContent = pane.title || basename(pane.cwd);
    label.title = pane.title || pane.cwd;
    label.addEventListener("click", () => switchWorkbenchTerminalTab(key));

    const closeBtn = document.createElement("button");
    closeBtn.type = "button";
    closeBtn.className = "wb-terminal-tab-close";
    closeBtn.setAttribute("aria-label", "关闭终端");
    closeBtn.textContent = "×";
    closeBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      void closeWorkbenchTerminalTab(key);
    });

    tab.appendChild(label);
    tab.appendChild(closeBtn);
    tabsEl.appendChild(tab);
  }
}

function switchWorkbenchTerminalTab(key) {
  const detail = getWorkbenchProjectDetail();
  if (!detail?.terminalPanes.has(key)) return;
  detail.activeTerminalKey = key;

  for (const [paneKey, pane] of detail.terminalPanes) {
    const active = paneKey === key;
    pane.paneEl.classList.toggle("active", active);
    if (active) {
      requestAnimationFrame(() => {
        try {
          pane.fitAddon?.fit();
          pane.term?.focus();
        } catch {
          // ignore
        }
        fitWorkbenchTerminal();
      });
    }
  }

  if (!key.startsWith("new:") && !key.startsWith("term:")) {
    detail.activeSessionKey = key;
    highlightWorkbenchSession(key);
  } else if (key.startsWith("term:")) {
    detail.activeSessionKey = "";
    highlightWorkbenchSession("");
  }
  renderWorkbenchTerminalTabs();
  renderWorkbenchFolders();
  updateWorkbenchTerminalHint();
}

async function closeWorkbenchTerminalTab(key) {
  const detail = getWorkbenchProjectDetail();
  const pane = detail?.terminalPanes.get(key);
  if (!pane) return;

  try {
    if (typeof agentResume.terminalDestroy === "function") {
      await agentResume.terminalDestroy({ id: pane.ptyId });
    }
  } catch (e) {
    console.warn("terminalDestroy IPC failed", e);
  }

  try {
    pane.term?.dispose();
  } catch {
    // ignore
  }
  pane.paneEl.remove();
  detail.terminalPanes.delete(key);

  if (detail.activeTerminalKey === key) {
    const remaining = [...detail.terminalPanes.keys()];
    detail.activeTerminalKey = remaining.length ? remaining[remaining.length - 1] : "";
    if (detail.activeTerminalKey) {
      switchWorkbenchTerminalTab(detail.activeTerminalKey);
    } else {
      wbActiveKey = "";
      highlightWorkbenchSession("");
    }
  }

  renderWorkbenchTerminalTabs();
  renderWorkbenchFolders();
  updateWorkbenchTerminalHint();
}

async function closeActiveWorkbenchTerminal() {
  const key = getActiveWorkbenchTerminalKey();
  if (!key) return false;
  await closeWorkbenchTerminalTab(key);
  return true;
}

function fitWorkbenchTerminal() {
  const pane = getActiveWorkbenchTerminalPane();
  if (!pane?.term || !pane.fitAddon || !isWorkbenchActive()) return;
  try {
    pane.fitAddon.fit();
    const cols = pane.term.cols;
    const rows = pane.term.rows;
    if (cols > 0 && rows > 0 && pane.ptyId > 0) {
      void agentResume.terminalResize({ id: pane.ptyId, cols, rows });
    }
  } catch {
    // ignore
  }
}

async function createWorkbenchTerminalPane(opts) {
  const { key, projectPath, title, cwd, command } = opts;
  const stack = $("wbTerminalStack");
  const hint = $("wbTerminalHint");
  if (!stack || typeof Terminal === "undefined") {
    alertWorkbenchError("终端组件未加载");
    return null;
  }

  ensureWorkbenchTerminalIpc();
  hint?.classList.add("hidden");

  const paneEl = document.createElement("div");
  paneEl.className = "wb-terminal-pane";
  paneEl.dataset.key = key;
  paneEl.dataset.projectPath = projectPath || "";

  const hostEl = document.createElement("div");
  hostEl.className = "wb-terminal-host";
  paneEl.appendChild(hostEl);
  stack.appendChild(paneEl);

  const term = new Terminal({
    cursorBlink: true,
    fontSize: 13,
    fontFamily: 'Menlo, Monaco, "Courier New", monospace',
    theme: {
      background: "#0d1117",
      foreground: "#e6edf3",
      cursor: "#e6edf3"
    },
    allowProposedApi: true
  });

  const fitAddon = typeof FitAddon !== "undefined" ? new FitAddon.FitAddon() : null;
  if (fitAddon) term.loadAddon(fitAddon);
  if (typeof WebglAddon !== "undefined") {
    try {
      term.loadAddon(new WebglAddon.WebglAddon());
    } catch {
      // WebGL unavailable — canvas renderer
    }
  }

  term.open(hostEl);
  if (fitAddon) {
    try {
      fitAddon.fit();
    } catch {
      // ignore
    }
  }

  const cols = Math.max(2, term.cols || 80);
  const rows = Math.max(2, term.rows || 24);
  const { id } = await agentResume.terminalSpawn({ cwd, command, cols, rows });

  const pane = {
    key,
    projectKey: wbProjectKeyFromPath(projectPath),
    projectPath: projectPath || "",
    title: title || basename(cwd),
    ptyId: id,
    term,
    fitAddon,
    paneEl,
    hostEl,
    cwd
  };
  ensureWorkbenchProjectDetail(pane.projectKey).terminalPanes.set(key, pane);

  term.onData((data) => {
    void agentResume.terminalInput({ id: pane.ptyId, data });
  });

  switchWorkbenchTerminalTab(key);
  requestAnimationFrame(() => fitWorkbenchTerminal());
  return pane;
}

async function openWorkbenchTerminal(opts) {
  const { key, title, cwd, command } = opts;
  const projectPath = (opts.projectPath || getActiveWorkbenchProjectPath() || "").trim();
  const projectKey = wbProjectKeyFromPath(projectPath);
  const detail = ensureWorkbenchProjectDetail(projectKey);
  const existing = detail.terminalPanes.get(key);
  if (existing) {
    if (projectPath && currentWorkbenchProjectKey() !== projectKey) {
      wbSelectedProject = { kind: "project", projectPath };
      saveWbProjectState();
      renderWorkbenchPanel();
    }
    switchWorkbenchTerminalTab(key);
    return existing;
  }
  if (projectPath && currentWorkbenchProjectKey() !== projectKey) {
    wbSelectedProject = { kind: "project", projectPath };
    saveWbProjectState();
    renderWorkbenchPanel();
  }
  return createWorkbenchTerminalPane({ key, projectPath, title, cwd, command });
}

async function openWorkbenchSession(session) {
  if (!session) return;
  if (session.projectPath && (wbSelectedProject.kind !== "project" || wbSelectedProject.projectPath !== session.projectPath)) {
    wbSelectedProject = { kind: "project", projectPath: session.projectPath };
    saveWbProjectState();
    renderWorkbenchPanel();
  }
  wbActiveKey = `${session.provider}:${session.id}`;
  activeSessionKey = wbActiveKey;
  highlightWorkbenchSession(wbActiveKey);
  scrollWorkbenchSessionIntoView();
  await refreshLoadedSettings();
  try {
    const result = await agentResume.workbenchOpenSession({
      provider: session.provider,
      id: session.id
    });
    if (result.alma || result.external || result.mode === "external-system") {
      updateWorkbenchTerminalHint();
      return;
    }
    const projectPath = session.projectPath || result.cwd;
    await openWorkbenchTerminal({
      key: workbenchSessionKey(session),
      projectPath,
      title: session.title,
      cwd: result.cwd,
      command: result.command
    });
  } catch (error) {
    alertWorkbenchError(error);
  }
}

function hideWorkbenchContextMenu() {
  const menu = $("wbContextMenu");
  if (menu) menu.hidden = true;
  wbContextNode = null;
}

function resetWorkbenchRenameDialogUi() {
  setWorkbenchRenameBusy(false);
  const status = $("wbRenameStatus");
  if (status) {
    status.hidden = true;
    status.textContent = "";
  }
}

function setWorkbenchRenameBusy(busy) {
  const autoBtn = $("btnWbRenameAuto");
  const confirmBtn = $("btnWbRenameConfirm");
  const input = $("wbRenameInput");
  autoBtn?.toggleAttribute("disabled", busy);
  confirmBtn?.toggleAttribute("disabled", busy);
  input?.toggleAttribute("disabled", busy);
  document.querySelectorAll("[data-wb-rename-cancel]").forEach((btn) => {
    btn.toggleAttribute("disabled", busy);
  });
  if (autoBtn) autoBtn.textContent = busy ? "正在自动重命名…" : "自动重命名";
}

function closeWorkbenchRenameDialog(outcome = null) {
  const pending = wbRenamePending;
  wbRenamePending = null;
  const dialog = $("wbRenameDialog");
  if (dialog) dialog.hidden = true;
  resetWorkbenchRenameDialogUi();
  pending?.resolve(outcome);
}

async function applyWorkbenchSessionTitleUpdate(session, title) {
  const cached = wbSessions.find((s) => s.provider === session.provider && s.id === session.id);
  if (cached) cached.title = title;
  const sessionsCached = sessionsCache.find((s) => s.provider === session.provider && s.id === session.id);
  if (sessionsCached) sessionsCached.title = title;
  await loadWorkbenchSessions({ quiet: true });
  await refreshSessionViews({ quiet: true });
  const detail = getWorkbenchProjectDetail(wbProjectKeyFromPath(session.projectPath));
  const pane = detail?.terminalPanes.get(workbenchSessionKey(session));
  if (pane) {
    pane.title = title;
    renderWorkbenchTerminalTabs();
  }
}

async function runWorkbenchSessionAutoRename() {
  const pending = wbRenamePending;
  if (pending?.kind !== "session" || !pending?.session) return;
  setWorkbenchRenameBusy(true);
  const status = $("wbRenameStatus");
  if (status) {
    status.hidden = false;
    status.textContent = "正在根据对话内容生成标题…";
  }
  try {
    const result = await agentResume.autoRenameSession({
      provider: pending.session.provider,
      id: pending.session.id,
      persist: false
    });
    const input = $("wbRenameInput");
    if (input) input.value = result.title || "";
    if (status) {
      status.hidden = false;
      status.textContent = "已填入建议标题，可编辑后点确定保存";
    }
    setWorkbenchRenameBusy(false);
    requestAnimationFrame(() => {
      input?.focus();
      input?.select();
    });
  } catch (error) {
    if (status) status.hidden = true;
    setWorkbenchRenameBusy(false);
    alertWorkbenchError(error);
  }
}

function showWorkbenchSessionRenamePrompt(session) {
  return new Promise((resolve) => {
    const dialog = $("wbRenameDialog");
    const input = $("wbRenameInput");
    if (!dialog || !input) {
      resolve(null);
      return;
    }
    wbRenamePending = { kind: "session", session, resolve };
    configureRenameDialog("session");
    resetWorkbenchRenameDialogUi();
    input.value = session.title || "";
    dialog.hidden = false;
    requestAnimationFrame(() => {
      input.focus();
      input.select();
    });
  });
}

async function showWorkbenchContextMenu(node, x, y) {
  wbContextNode = node;
  const menu = $("wbContextMenu");
  if (!menu) return;
  const isProject = node.kind === "project";
  const isSession = node.kind === "session";
  const session = isSession ? node.session : null;
  menu.querySelector('[data-wb-action="pinProject"]').hidden = !isProject || isProjectPinned(node.projectPath);
  menu.querySelector('[data-wb-action="unpinProject"]').hidden = !isProject || !isProjectPinned(node.projectPath);
  menu.querySelector('[data-wb-action="newSession"]').hidden = !isProject;
  const editorButton = menu.querySelector('[data-wb-action="openProjectEditor"]');
  if (editorButton) editorButton.hidden = true;
  menu.querySelector('[data-wb-action="mountNote"]').hidden = !(isProject || isSession);
  menu.querySelector('[data-wb-action="renameProject"]').hidden = !isProject;
  menu.querySelector('[data-wb-action="codexApp"]').hidden = !isSession || session?.provider !== "codex";
  menu.querySelector('[data-wb-action="preview"]').hidden = !isSession;
  menu.querySelector('[data-wb-action="rename"]').hidden = !isSession;
  menu.querySelector('[data-wb-action="remove"]').hidden = !isSession;
  menu.hidden = false;
  menu.style.left = `${x}px`;
  menu.style.top = `${y}px`;

  if (isProject && editorButton) {
    try {
      const info = wbProjectEditorInfo || (await refreshWorkbenchProjectEditor());
      if (wbContextNode !== node || menu.hidden) return;
      const labels = {
        vscode: "VS Code",
        vscodium: "VSCodium",
        cursor: "Cursor",
        windsurf: "Windsurf"
      };
      const selected = info?.selected;
      const label = info?.editor?.label || labels[selected];
      if (label && (selected !== "auto" || info?.available)) {
        editorButton.textContent = `在 ${label} 中打开`;
        editorButton.hidden = false;
      }
    } catch {
      // Keep the optional action hidden when editor detection fails.
    }
  }
}

async function openWorkbenchCodexApp(session) {
  if (!session || session.provider !== "codex") return;
  wbActiveKey = workbenchSessionKey(session);
  activeSessionKey = wbActiveKey;
  highlightWorkbenchSession(wbActiveKey);
  scrollWorkbenchSessionIntoView();
  try {
    await agentResume.workbenchOpenCodexApp({
      provider: session.provider,
      id: session.id
    });
  } catch (error) {
    alertWorkbenchError(error);
  }
}

async function handleWorkbenchContextAction(action) {
  const node = wbContextNode;
  hideWorkbenchContextMenu();
  if (action === "newSession" && node?.kind === "project") {
    await startWorkbenchNewSessionForProject(node.projectPath);
    return;
  }
  if (action === "pinProject" && node?.kind === "project") {
    setProjectPinned(node.projectPath, true);
    return;
  }
  if (action === "unpinProject" && node?.kind === "project") {
    setProjectPinned(node.projectPath, false);
    return;
  }
  if (action === "openProjectEditor" && node?.kind === "project") {
    try {
      await agentResume.workbenchOpenProjectInEditor({ projectPath: node.projectPath });
    } catch (error) {
      alertWorkbenchError(error);
    }
    return;
  }
  if (action === "renameProject" && node?.kind === "project") {
    await promptRenameProject(node.projectPath);
    return;
  }
  if (action === "mountNote") {
    const owner = ownerFromWorkbenchContext(node);
    if (owner) await openOrCreateWorkbenchNote(owner);
    return;
  }
  const session = node?.kind === "session" ? node.session : null;
  if (!session) return;
  if (action === "codexApp") {
    await openWorkbenchCodexApp(session);
    return;
  }
  if (action === "preview") {
    await openSessionSheetPreview(session);
    return;
  }
  if (action === "rename") {
    const outcome = await showWorkbenchSessionRenamePrompt(session);
    if (!outcome) return;
    try {
      const result = await agentResume.renameSession({
        provider: session.provider,
        id: session.id,
        title: outcome.title
      });
      await applyWorkbenchSessionTitleUpdate(session, result.session?.title || outcome.title);
    } catch (error) {
      alertWorkbenchError(error);
    }
    return;
  }
  if (action === "remove") {
    await removeWorkbenchSession(session);
  }
}

async function removeWorkbenchSession(session) {
  if (!session) return;
  const ok = window.confirm(`从面板移除「${session.title}」？（不会删除原生存储）`);
  if (!ok) return;
  try {
    await agentResume.hideSession({ provider: session.provider, id: session.id });
    const sessionKey = workbenchSessionKey(session);
    const detail = getWorkbenchProjectDetail(wbProjectKeyFromPath(session.projectPath));
    if (detail?.terminalPanes.has(sessionKey)) {
      await closeWorkbenchTerminalTab(sessionKey);
    }
    if (wbActiveKey === sessionKey) {
      wbActiveKey = "";
      highlightWorkbenchSession("");
    }
    await loadWorkbenchSessions({ quiet: true });
    await refreshSessionViews({ quiet: true });
  } catch (error) {
    alertWorkbenchError(error);
  }
}

async function removeActiveWorkbenchSession() {
  const session = getActiveWorkbenchSession();
  if (!session) return;
  await removeWorkbenchSession(session);
}

function shouldKeepWorkbenchSelection(target) {
  return Boolean(
    target.closest(".wb-list-item") ||
      target.closest("#wbTerminalShell") ||
      target.closest(".wb-list-toolbar") ||
      target.closest("#wbTargetPopover") ||
      target.closest("#wbContextMenu") ||
      target.closest("#wbRenameDialog")
  );
}

function clearWorkbenchSelection() {
  if (!wbActiveKey) return;
  wbActiveKey = "";
  highlightWorkbenchSession("");
  renderWorkbenchSessionList();
}

function defaultWorkbenchNewSessionProvider(settings = loadedSettings) {
  return settings?.workbench?.defaultNewSessionProvider || "codex";
}

async function launchWorkbenchNewSession(cwd, provider) {
  if (!cwd) throw new Error("请选择一个 project");
  const useSystemTerminalOnly = provider === "system-terminal";
  const result = await agentResume.workbenchNewSession({
    cwd,
    provider: useSystemTerminalOnly ? "codex" : provider,
    useSystemTerminalOnly
  });
  if (result.mode === "external-system" || useSystemTerminalOnly) {
    return;
  }
  const providerUsed = useSystemTerminalOnly ? "codex" : provider;
  await openWorkbenchTerminal({
    key: workbenchNewSessionKey(result.cwd, providerUsed),
    projectPath: result.cwd,
    title: `新 session · ${basename(result.cwd)}`,
    cwd: result.cwd,
    command: result.command
  });
}

function setWorkbenchCreateBusy(busy) {
  wbCreateBusy = busy;
  const btn = $("btnWorkbenchNewSession");
  if (btn) btn.classList.toggle("is-busy", busy);
  updateWorkbenchToolbarState();
}

function hideWorkbenchTargetPopover() {
  const pop = $("wbTargetPopover");
  if (pop) pop.hidden = true;
}

function renderWorkbenchTargetList() {
  const list = $("wbTargetList");
  if (!list) return;
  list.innerHTML = "";
  const q = wbTargetPopoverSearch.trim().toLowerCase();

  if (wbTargetPopoverMode !== "terminal") {
    const scratchBtn = document.createElement("button");
    scratchBtn.type = "button";
    scratchBtn.className = "wb-target-item";
    scratchBtn.textContent = "临时目录（新建）";
    scratchBtn.title = "在工作台临时目录中新建 session";
    scratchBtn.addEventListener("click", () => void pickWorkbenchTarget("scratch", wbTargetPopoverMode));
    if (!q || "临时目录".includes(q) || "scratch".includes(q)) {
      list.appendChild(scratchBtn);
    }
  }

  const projects = groupSessionsByProject(wbSessions.length ? wbSessions : sessionsCache);
  const filtered = projects.filter(
    (p) => !q || basename(p.projectPath).toLowerCase().includes(q) || p.projectPath.toLowerCase().includes(q)
  );
  for (const project of filtered) {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "wb-target-item";
    btn.textContent = basename(project.projectPath);
    btn.title = project.projectPath;
    btn.addEventListener("click", () => void pickWorkbenchTarget(project.projectPath, wbTargetPopoverMode));
    list.appendChild(btn);
  }

  if (!list.children.length) {
    const empty = document.createElement("p");
    empty.className = "muted wb-target-empty";
    empty.textContent = "没有匹配的项目";
    list.appendChild(empty);
  }
}

function openWorkbenchTargetPopover(mode = "session") {
  wbTargetPopoverMode = mode;
  wbTargetPopoverSearch = "";
  const search = $("wbTargetSearch");
  if (search) search.value = "";
  const pop = $("wbTargetPopover");
  if (pop) pop.hidden = false;
  renderWorkbenchTargetList();
  search?.focus();
}

async function pickWorkbenchTarget(target, mode = wbTargetPopoverMode) {
  hideWorkbenchTargetPopover();
  if (wbCreateBusy) return;
  setWorkbenchCreateBusy(true);
  await refreshLoadedSettings();
  const provider = defaultWorkbenchNewSessionProvider();
  try {
    const cwd = target === "scratch" ? await agentResume.createScratchDir() : target;
    if (!cwd) throw new Error("请选择一个 project");
    if (mode === "terminal") {
      wbSelectedProject = { kind: "project", projectPath: cwd };
      saveWbProjectState();
      renderWorkbenchPanel();
      await openBlankWorkbenchTerminal();
    } else {
      await launchWorkbenchNewSession(cwd, provider);
    }
    await loadWorkbenchSessions({ quiet: true });
  } catch (error) {
    alertWorkbenchError(error);
  } finally {
    setWorkbenchCreateBusy(false);
  }
}

async function startWorkbenchNewSessionForProject(projectPath) {
  await pickWorkbenchTarget(projectPath, "session");
}

async function handleWorkbenchNewSessionClick() {
  if (wbCreateBusy) return;
  if (wbSelectedProject.kind === "project") {
    await startWorkbenchNewSessionForProject(wbSelectedProject.projectPath);
    return;
  }
  openWorkbenchTargetPopover("session");
}

function ownerFromWorkbenchContext(node) {
  if (!node) return null;
  if (node.kind === "project" && node.projectPath) {
    return { scope: "project", projectPath: node.projectPath };
  }
  if (node.kind === "session" && node.session) {
    const s = node.session;
    return {
      scope: "session",
      provider: s.provider,
      sessionId: s.id,
      projectPath: s.projectPath
    };
  }
  return null;
}

async function invokeNotesCreateFromOwner(owner) {
  if (owner.scope === "project") {
    return agentResume.notesCreate({ scope: "project", projectPath: owner.projectPath });
  }
  return agentResume.notesCreate({
    scope: "session",
    provider: owner.provider,
    sessionId: owner.sessionId,
    projectPath: owner.projectPath
  });
}

function noteBelongsToOwner(note, owner) {
  if (owner.scope === "project") {
    return note.scope === "project" && note.projectPath === owner.projectPath;
  }
  return (
    note.scope === "session" &&
    note.provider === owner.provider &&
    note.agentSessionId === owner.sessionId
  );
}

async function openOrCreateWorkbenchNote(owner) {
  if (notesCreateBusy || !owner) return;
  setNotesCreateBusy(true);
  try {
    await flushNotesSave();
    if (!notesPanelHome) {
      notesPanelHome = await agentResume.getPanelHome();
    }
    await refreshProjectAliases();
    notesCache = await agentResume.notesList();
    notesLoaded = true;

    let note = notesCache
      .filter((candidate) => noteBelongsToOwner(candidate, owner))
      .sort((a, b) => b.updatedAtMs - a.updatedAtMs)[0];
    const created = !note;
    if (!note) {
      const result = await invokeNotesCreateFromOwner(owner);
      notesCache = await agentResume.notesList();
      note = notesCache.find((candidate) => candidate.noteId === result.noteId);
      if (!note) throw new Error("新建的笔记未找到");
    }

    switchTab("notes");
    selectNotesFolderForOwner(owner);
    await openNoteInEditor(note.noteId);
    if (created) {
      setNotesViewMode("edit");
      focusNotesEditor();
    }
  } catch (error) {
    alertNotesError(error);
  } finally {
    setNotesCreateBusy(false);
  }
}

// --- Notes ---

const NOTES_FOLDER_KEY = "notes-selected-folder";
const NOTES_FOLDERS_COLLAPSED_KEY = "notes-folders-collapsed";
const WB_FOLDERS_COLLAPSED_KEY = "wb-folders-collapsed";
let notesFoldersCollapsed = false;
let wbFoldersCollapsed = false;
let notesCache = [];
let notesSearch = "";
/** @type {{ kind: "all" } | { kind: "library" } | { kind: "project"; projectPath: string } | { kind: "session"; provider: string; sessionId: string }} */
let notesSelectedFolder = { kind: "all" };
let notesActiveId = "";
let notesDirty = false;
let notesSuppressEditorChange = false;
let notesSaveTimer = null;
let notesLoaded = false;
let notesPanelHome = "";
let notesContextNode = null;
let notesTitleEditing = false;
let notesTitleEditCancelled = false;
/** @type {"create" | "import" | "move"} */
let notesTargetPopoverMode = "create";
let notesTargetPopoverKind = "library";
let notesTargetPopoverSearch = "";
let notesMoveNoteId = "";
let notesCreateBusy = false;
/** @type {"edit" | "view"} */
let notesViewMode = "edit";
/** @type {import("@codemirror/view").EditorView | null} */
let notesCmView = null;
let notesFindOpen = false;
let notesFindQuery = "";
let notesFindMatches = [];
let notesFindIndex = -1;

function isNotesActive() {
  return !!document.querySelector('.tab[data-tab="notes"]')?.classList.contains("active");
}

function loadNotesFolderState() {
  try {
    const raw = localStorage.getItem(NOTES_FOLDER_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (
        parsed?.kind === "all" ||
        parsed?.kind === "library" ||
        parsed?.kind === "project" ||
        parsed?.kind === "session"
      ) {
        notesSelectedFolder = parsed;
      }
    }
  } catch {
    notesSelectedFolder = { kind: "all" };
  }
}

function saveNotesFolderState() {
  try {
    localStorage.setItem(NOTES_FOLDER_KEY, JSON.stringify(notesSelectedFolder));
  } catch {
    // ignore
  }
}

function updateSidebarCollapseToggle(btn, collapsed) {
  if (!btn) return;
  const label = collapsed ? "显示侧栏" : "隐藏侧栏";
  btn.title = label;
  btn.setAttribute("aria-label", label);
  btn.setAttribute("aria-expanded", collapsed ? "false" : "true");
  btn.classList.toggle("is-active", collapsed);
}

function setNotesFoldersCollapsed(collapsed, { persist = true } = {}) {
  notesFoldersCollapsed = collapsed;
  $("notesFoldersPane")?.classList.toggle("is-collapsed", collapsed);
  updateSidebarCollapseToggle($("btnNotesToggleFolders"), collapsed);
  if (persist) {
    try {
      localStorage.setItem(NOTES_FOLDERS_COLLAPSED_KEY, collapsed ? "1" : "0");
    } catch {
      // ignore
    }
  }
}

function setWbFoldersCollapsed(collapsed, { persist = true } = {}) {
  wbFoldersCollapsed = collapsed;
  $("wbFoldersPane")?.classList.toggle("is-collapsed", collapsed);
  updateSidebarCollapseToggle($("btnWbToggleFolders"), collapsed);
  if (persist) {
    try {
      localStorage.setItem(WB_FOLDERS_COLLAPSED_KEY, collapsed ? "1" : "0");
    } catch {
      // ignore
    }
  }
}

function toggleNotesFoldersCollapsed() {
  setNotesFoldersCollapsed(!notesFoldersCollapsed);
}

function toggleWbFoldersCollapsed() {
  setWbFoldersCollapsed(!wbFoldersCollapsed);
}

function loadSidebarFoldersCollapsedState() {
  const narrow = window.matchMedia("(max-width: 900px)").matches;
  try {
    const notesRaw = localStorage.getItem(NOTES_FOLDERS_COLLAPSED_KEY);
    const wbRaw = localStorage.getItem(WB_FOLDERS_COLLAPSED_KEY);
    setNotesFoldersCollapsed(notesRaw != null ? notesRaw === "1" : narrow, { persist: notesRaw != null });
    setWbFoldersCollapsed(wbRaw != null ? wbRaw === "1" : false, { persist: wbRaw != null });
  } catch {
    setNotesFoldersCollapsed(narrow, { persist: false });
    setWbFoldersCollapsed(false, { persist: false });
  }
}

function noteDisplayTitle(note) {
  if (note.title?.trim()) return note.title.trim();
  const name = note.filename || "";
  return name.endsWith(".md") ? name.slice(0, -3) : name;
}

function createNotesTitleElement(text = "") {
  const h1 = document.createElement("h1");
  h1.className = "notes-detail-title";
  h1.id = "notesEditorTitle";
  h1.title = "双击编辑标题";
  h1.textContent = text;
  bindNotesTitleEdit(h1);
  return h1;
}

function bindNotesTitleEdit(el) {
  if (!el || el.dataset.titleEditBound === "1") return;
  el.dataset.titleEditBound = "1";
  el.title = "双击编辑标题";
  el.addEventListener("dblclick", () => beginNotesTitleEdit());
}

function setNotesEditorTitleText(note) {
  cancelNotesTitleEdit();
  const title = $("notesEditorTitle");
  if (title && !title.classList.contains("notes-detail-title-input")) {
    title.textContent = note ? noteDisplayTitle(note) : "";
  }
}

function validateNotesTitleInput(raw) {
  const trimmed = raw.trim();
  if (!trimmed) return "名称不能为空";
  if (/[\\/]/.test(trimmed)) return "名称不能包含路径分隔符";
  return "";
}

function cancelNotesTitleEdit() {
  if (!notesTitleEditing) return;
  notesTitleEditCancelled = true;
  const input = $("notesEditorTitle");
  const head = input?.closest(".notes-detail-head");
  if (!input?.classList.contains("notes-detail-title-input") || !head) {
    notesTitleEditing = false;
    return;
  }
  const note = notesCache.find((n) => n.noteId === notesActiveId);
  const h1 = createNotesTitleElement(note ? noteDisplayTitle(note) : input.value);
  input.replaceWith(h1);
  notesTitleEditing = false;
}

async function finishNotesTitleEdit(save) {
  if (!notesTitleEditing) return;
  const input = $("notesEditorTitle");
  const head = input?.closest(".notes-detail-head");
  if (!input?.classList.contains("notes-detail-title-input") || !head) {
    notesTitleEditing = false;
    return;
  }

  const previous = notesCache.find((n) => n.noteId === notesActiveId);
  const previousLabel = previous ? noteDisplayTitle(previous) : input.value;
  notesTitleEditing = false;

  if (!save) {
    const h1 = createNotesTitleElement(previousLabel);
    input.replaceWith(h1);
    return;
  }

  const validationError = validateNotesTitleInput(input.value);
  if (validationError) {
    alertNotesError(validationError);
    notesTitleEditing = true;
    input.focus();
    input.select();
    return;
  }

  const nextName = input.value.trim();
  if (!notesActiveId || !previous) {
    const h1 = createNotesTitleElement(previousLabel);
    input.replaceWith(h1);
    return;
  }

  if (nextName === previousLabel) {
    const h1 = createNotesTitleElement(previousLabel);
    input.replaceWith(h1);
    return;
  }

  try {
    await flushNotesSave({ render: false });
    const updated = await agentResume.notesRename({ noteId: notesActiveId, filename: nextName });
    const idx = notesCache.findIndex((n) => n.noteId === notesActiveId);
    if (idx >= 0) {
      notesCache[idx] = { ...notesCache[idx], ...updated };
    }
    const h1 = createNotesTitleElement(noteDisplayTitle(notesCache[idx] ?? updated));
    input.replaceWith(h1);
    renderNotesPanel();
  } catch (error) {
    notesTitleEditing = true;
    alertNotesError(error);
    input.focus();
    input.select();
  }
}

function beginNotesTitleEdit() {
  if (!notesActiveId || notesTitleEditing || notesCreateBusy) return;
  const titleEl = $("notesEditorTitle");
  if (!titleEl || titleEl.classList.contains("notes-detail-title-input")) return;
  const note = notesCache.find((n) => n.noteId === notesActiveId);
  if (!note) return;

  notesTitleEditing = true;
  notesTitleEditCancelled = false;
  const input = document.createElement("input");
  input.type = "text";
  input.className = "notes-detail-title notes-detail-title-input";
  input.id = "notesEditorTitle";
  input.value = noteDisplayTitle(note);
  input.setAttribute("aria-label", "笔记标题");
  input.spellcheck = false;

  titleEl.replaceWith(input);
  input.focus();
  input.select();

  input.addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
      e.preventDefault();
      void finishNotesTitleEdit(true);
    } else if (e.key === "Escape") {
      e.preventDefault();
      notesTitleEditCancelled = true;
      void finishNotesTitleEdit(false);
    }
  });
  input.addEventListener("blur", () => {
    if (notesTitleEditCancelled) {
      notesTitleEditCancelled = false;
      return;
    }
    void finishNotesTitleEdit(true);
  });
}

function notesFolderKey(folder) {
  if (folder.kind === "all") return "all";
  if (folder.kind === "library") return "library";
  if (folder.kind === "project") return `project:${folder.projectPath}`;
  return `session:${folder.provider}:${folder.sessionId}`;
}

function isSameNotesFolder(a, b) {
  return notesFolderKey(a) === notesFolderKey(b);
}

function selectNotesFolder(folder) {
  notesSelectedFolder = folder;
  saveNotesFolderState();
  renderNotesPanel();
}

function alertNotesError(error) {
  const message = error instanceof Error ? error.message : String(error ?? "未知错误");
  window.alert(message);
}

function noteDeleteConfirmText(note) {
  return `删除笔记「${note.filename}」？将同时删除其 assets 文件夹。`;
}

function notesRelativeTime(ms) {
  const diff = Date.now() - ms;
  if (diff < 60_000) return "刚刚";
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)} 分钟前`;
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)} 小时前`;
  if (diff < 604_800_000) return `${Math.floor(diff / 86_400_000)} 天前`;
  try {
    return new Date(ms).toLocaleDateString();
  } catch {
    return "";
  }
}

function filterNotesBySearch(notes) {
  if (!notesSearch.trim()) return notes;
  const q = notesSearch.trim().toLowerCase();
  const sessionsByKey = new Map(sessionsCache.map((s) => [`${s.provider}:${s.id}`, s]));
  return notes.filter((note) => {
    const session =
      note.provider && note.agentSessionId
        ? sessionsByKey.get(`${note.provider}:${note.agentSessionId}`)
        : undefined;
    const haystack = [
      note.filename,
      note.title,
      note.contentPreview,
      note.projectPath,
      note.projectPath ? basename(note.projectPath) : undefined,
      note.provider,
      note.agentSessionId,
      session?.title
    ]
      .filter(Boolean)
      .join("\n")
      .toLowerCase();
    return haystack.includes(q);
  });
}

function filterNotesByFolder(notes) {
  if (notesSelectedFolder.kind === "all") return notes;
  if (notesSelectedFolder.kind === "library") {
    return notes.filter((n) => n.scope === "library");
  }
  if (notesSelectedFolder.kind === "project") {
    return notes.filter((n) => n.scope === "project" && n.projectPath === notesSelectedFolder.projectPath);
  }
  return notes.filter(
    (n) =>
      n.scope === "session" &&
      n.provider === notesSelectedFolder.provider &&
      n.agentSessionId === notesSelectedFolder.sessionId
  );
}

/** Notes list order: most recently updated first (`updatedAtMs` descending). */
function visibleNotesList() {
  return filterNotesBySearch(filterNotesByFolder(notesCache)).sort((a, b) => b.updatedAtMs - a.updatedAtMs);
}

function ownerFromSelectedFolder() {
  if (notesSelectedFolder.kind === "library") {
    return { scope: "library" };
  }
  if (notesSelectedFolder.kind === "project") {
    return { scope: "project", projectPath: notesSelectedFolder.projectPath };
  }
  if (notesSelectedFolder.kind === "session") {
    const note = notesCache.find(
      (n) =>
        n.scope === "session" &&
        n.provider === notesSelectedFolder.provider &&
        n.agentSessionId === notesSelectedFolder.sessionId
    );
    return {
      scope: "session",
      provider: notesSelectedFolder.provider,
      sessionId: notesSelectedFolder.sessionId,
      projectPath: note?.projectPath
    };
  }
  return null;
}

function resolveNoteOwner(contextNode) {
  return ownerFromContextNode(contextNode ?? notesContextNode) || ownerFromSelectedFolder() || null;
}

function selectNotesFolderForOwner(owner) {
  if (owner.scope === "library") {
    selectNotesFolder({ kind: "library" });
    return;
  }
  if (owner.scope === "project" && owner.projectPath) {
    selectNotesFolder({ kind: "project", projectPath: owner.projectPath });
    return;
  }
  if (owner.scope === "session" && owner.provider && owner.sessionId) {
    selectNotesFolder({
      kind: "session",
      provider: owner.provider,
      sessionId: owner.sessionId
    });
  }
}

function updateNotesToolbarState() {
  const canDelete = Boolean(notesActiveId) && !notesCreateBusy;
  const deleteBtn = $("btnNotesDelete");
  if (deleteBtn) {
    deleteBtn.toggleAttribute("disabled", !canDelete);
  }
}

function setNotesCreateBusy(busy) {
  notesCreateBusy = busy;
  $("btnNotesNew")?.toggleAttribute("disabled", busy);
  $("btnNotesImport")?.toggleAttribute("disabled", busy);
  $("btnNotesNew")?.classList.toggle("is-busy", busy);
  $("btnNotesImport")?.classList.toggle("is-busy", busy);
  updateNotesToolbarState();
  updateWorkbenchToolbarState();
}

async function createNoteWithOwner(owner) {
  setNotesCreateBusy(true);
  try {
    await flushNotesSave();
    const created = await agentResume.notesCreate(owner);
    selectNotesFolderForOwner(owner);
    await loadNotes();
    await openNoteInEditor(created.noteId);
    setNotesViewMode("edit");
    focusNotesEditor();
    return created;
  } catch (error) {
    alertNotesError(error);
  } finally {
    setNotesCreateBusy(false);
  }
}

async function importNotesWithOwner(owner) {
  setNotesCreateBusy(true);
  try {
    const result = await agentResume.notesImport(owner);
    if (result.imported > 0) {
      selectNotesFolderForOwner(owner);
      await loadNotes();
      const imported = notesCache
        .filter((n) => {
          if (owner.scope === "library") {
            return n.scope === "library";
          }
          if (owner.scope === "project") {
            return n.scope === "project" && n.projectPath === owner.projectPath;
          }
          return (
            n.scope === "session" &&
            n.provider === owner.provider &&
            n.agentSessionId === owner.sessionId
          );
        })
        .sort((a, b) => b.updatedAtMs - a.updatedAtMs);
      if (result.imported === 1 && imported[0]) {
        await openNoteInEditor(imported[0].noteId);
      }
    } else if (result.errors?.length) {
      alertNotesError(result.errors[0]);
    }
    return result;
  } catch (error) {
    alertNotesError(error);
  } finally {
    setNotesCreateBusy(false);
  }
}

function hideNotesTargetPopover() {
  const pop = $("notesTargetPopover");
  if (pop) pop.hidden = true;
}

function renderNotesTargetList() {
  const list = $("notesTargetList");
  if (!list) return;
  list.innerHTML = "";
  const q = notesTargetPopoverSearch.trim().toLowerCase();

  if (notesTargetPopoverKind === "library") {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "notes-target-item";
    btn.textContent = "独立笔记区";
    btn.title = "不关联项目或会话的个人笔记";
    btn.addEventListener("click", () => void pickNotesTarget({ scope: "library" }));
    list.appendChild(btn);
    return;
  }

  if (notesTargetPopoverKind === "project") {
    const projects = [...new Set(sessionsCache.map((s) => s.projectPath).filter(Boolean))].sort();
    const filtered = projects.filter(
      (p) => !q || basename(p).toLowerCase().includes(q) || p.toLowerCase().includes(q)
    );
    if (!filtered.length) {
      const empty = document.createElement("p");
      empty.className = "muted notes-target-empty";
      empty.textContent = "暂无可用项目，请先同步 Sessions";
      list.appendChild(empty);
      return;
    }
    for (const projectPath of filtered) {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "notes-target-item";
      btn.textContent = basename(projectPath);
      btn.title = projectPath;
      btn.addEventListener("click", () => void pickNotesTarget({ scope: "project", projectPath }));
      list.appendChild(btn);
    }
    return;
  }

  const sorted = [...sessionsCache].sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
  const filtered = sorted.filter((s) => {
    if (!q) return true;
    const hay = [s.title, s.id, s.provider, s.projectPath, basename(s.projectPath)]
      .filter(Boolean)
      .join("\n")
      .toLowerCase();
    return hay.includes(q);
  });
  if (!filtered.length) {
    const empty = document.createElement("p");
    empty.className = "muted notes-target-empty";
    empty.textContent = "暂无可用会话，请先同步 Sessions";
    list.appendChild(empty);
    return;
  }
  for (const s of filtered.slice(0, 500)) {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "notes-target-item";
    btn.textContent = `${s.title || s.id} · ${s.provider}`;
    btn.title = [s.provider, s.projectPath].filter(Boolean).join(" · ");
    btn.addEventListener("click", () =>
      void pickNotesTarget({
        scope: "session",
        provider: s.provider,
        sessionId: s.id,
        projectPath: s.projectPath
      })
    );
    list.appendChild(btn);
  }
}

function openNotesTargetPopover(mode, { noteId = "" } = {}) {
  notesTargetPopoverMode = mode;
  notesTargetPopoverKind = "library";
  notesTargetPopoverSearch = "";
  notesMoveNoteId = noteId;
  const search = $("notesTargetSearch");
  if (search) search.value = "";
  const pop = $("notesTargetPopover");
  if (pop) pop.hidden = false;
  $("notesTargetPopover")?.querySelectorAll("[data-target-kind]").forEach((btn) => {
    btn.classList.toggle("active", btn.dataset.targetKind === "library");
  });
  renderNotesTargetList();
  if (notesTargetPopoverKind !== "library") {
    search?.focus();
  }
}

async function moveNoteWithOwner(noteId, owner) {
  if (!noteId) return;
  setNotesCreateBusy(true);
  try {
    await flushNotesSave();
    const updated = await agentResume.notesMove({ noteId, owner });
    selectNotesFolderForOwner(owner);
    await loadNotes();
    await openNoteInEditor(updated.noteId);
  } catch (error) {
    alertNotesError(error);
  } finally {
    setNotesCreateBusy(false);
    notesMoveNoteId = "";
  }
}

async function pickNotesTarget(owner) {
  hideNotesTargetPopover();
  if (notesTargetPopoverMode === "move") {
    await moveNoteWithOwner(notesMoveNoteId, owner);
    return;
  }
  if (notesTargetPopoverMode === "import") {
    await importNotesWithOwner(owner);
  } else {
    await createNoteWithOwner(owner);
  }
}

async function handleNotesNewClick() {
  if (notesCreateBusy) return;
  const owner = resolveNoteOwner();
  if (owner) {
    await createNoteWithOwner(owner);
    return;
  }
  openNotesTargetPopover("create");
}

async function handleNotesImportClick() {
  if (notesCreateBusy) return;
  const owner = resolveNoteOwner();
  if (owner) {
    await importNotesWithOwner(owner);
    return;
  }
  openNotesTargetPopover("import");
}

function renderNotesPanel() {
  renderNotesFolders();
  renderNotesList();
}

function renderNotesFolderRow(label, folder, options = {}) {
  const btn = document.createElement("button");
  btn.type = "button";
  btn.className = "notes-folder-row";
  if (isSameNotesFolder(notesSelectedFolder, folder)) btn.classList.add("active");
  const isPinned = folder.kind === "project" && isProjectPinned(folder.projectPath);
  if (isPinned) btn.classList.add("is-pinned");
  const inner =
    folder.kind === "project" && folder.projectPath
      ? `${isPinned ? projectPinIconHtml() : ""}${projectFolderRowInnerHtml("notes", folder.projectPath, options)}`
      : `
    <span class="notes-folder-row-label" title="${escapeHtml(options.title || label)}">${escapeHtml(label)}</span>
    ${options.count != null ? `<span class="notes-folder-row-count">${options.count}</span>` : ""}
  `;
  btn.innerHTML = inner;
  btn.addEventListener("click", () => selectNotesFolder(folder));
  if (options.context) {
    btn.addEventListener("contextmenu", (e) => {
      e.preventDefault();
      showNotesContextMenu(e, options.context);
    });
  }
  return btn;
}

function renderNotesFolders() {
  const host = $("notesFolders");
  if (!host) return;
  host.innerHTML = "";

  const sessionsByKey = new Map(sessionsCache.map((s) => [`${s.provider}:${s.id}`, s]));
  const searched = filterNotesBySearch(notesCache);

  const allBtn = renderNotesFolderRow("全部笔记", { kind: "all" }, { count: searched.length });
  host.appendChild(allBtn);

  const libraryNotes = searched
    .filter((n) => n.scope === "library")
    .sort((a, b) => b.updatedAtMs - a.updatedAtMs);
  const librarySection = document.createElement("div");
  librarySection.className = "notes-folder-section";
  librarySection.innerHTML = `<div class="notes-folder-section-label">独立笔记</div>`;
  librarySection.appendChild(
    renderNotesFolderRow("独立笔记区", { kind: "library" }, {
      title: "不关联项目或会话的个人笔记",
      count: libraryNotes.length,
      context: { kind: "library", notes: libraryNotes }
    })
  );
  host.appendChild(librarySection);

  const byProject = new Map();
  for (const note of notesCache) {
    if (note.scope !== "project" || !note.projectPath) continue;
    const list = byProject.get(note.projectPath) ?? [];
    list.push(note);
    byProject.set(note.projectPath, list);
  }
  const projectGroups = [...byProject.entries()]
    .map(([projectPath, projectNotes]) => ({
      projectPath,
      notes: projectNotes.sort((a, b) => b.updatedAtMs - a.updatedAtMs)
    }))
    .sort((a, b) => {
      const pinnedDiff = Number(isProjectPinned(b.projectPath)) - Number(isProjectPinned(a.projectPath));
      return pinnedDiff ||
        (b.notes[0]?.updatedAtMs ?? 0) - (a.notes[0]?.updatedAtMs ?? 0) ||
        a.projectPath.localeCompare(b.projectPath);
    });

  if (projectGroups.length) {
    const section = document.createElement("div");
    section.className = "notes-folder-section";
    section.innerHTML = `<div class="notes-folder-section-label">项目</div>`;
    for (const group of projectGroups) {
      const folder = { kind: "project", projectPath: group.projectPath };
      section.appendChild(
        renderNotesFolderRow(projectDisplayTitle(group.projectPath), folder, {
          title: group.projectPath,
          count: group.notes.length,
          context: { kind: "project", projectPath: group.projectPath, notes: group.notes }
        })
      );
    }
    host.appendChild(section);
  }

  const bySession = new Map();
  for (const note of notesCache) {
    if (note.scope !== "session" || !note.provider || !note.agentSessionId) continue;
    const key = `${note.provider}:${note.agentSessionId}`;
    const list = bySession.get(key) ?? [];
    list.push(note);
    bySession.set(key, list);
  }
  const sessionGroups = [...bySession.entries()]
    .map(([key, sessionNotes]) => {
      const [provider, sessionId] = key.split(/:(.*)/);
      const session = sessionsByKey.get(key);
      return {
        provider,
        sessionId,
        projectPath: sessionNotes[0]?.projectPath ?? session?.projectPath,
        title: session?.title,
        notes: sessionNotes.sort((a, b) => b.updatedAtMs - a.updatedAtMs)
      };
    })
    .sort((a, b) => (b.notes[0]?.updatedAtMs ?? 0) - (a.notes[0]?.updatedAtMs ?? 0));

  if (sessionGroups.length) {
    const section = document.createElement("div");
    section.className = "notes-folder-section";
    section.innerHTML = `<div class="notes-folder-section-label">会话</div>`;
    for (const group of sessionGroups) {
      const label =
        sessionsByKey.get(`${group.provider}:${group.sessionId}`)?.title || group.title || group.sessionId;
      const folder = { kind: "session", provider: group.provider, sessionId: group.sessionId };
      const desc = [group.provider, group.projectPath ? basename(group.projectPath) : ""].filter(Boolean).join(" · ");
      section.appendChild(
        renderNotesFolderRow(label, folder, {
          title: desc || label,
          count: group.notes.length,
          context: { kind: "session", ...group }
        })
      );
    }
    host.appendChild(section);
  }

  if (!projectGroups.length && !sessionGroups.length && !notesCache.length) {
    const empty = document.createElement("p");
    empty.className = "muted notes-folders-empty";
    empty.textContent = "暂无文件夹";
    host.appendChild(empty);
  }
}

function renderNotesList() {
  const list = $("notesList");
  const meta = $("notesMeta");
  if (!list) return;

  const notes = visibleNotesList();
  list.innerHTML = "";

  if (meta) {
    const folderLabel =
      notesSelectedFolder.kind === "all"
        ? "全部笔记"
        : notesSelectedFolder.kind === "library"
          ? "独立笔记区"
          : notesSelectedFolder.kind === "project"
            ? basename(notesSelectedFolder.projectPath)
            : notesSelectedFolder.sessionId;
    meta.textContent = notesSearch.trim()
      ? `${folderLabel} · 搜索「${notesSearch.trim()}」· ${notes.length} 条`
      : `${folderLabel} · ${notes.length} 条`;
  }

  if (!notes.length) {
    const empty = document.createElement("p");
    empty.className = "muted notes-list-empty";
    empty.textContent = notesSearch.trim() ? "没有匹配的笔记" : "此文件夹暂无笔记";
    list.appendChild(empty);
    return;
  }

  for (const note of notes) {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "notes-list-item";
    if (note.noteId === notesActiveId) btn.classList.add("active");
    btn.dataset.noteId = note.noteId;
    const preview = (note.contentPreview || "").trim() || "无额外文本";
    btn.innerHTML = `
      <div class="notes-list-item-top">
        <span class="notes-list-item-title">${escapeHtml(noteDisplayTitle(note))}</span>
        <span class="notes-list-item-date">${escapeHtml(notesRelativeTime(note.updatedAtMs))}</span>
      </div>
      <span class="notes-list-item-preview">${escapeHtml(preview)}</span>
    `;
    btn.addEventListener("click", () => void openNoteInEditor(note.noteId));
    btn.addEventListener("contextmenu", (e) => {
      e.preventDefault();
      showNotesContextMenu(e, { kind: "note", note });
    });
    list.appendChild(btn);
  }

  const activeBtn = list.querySelector(`.notes-list-item[data-note-id="${CSS.escape(notesActiveId)}"]`);
  activeBtn?.scrollIntoView({ block: "nearest" });
}

function noteDirFromAbs(absPath) {
  const norm = absPath.replace(/\\/g, "/");
  const idx = norm.lastIndexOf("/");
  return idx >= 0 ? norm.slice(0, idx) : norm;
}

function resolveNoteAssetPath(noteDirAbs, src) {
  const clean = src.trim().replace(/^<|>$/g, "");
  if (!clean || /^[a-z]+:/i.test(clean)) return clean;
  const base = noteDirAbs.replace(/\\/g, "/");
  if (clean.startsWith("/")) return clean;
  if (clean.startsWith("./")) return `${base}/${clean.slice(2)}`;
  if (clean.startsWith("../")) {
    const parts = base.split("/");
    const rel = clean.split("/");
    for (const seg of rel) {
      if (seg === "..") parts.pop();
      else if (seg !== ".") parts.push(seg);
    }
    return parts.join("/");
  }
  return `${base}/${clean}`;
}

function rewriteNoteImagePaths(markdown, noteDirAbs) {
  return String(markdown ?? "").replace(/!\[([^\]]*)\]\(([^)]+)\)/g, (match, alt, src) => {
    const trimmed = src.trim();
    if (/^(https?:|data:|file:)/i.test(trimmed)) return match;
    const resolved = resolveNoteAssetPath(noteDirAbs, trimmed);
    const fileUrl = resolved.startsWith("/") ? `file://${resolved}` : `file:///${resolved}`;
    return `![${alt}](${fileUrl})`;
  });
}

function renderNoteMarkdown(value, noteDirAbs) {
  const source = rewriteNoteImagePaths(String(value ?? ""), noteDirAbs);
  try {
    initMarkdownHighlight();
    if (typeof marked?.parse !== "function" || typeof DOMPurify?.sanitize !== "function") {
      throw new Error("Markdown renderer is unavailable");
    }
    const parsed = marked.parse(source, { gfm: true, breaks: true });
    const sanitized = DOMPurify.sanitize(parsed, {
      USE_PROFILES: { html: true },
      FORBID_TAGS: ["script", "style", "iframe", "object", "embed"],
      FORBID_ATTR: ["style"],
      ALLOWED_URI_REGEXP: /^(?:(?:https?|file|data):|[^a-z]|[a-z+.\-]+(?:[^a-z+.\-:]|$))/i
    });
    const template = document.createElement("template");
    template.innerHTML = sanitized;
    template.content.querySelectorAll("a[href]").forEach((link) => {
      link.setAttribute("target", "_blank");
      link.setAttribute("rel", "noopener noreferrer");
    });
    return template.innerHTML;
  } catch {
    return `<pre class="markdown-fallback">${escapeHtml(source)}</pre>`;
  }
}

function updateNotesPreview(content, noteAbsPath) {
  const preview = $("notesPreview");
  if (!preview) return;
  const dir = noteDirFromAbs(noteAbsPath || "");
  preview.innerHTML = renderNoteMarkdown(content, dir);
  enhanceNotesPreviewImages(preview);
}

function enhanceNotesPreviewImages(preview) {
  preview.querySelectorAll("img").forEach((img) => {
    img.tabIndex = 0;
    img.setAttribute("role", "button");
    img.title = "点击放大";
  });
}

function openNotesImagePreview(img) {
  const overlay = $("notesImagePreview");
  const previewImg = $("notesImagePreviewImg");
  if (!overlay || !previewImg) return;
  previewImg.src = img.currentSrc || img.src;
  previewImg.alt = img.alt || "";
  overlay.hidden = false;
  document.body.classList.add("notes-image-preview-open");
  $("btnNotesImagePreviewClose")?.focus();
}

function closeNotesImagePreview() {
  const overlay = $("notesImagePreview");
  const previewImg = $("notesImagePreviewImg");
  if (!overlay || overlay.hidden) return;
  overlay.hidden = true;
  if (previewImg) previewImg.removeAttribute("src");
  document.body.classList.remove("notes-image-preview-open");
}

function isNotesImagePreviewOpen() {
  const overlay = $("notesImagePreview");
  return Boolean(overlay && !overlay.hidden);
}

function getNotesEditorContent() {
  if (notesCmView && typeof NotesCodeMirror?.getValue === "function") {
    return NotesCodeMirror.getValue(notesCmView);
  }
  return "";
}

function setNotesEditorContent(text) {
  mountNotesEditor();
  if (notesCmView && typeof NotesCodeMirror?.setValue === "function") {
    notesSuppressEditorChange = true;
    try {
      NotesCodeMirror.setValue(notesCmView, text ?? "");
    } finally {
      notesSuppressEditorChange = false;
    }
  }
}

function focusNotesEditor() {
  if (notesCmView && typeof NotesCodeMirror?.focus === "function") {
    NotesCodeMirror.focus(notesCmView);
  }
}

function getNotesEditorSelectionText() {
  if (notesCmView && typeof NotesCodeMirror?.getSelectedText === "function") {
    return NotesCodeMirror.getSelectedText(notesCmView);
  }
  return "";
}

function selectNotesEditorRange(from, to, options = {}) {
  if (notesCmView && typeof NotesCodeMirror?.selectRange === "function") {
    NotesCodeMirror.selectRange(notesCmView, from, to, options);
  }
}

function clearNotesFindHighlight() {
  if (notesCmView && typeof NotesCodeMirror?.clearFindHighlight === "function") {
    NotesCodeMirror.clearFindHighlight(notesCmView);
  }
}

function isFindShortcut(event) {
  return (event.metaKey || event.ctrlKey) && !event.altKey && event.key?.toLowerCase() === "f";
}

function canOpenNotesFind() {
  return isNotesActive() && Boolean(notesActiveId) && notesViewShowsEditor();
}

function findNotesMatches(query) {
  const needle = query.trim();
  if (!needle) return [];
  const content = getNotesEditorContent();
  const haystack = content.toLowerCase();
  const lowerNeedle = needle.toLowerCase();
  const matches = [];
  let from = haystack.indexOf(lowerNeedle);
  while (from !== -1) {
    matches.push({ from, to: from + needle.length });
    from = haystack.indexOf(lowerNeedle, from + Math.max(needle.length, 1));
  }
  return matches;
}

function updateNotesFindCount() {
  const count = $("notesFindCount");
  if (!count) return;
  if (!notesFindQuery.trim()) {
    count.textContent = "0/0";
    count.classList.remove("is-empty");
    clearNotesFindHighlight();
    return;
  }
  if (!notesFindMatches.length) {
    count.textContent = "0/0";
    count.classList.add("is-empty");
    clearNotesFindHighlight();
    return;
  }
  count.textContent = `${notesFindIndex + 1}/${notesFindMatches.length}`;
  count.classList.remove("is-empty");
}

function selectNotesFindMatch(index, options = {}) {
  if (!notesFindMatches.length) {
    notesFindIndex = -1;
    updateNotesFindCount();
    return;
  }
  notesFindIndex = ((index % notesFindMatches.length) + notesFindMatches.length) % notesFindMatches.length;
  const match = notesFindMatches[notesFindIndex];
  selectNotesEditorRange(match.from, match.to, options);
  updateNotesFindCount();
}

function updateNotesFindResults({ select = false } = {}) {
  notesFindQuery = $("notesFindInput")?.value ?? "";
  notesFindMatches = findNotesMatches(notesFindQuery);
  notesFindIndex = notesFindMatches.length ? Math.min(Math.max(notesFindIndex, 0), notesFindMatches.length - 1) : -1;
  if (select && notesFindMatches.length) {
    selectNotesFindMatch(notesFindIndex >= 0 ? notesFindIndex : 0, { focus: false });
  } else {
    updateNotesFindCount();
  }
}

function openNotesFind() {
  if (!canOpenNotesFind()) return;
  notesFindOpen = true;
  const bar = $("notesFindBar");
  const input = $("notesFindInput");
  if (bar) bar.hidden = false;
  if (!input) return;
  const selected = getNotesEditorSelectionText().trim();
  if (selected && !selected.includes("\n")) {
    input.value = selected;
  }
  updateNotesFindResults({ select: Boolean(input.value.trim()) });
  input.focus();
  input.select();
}

function closeNotesFind({ focusEditor = true } = {}) {
  notesFindOpen = false;
  notesFindMatches = [];
  notesFindIndex = -1;
  const bar = $("notesFindBar");
  if (bar) bar.hidden = true;
  clearNotesFindHighlight();
  updateNotesFindCount();
  if (focusEditor) focusNotesEditor();
}

function navigateNotesFind(delta, options = {}) {
  if (!notesFindOpen) openNotesFind();
  updateNotesFindResults();
  if (!notesFindMatches.length) return;
  selectNotesFindMatch(notesFindIndex + delta, options);
}

function onNotesEditorChange() {
  if (notesSuppressEditorChange || !notesViewShowsEditor()) return;
  notesDirty = true;
  scheduleNotesSave();
  if (notesFindOpen) updateNotesFindResults();
}

function mountNotesEditor() {
  const host = $("notesEditorHost");
  if (!host || notesCmView || typeof NotesCodeMirror?.mount !== "function") return;
  notesCmView = NotesCodeMirror.mount(host, {
    value: "",
    placeholder: "编辑 Markdown…（⌘V 可粘贴图片）",
    onChange: onNotesEditorChange,
    onPasteImage: tryHandleNotesImagePaste
  });
}

function tryHandleNotesImagePaste(event) {
  if (!notesActiveId || !notesViewShowsEditor()) return false;
  if (typeof agentResume.notesClipboardHasImage !== "function" || !agentResume.notesClipboardHasImage()) {
    return false;
  }
  event.preventDefault();
  void handleNotesImagePasteAsync();
  return true;
}

function insertNoteImageSnippet(snippet) {
  mountNotesEditor();
  if (!notesCmView || typeof NotesCodeMirror?.insertAtCursor !== "function") return;
  NotesCodeMirror.insertAtCursor(notesCmView, snippet);
  notesDirty = true;
  scheduleNotesSave();
}

async function handleNotesImagePasteAsync() {
  try {
    const result = await agentResume.notesPasteImage({ noteId: notesActiveId });
    if (!result?.snippet) return;
    insertNoteImageSnippet(result.snippet);
  } catch (error) {
    alertNotesError(error);
  }
}

function refreshNotesPreviewFromEditor() {
  const note = notesCache.find((n) => n.noteId === notesActiveId);
  const noteAbs = note && notesPanelHome ? `${notesPanelHome.replace(/\/$/, "")}/${note.relMdPath}` : "";
  updateNotesPreview(getNotesEditorContent(), noteAbs);
}

function notesViewShowsEditor(mode = notesViewMode) {
  return mode === "edit";
}

function renderNotesViewMode() {
  const layout = $("notesEditorLayout");
  const segmented = $("notesViewSegmented");
  if (layout) {
    layout.classList.toggle("mode-edit", notesViewMode === "edit");
    layout.classList.toggle("mode-view", notesViewMode === "view");
  }
  segmented?.querySelectorAll("[data-mode]").forEach((btn) => {
    const active = btn.dataset.mode === notesViewMode;
    btn.classList.toggle("active", active);
    btn.setAttribute("aria-selected", active ? "true" : "false");
  });
}

function setNotesViewMode(mode) {
  notesViewMode = mode === "view" ? "view" : "edit";
  renderNotesViewMode();
  if (!notesViewShowsEditor()) closeNotesFind({ focusEditor: false });
}

async function switchNotesViewMode(mode) {
  if (mode === notesViewMode) return;
  if (mode === "view") {
    await flushNotesSave();
    refreshNotesPreviewFromEditor();
  }
  setNotesViewMode(mode);
  if (mode === "edit") {
    focusNotesEditor();
  }
}

function showNotesEditor(show) {
  const shell = $("notesEditorShell");
  const empty = $("notesEmptyState");
  if (shell) shell.hidden = !show;
  if (empty) empty.hidden = show;
  if (!show) {
    cancelNotesTitleEdit();
    closeNotesFind({ focusEditor: false });
    notesActiveId = "";
    notesDirty = false;
  }
  if (show) renderNotesViewMode();
  updateNotesToolbarState();
}

function shouldKeepNotesSelection(target) {
  return Boolean(
    target.closest(".notes-list-item") ||
      target.closest("#notesEditorShell") ||
      target.closest(".notes-list-toolbar") ||
      target.closest("#notesTargetPopover") ||
      target.closest("#notesContextMenu")
  );
}

async function clearNotesSelection() {
  if (!notesActiveId) return;
  if (notesDirty) {
    await flushNotesSave({ render: false });
  }
  showNotesEditor(false);
  setNotesEditorContent("");
  renderNotesList();
}

async function deleteNoteById(noteId) {
  if (!noteId) return;
  const note = notesCache.find((n) => n.noteId === noteId);
  if (!note) return;
  const ok = confirm(noteDeleteConfirmText(note));
  if (!ok) return;
  try {
    if (notesActiveId && notesActiveId !== note.noteId) {
      await flushNotesSave({ render: false });
    } else if (notesSaveTimer) {
      clearTimeout(notesSaveTimer);
      notesSaveTimer = null;
    }
    await agentResume.notesDelete({ noteId: note.noteId });
    if (notesActiveId === note.noteId) {
      notesActiveId = "";
      notesDirty = false;
      showNotesEditor(false);
      setNotesEditorContent("");
    }
    await loadNotes();
  } catch (error) {
    alertNotesError(error);
  }
}

async function deleteActiveNote() {
  await deleteNoteById(notesActiveId);
}

async function openNoteInEditor(noteId) {
  if (notesDirty && notesActiveId && notesActiveId !== noteId) {
    await flushNotesSave({ render: false });
  }
  notesActiveId = noteId;
  updateNotesToolbarState();
  renderNotesList();

  try {
    const { record, content } = await agentResume.notesRead({ noteId });
    notesActiveId = record.noteId;
    notesDirty = false;
    setNotesEditorContent(content);
    setNotesEditorTitleText(record);
    const noteAbs = notesPanelHome ? `${notesPanelHome.replace(/\/$/, "")}/${record.relMdPath}` : "";
    updateNotesPreview(content, noteAbs);
    showNotesEditor(true);
    renderNotesPanel();
    updateNotesToolbarState();
  } catch (error) {
    notesActiveId = "";
    updateNotesToolbarState();
    alertNotesError(error);
  }
}

function scheduleNotesSave() {
  if (notesSaveTimer) clearTimeout(notesSaveTimer);
  notesSaveTimer = setTimeout(() => void flushNotesSave(), 800);
}

async function flushNotesSave({ render = true } = {}) {
  if (notesSaveTimer) {
    clearTimeout(notesSaveTimer);
    notesSaveTimer = null;
  }
  if (!notesDirty || !notesActiveId) return;
  const saveId = notesActiveId;
  const content = getNotesEditorContent();
  try {
    const updated = await agentResume.notesWrite({ noteId: saveId, content });
    notesDirty = false;
    const idx = notesCache.findIndex((n) => n.noteId === saveId);
    if (idx >= 0) {
      notesCache[idx] = { ...notesCache[idx], ...updated };
    }
    if (render) renderNotesPanel();
  } catch (error) {
    notesDirty = true;
    alertNotesError(error);
    throw error;
  }
}

async function loadNotes() {
  try {
    if (!notesPanelHome) {
      notesPanelHome = await agentResume.getPanelHome();
    }
    refreshPinnedProjects();
    await refreshProjectAliases();
    notesCache = await agentResume.notesList();
    notesLoaded = true;
    renderNotesPanel();
  } catch (error) {
    alertNotesError(error);
  }
}

async function ensureNotesVisible() {
  loadNotesFolderState();
  refreshPinnedProjects();
  if (!sessionsCache.length) {
    try {
      sessionsCache = await agentResume.listSessions(2000);
    } catch {
      // keep existing cache
    }
  }
  await loadNotes();
}

function hideNotesContextMenu() {
  const menu = $("notesContextMenu");
  if (menu) menu.hidden = true;
  notesContextNode = null;
}

function showNotesContextMenu(event, node) {
  notesContextNode = node;
  const menu = $("notesContextMenu");
  if (!menu) return;
  const isNote = node.kind === "note";
  const isGroup = node.kind === "library" || node.kind === "project" || node.kind === "session";
  const canMove = isNote && node.note?.filename !== "todolist.md";
  const isProject = node.kind === "project";
  menu.querySelector('[data-notes-action="pinProject"]').hidden = !isProject || isProjectPinned(node.projectPath);
  menu.querySelector('[data-notes-action="unpinProject"]').hidden = !isProject || !isProjectPinned(node.projectPath);
  menu.querySelector('[data-notes-action="new"]').hidden = !isGroup;
  menu.querySelector('[data-notes-action="import"]').hidden = !isGroup;
  menu.querySelector('[data-notes-action="renameProject"]').hidden = !isProject;
  menu.querySelector('[data-notes-action="move"]').hidden = !canMove;
  menu.querySelector('[data-notes-action="copyPath"]').hidden = !isNote;
  menu.querySelector('[data-notes-action="reveal"]').hidden = !isNote;
  menu.querySelector('[data-notes-action="delete"]').hidden = !isNote;
  menu.hidden = false;
  const x = Math.min(event.clientX, window.innerWidth - 200);
  const y = Math.min(event.clientY, window.innerHeight - 220);
  menu.style.left = `${x}px`;
  menu.style.top = `${y}px`;
}

function ownerFromContextNode(node) {
  if (!node) return null;
  if (node.kind === "library") {
    return { scope: "library" };
  }
  if (node.kind === "project") {
    return { scope: "project", projectPath: node.projectPath };
  }
  if (node.kind === "session") {
    return {
      scope: "session",
      provider: node.provider,
      sessionId: node.sessionId,
      projectPath: node.projectPath
    };
  }
  if (node.kind === "note" && node.note) {
    const n = node.note;
    if (n.scope === "library") {
      return { scope: "library" };
    }
    if (n.scope === "project" && n.projectPath) {
      return { scope: "project", projectPath: n.projectPath };
    }
    if (n.scope === "session" && n.provider && n.agentSessionId) {
      return {
        scope: "session",
        provider: n.provider,
        sessionId: n.agentSessionId,
        projectPath: n.projectPath
      };
    }
  }
  return null;
}

async function handleNotesContextAction(action) {
  const node = notesContextNode;
  hideNotesContextMenu();
  try {
    if (action === "new") {
      const owner = ownerFromContextNode(node);
      if (owner) await createNoteWithOwner(owner);
      return;
    }
    if (action === "renameProject" && node?.kind === "project" && node.projectPath) {
      await promptRenameProject(node.projectPath);
      return;
    }
    if (action === "pinProject" && node?.kind === "project" && node.projectPath) {
      setProjectPinned(node.projectPath, true);
      return;
    }
    if (action === "unpinProject" && node?.kind === "project" && node.projectPath) {
      setProjectPinned(node.projectPath, false);
      return;
    }
    if (action === "import") {
      const owner = ownerFromContextNode(node);
      if (owner) await importNotesWithOwner(owner);
      return;
    }
    if (action === "move" && node?.kind === "note") {
      openNotesTargetPopover("move", { noteId: node.note.noteId });
      return;
    }
    if (action === "copyPath" && node?.kind === "note") {
      await agentResume.notesCopyPath({ noteId: node.note.noteId });
      return;
    }
    if (action === "reveal" && node?.kind === "note") {
      await agentResume.notesReveal({ noteId: node.note.noteId });
      return;
    }
    if (action === "delete" && node?.kind === "note") {
      await deleteNoteById(node.note.noteId);
    }
  } catch (error) {
    alertNotesError(error);
  }
}

function openSheet(id) {
  const el = $(id);
  if (el) el.hidden = false;
  if (id === "sheetSessions") {
    loadSessions();
    startSessionsAutoRefresh();
  }
}

function closeSheet(id) {
  if (id === "sheetGtd") {
    snapshotGtdCache();
  }
  const el = $(id);
  if (el) el.hidden = true;
  if (id === "sheetSessions") {
    stopSessionsAutoRefresh();
  }
}

function closeAllSheets() {
  snapshotGtdCache();
  document.querySelectorAll(".sheet").forEach((el) => {
    el.hidden = true;
  });
  stopSessionsAutoRefresh();
}



/** @type {{ year: number, month: number }} month is 0-based */
let calView = (() => {
  const n = new Date();
  return { year: n.getFullYear(), month: n.getMonth() };
})();

/** @type {any[]} */
let calEntries = [];
/** Days in the viewed calendar month that have at least one session. */
let calMonthSessionDays = new Set();
/** Days whose daily digest is stale (new/updated sessions since digest). */
let calDayStaleMap = new Map();
/** Weeks / months whose digest is stale. */
let calWeekStaleMap = new Map();
let calMonthStaleMap = new Map();
/** @type {string | null} YYYY-MM-DD */
let selectedDayKey = null;
/** @type {{ type: 'day'|'week'|'month', key: string } | null} */
let detailFocus = null;
/** @type {"digest"|"session"} */
let calDetailMode = "digest";
/** @type {{ provider: string, id: string } | null} */
let calDetailSessionKey = null;
/** Week / month key currently generating (for button loading). */
let generatingPeriodKey = null;

function pad2(n) {
  return String(n).padStart(2, "0");
}

/** ISO week label YYYY-Www from a local Date (Mon-based week). */
function isoWeekLabelFromDate(date) {
  const d = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  const day = d.getDay() || 7;
  d.setDate(d.getDate() + 4 - day);
  const yearStart = new Date(d.getFullYear(), 0, 1);
  const week = Math.ceil(((d.getTime() - yearStart.getTime()) / 86400000 + 1) / 7);
  return `${d.getFullYear()}-W${pad2(week)}`;
}

/** Active calendar selection → day / week / month keys. Default: today. */
function getActivePeriods() {
  const day = selectedDayKey || todayInputValue();
  const [y, m, d] = day.split("-").map(Number);
  const date = new Date(y, m - 1, d, 12, 0, 0, 0);
  return {
    day,
    week: isoWeekLabelFromDate(date),
    month: `${y}-${pad2(m)}`
  };
}

function updatePeriodLabel() {
  // Period chrome lived in gen-panel (removed); keep hook for callers.
}

function dayKeyFromDate(d) {
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
}

/** Compare a valid YYYY-MM-DD key against the local calendar day. */
function isFutureDayKey(dayKey, now = new Date()) {
  if (typeof dayKey !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(dayKey)) {
    return false;
  }
  const [year, month, day] = dayKey.split("-").map(Number);
  const parsed = new Date(year, month - 1, day, 12, 0, 0, 0);
  if (
    parsed.getFullYear() !== year ||
    parsed.getMonth() !== month - 1 ||
    parsed.getDate() !== day
  ) {
    return false;
  }
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 12, 0, 0, 0);
  return parsed.getTime() > today.getTime();
}

function dayKeyFromMs(ms) {
  return dayKeyFromDate(new Date(ms));
}

/** @returns {{ fromMs: number, toMs: number } | null} */
function validMsRange(fromMs, toMs) {
  if (!Number.isFinite(fromMs) || !Number.isFinite(toMs) || toMs <= fromMs) {
    return null;
  }
  return { fromMs, toMs };
}

/** Local day range [start, end) for YYYY-MM-DD. */
function dayRangeFromKey(dayKey) {
  if (typeof dayKey !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(dayKey)) {
    return null;
  }
  const [y, m, d] = dayKey.split("-").map(Number);
  if (![y, m, d].every((n) => Number.isFinite(n))) return null;
  const start = new Date(y, m - 1, d, 0, 0, 0, 0);
  const end = new Date(y, m - 1, d + 1, 0, 0, 0, 0);
  return validMsRange(start.getTime(), end.getTime());
}

/** Monday 00:00 of ISO week YYYY-Www (local). */
function mondayOfIsoWeekLabel(weekLabel) {
  const match = /^(\d{4})-W(\d{2})$/i.exec(weekLabel || "");
  if (!match) return null;
  const isoYear = Number(match[1]);
  const isoWeek = Number(match[2]);
  if (!Number.isFinite(isoYear) || !Number.isFinite(isoWeek) || isoWeek < 1 || isoWeek > 53) {
    return null;
  }
  const jan4 = new Date(isoYear, 0, 4, 12, 0, 0, 0);
  const day = jan4.getDay() || 7;
  const monday = new Date(jan4);
  monday.setDate(jan4.getDate() + (1 - day) + (isoWeek - 1) * 7);
  monday.setHours(0, 0, 0, 0);
  if (!Number.isFinite(monday.getTime())) return null;
  return monday;
}

function weekRangeFromKey(weekLabel) {
  const monday = mondayOfIsoWeekLabel(weekLabel);
  if (!monday) return null;
  const next = new Date(monday);
  next.setDate(monday.getDate() + 7);
  return validMsRange(monday.getTime(), next.getTime());
}

function monthRangeFromKey(monthLabel) {
  const match = /^(\d{4})-(\d{2})$/.exec(monthLabel || "");
  if (!match) return null;
  const y = Number(match[1]);
  const m = Number(match[2]);
  if (!Number.isFinite(y) || !Number.isFinite(m) || m < 1 || m > 12) return null;
  const start = new Date(y, m - 1, 1, 0, 0, 0, 0);
  const end = new Date(y, m, 1, 0, 0, 0, 0);
  return validMsRange(start.getTime(), end.getTime());
}

/**
 * Range for current detailFocus (day / week / month).
 * @returns {{ type: string, key: string, fromMs: number, toMs: number } | null}
 */
function focusSessionRange() {
  const focus =
    detailFocus ||
    (selectedDayKey ? { type: "day", key: selectedDayKey } : { type: "month", key: viewMonthLabel() });
  if (!focus || !focus.key) return null;
  if (focus.type === "day") {
    const r = dayRangeFromKey(focus.key);
    if (!r) return null;
    return { type: "day", key: focus.key, ...r };
  }
  if (focus.type === "week") {
    const r = weekRangeFromKey(focus.key);
    if (!r) return null;
    return { type: "week", key: focus.key, ...r };
  }
  if (focus.type === "month") {
    const r = monthRangeFromKey(focus.key);
    if (!r) return null;
    return { type: "month", key: focus.key, ...r };
  }
  return null;
}

function calSessionRowHtml(s) {
  return `
    <button type="button" class="cal-session-row" data-provider="${escapeHtml(
      s.provider
    )}" data-id="${escapeHtml(s.id)}">
      <div class="s-title">${escapeHtml(s.title || s.id)}</div>
      <div class="s-meta">${providerTagHtml(s.provider)} · ${escapeHtml(
        basename(s.projectPath || "")
      )} · ${escapeHtml(formatTime(s.updatedAt))}</div>
    </button>`;
}

/**
 * @param {any[]} sessions
 * @param {"day"|"week"|"month"} type
 */
function buildCalSessionListHtml(sessions, type) {
  if (!sessions.length) {
    return `<p class="muted cal-session-empty">该范围内没有 session</p>`;
  }

  if (type === "day") {
    return sessions.map((s) => calSessionRowHtml(s)).join("");
  }

  // Group by day (YYYY-MM-DD), days descending
  /** @type {Map<string, any[]>} */
  const byDay = new Map();
  for (const s of sessions) {
    const dk = dayKeyFromMs(s.updatedAt);
    if (!byDay.has(dk)) byDay.set(dk, []);
    byDay.get(dk).push(s);
  }
  const days = [...byDay.keys()].sort().reverse();

  if (type === "week") {
    return days
      .map((dk) => {
        const list = byDay.get(dk) || [];
        list.sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
        return `<div class="cal-session-group">
          <div class="cal-session-group-title day">${escapeHtml(dk)} · ${list.length}</div>
          ${list.map((s) => calSessionRowHtml(s)).join("")}
        </div>`;
      })
      .join("");
  }

  // month: week → day
  /** @type {Map<string, string[]>} weekLabel -> day keys */
  const weekDays = new Map();
  for (const dk of days) {
    const [y, m, d] = dk.split("-").map(Number);
    const w = isoWeekLabelFromDate(new Date(y, m - 1, d, 12, 0, 0, 0));
    if (!weekDays.has(w)) weekDays.set(w, []);
    weekDays.get(w).push(dk);
  }
  const weeks = [...weekDays.keys()].sort().reverse();

  return weeks
    .map((w) => {
      const dks = (weekDays.get(w) || []).sort().reverse();
      const weekCount = dks.reduce((n, dk) => n + (byDay.get(dk)?.length || 0), 0);
      const dayBlocks = dks
        .map((dk) => {
          const list = byDay.get(dk) || [];
          list.sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
          return `<div class="cal-session-group">
            <div class="cal-session-group-title day">${escapeHtml(dk)} · ${list.length}</div>
            ${list.map((s) => calSessionRowHtml(s)).join("")}
          </div>`;
        })
        .join("");
      return `<div class="cal-session-group week-block">
        <div class="cal-session-group-title week">${escapeHtml(w)} · ${weekCount}</div>
        ${dayBlocks}
      </div>`;
    })
    .join("");
}

function wireCalSessionListClicks(listEl) {
  if (!listEl) return;
  listEl.querySelectorAll(".cal-session-row").forEach((btn) => {
    btn.addEventListener("click", async () => {
      const provider = btn.dataset.provider;
      const id = btn.dataset.id;
      if (!provider || !id) return;
      const session =
        calSessionCache.find((s) => s.provider === provider && s.id === id) || {
          provider,
          id,
          title: btn.querySelector(".s-title")?.textContent || id,
          projectPath: "",
          updatedAt: 0
        };
      await openCalSessionDetail(session);
    });
  });
  if (calDetailMode === "session" && calDetailSessionKey) {
    highlightCalSessionRow(calDetailSessionKey);
  }
}

/** @type {any[]} */
let calSessionCache = [];
/** @type {string} */
let calSessionListSeq = "";

async function renderCalSessionList(opts = {}) {
  const listEl = $("calSessionList");
  const titleEl = $("calSessionTitle");
  const metaEl = $("calSessionMeta");
  if (!listEl) return;
  const previousScrollTop = listEl.scrollTop;

  const range = focusSessionRange();
  if (!range) {
    delete listEl.dataset.view;
    if (titleEl) titleEl.textContent = "Sessions";
    if (metaEl) metaEl.textContent = "";
    listEl.innerHTML = `<p class="muted cal-session-empty">切换月份或选择日期 / 周后显示 session</p>`;
    calSessionCache = [];
    return;
  }

  listEl.dataset.view = range.type;

  const label =
    range.type === "day" ? `日 ${range.key}` : range.type === "week" ? `周 ${range.key}` : `月 ${range.key}`;
  if (titleEl) titleEl.textContent = `Sessions · ${label}`;
  if (metaEl) metaEl.textContent = "加载中…";

  const seq = `${range.type}:${range.key}:${range.fromMs}:${range.toMs}`;
  calSessionListSeq = seq;

  try {
    const sessions = await agentResume.listSessionsInRange({
      fromMs: range.fromMs,
      toMs: range.toMs,
      limit: 500
    });
    if (calSessionListSeq !== seq) return; // stale
    calSessionCache = sessions || [];
    if (metaEl) metaEl.textContent = `${calSessionCache.length} 条 · 点击预览`;
    listEl.innerHTML = buildCalSessionListHtml(calSessionCache, range.type);
    wireCalSessionListClicks(listEl);
    if (opts.preserveScroll) listEl.scrollTop = previousScrollTop;
    if (detailFocus && !getFocusDigestEntry(detailFocus.type, detailFocus.key)) {
      renderFocusDigestDetail(detailFocus.type, detailFocus.key);
    }
  } catch (error) {
    if (calSessionListSeq !== seq) return;
    calSessionCache = [];
    if (metaEl) metaEl.textContent = "";
    listEl.innerHTML = `<p class="status error">${escapeHtml(
      error instanceof Error ? error.message : String(error)
    )}</p>`;
  }
}

function monthRangeMs(year, month) {
  // pad grid: 7 days before month start, 14 after end
  const start = new Date(year, month, 1, 0, 0, 0, 0);
  start.setDate(start.getDate() - 10);
  const end = new Date(year, month + 1, 1, 0, 0, 0, 0);
  end.setDate(end.getDate() + 14);
  return { fromMs: start.getTime(), toMs: end.getTime() };
}

function entryDayKey(entry) {
  if (entry.level === "daily" && typeof entry.id === "string" && entry.id.startsWith("daily:")) {
    return entry.id.slice("daily:".length);
  }
  return dayKeyFromMs(entry.periodStartMs);
}

function buildDayIndex(entries) {
  /** @type {Record<string, { daily?: any, weeklies: any[], monthlies: any[] }>} */
  const map = {};
  for (const e of entries) {
    const level = e.level || "daily";
    const key = entryDayKey(e);
    if (!map[key]) {
      map[key] = { weeklies: [], monthlies: [] };
    }
    if (level === "daily") {
      map[key].daily = e;
    } else if (level === "weekly") {
      map[key].weeklies.push(e);
    } else if (level === "monthly") {
      map[key].monthlies.push(e);
    }
  }
  return map;
}

function renderEntries(_entries, _scoreById) {
  // Semantic search merged into Ask; list UI removed.
}

/** Year options: current±15, always include calView.year. */
function ensureYearOptions() {
  const sel = $("calYearSelect");
  if (!sel) return;
  const nowY = new Date().getFullYear();
  const minY = Math.min(nowY - 15, calView.year);
  const maxY = Math.max(nowY + 2, calView.year);
  const current = String(calView.year);
  if (sel.options.length && sel.dataset.minY === String(minY) && sel.dataset.maxY === String(maxY)) {
    if (sel.value !== current) sel.value = current;
    return;
  }
  sel.innerHTML = "";
  for (let y = maxY; y >= minY; y--) {
    const opt = document.createElement("option");
    opt.value = String(y);
    opt.textContent = `${y} 年`;
    sel.appendChild(opt);
  }
  sel.dataset.minY = String(minY);
  sel.dataset.maxY = String(maxY);
  sel.value = current;
}

function syncCalPickers() {
  ensureYearOptions();
  const yearSel = $("calYearSelect");
  const monthSel = $("calMonthSelect");
  if (yearSel) yearSel.value = String(calView.year);
  if (monthSel) monthSel.value = String(calView.month);
}

function applyCalPicker() {
  const yearSel = $("calYearSelect");
  const monthSel = $("calMonthSelect");
  if (!yearSel || !monthSel) return;
  const year = Number(yearSel.value);
  const month = Number(monthSel.value);
  if (!Number.isFinite(year) || !Number.isFinite(month)) return;
  if (calView.year === year && calView.month === month) return;
  calView = { year, month };
  focusViewedMonth();
  loadMemory();
}

function currentWeekLabel() {
  return isoWeekLabelFromDate(new Date());
}

function currentMonthLabel() {
  const n = new Date();
  return `${n.getFullYear()}-${pad2(n.getMonth() + 1)}`;
}

function viewMonthLabel() {
  return `${calView.year}-${pad2(calView.month + 1)}`;
}

/** Switch session list + detail to the calendar's viewed month. */
function focusViewedMonth() {
  detailFocus = { type: "month", key: viewMonthLabel() };
  selectedDayKey = null;
  updatePeriodLabel();
}

function hasWeeklyDigest(weekLabel) {
  const id = `weekly:${weekLabel}`;
  return calEntries.some((e) => e.level === "weekly" && (e.id === id || String(e.id).includes(weekLabel)));
}

function hasMonthlyDigest(monthLabel) {
  const id = `monthly:${monthLabel}`;
  return calEntries.some((e) => e.level === "monthly" && (e.id === id || String(e.id).includes(monthLabel)));
}

function getWeeklyEntry(weekLabel) {
  const id = `weekly:${weekLabel}`;
  return calEntries.find((e) => e.level === "weekly" && (e.id === id || String(e.id).includes(weekLabel)));
}

function getMonthlyEntry(monthLabel) {
  const id = `monthly:${monthLabel}`;
  return calEntries.find((e) => e.level === "monthly" && (e.id === id || String(e.id).includes(monthLabel)));
}

function periodKeyFromEntry(entry) {
  const level = entry.level || "daily";
  const idKey = periodKeyFromMemoryId(level, entry.id || "");
  if (level === "daily" && /^\d{4}-\d{2}-\d{2}$/.test(idKey)) return idKey;
  if (level === "weekly" && /^\d{4}-W\d{2}$/i.test(idKey)) return idKey;
  if (level === "monthly" && /^\d{4}-\d{2}$/.test(idKey)) return idKey;

  const start = new Date(entry.periodStartMs);
  if (!Number.isFinite(start.getTime())) return "";
  if (level === "daily") return dayKeyFromDate(start);
  if (level === "weekly") return isoWeekLabelFromDate(start);
  if (level === "monthly") return dayKeyFromDate(start).slice(0, 7);
  return "";
}

function digestCardHtml(e) {
  const emb = e.embeddingJson ? " · embedding ✓" : "";
  const level = e.level || "daily";
  const id = e.id || "";
  const periodKey = periodKeyFromEntry(e);
  return `
      <article class="digest-card" data-memory-id="${escapeHtml(id)}" data-level="${escapeHtml(level)}">
        <header class="digest-card-head">
          <div class="digest-card-title-row">
            <h3><span class="badge ${escapeHtml(level)}">${escapeHtml(level)}</span>${escapeHtml(
              e.title || id
            )}</h3>
            <div class="digest-card-actions">
              <button type="button" class="tool-btn dig-regen" data-level="${escapeHtml(
                level
              )}" data-id="${escapeHtml(id)}" data-period-key="${escapeHtml(periodKey)}">重新生成</button>
              <button type="button" class="tool-btn dig-gtd" data-level="${escapeHtml(
                level
              )}" data-id="${escapeHtml(id)}">GTD分析</button>
            </div>
          </div>
          <div class="meta-line">${escapeHtml(formatTime(e.createdAtMs))}${emb}</div>
        </header>
        <div class="digest-body markdown-body">${renderMarkdown(e.content)}</div>
      </article>`;
}

const FOCUS_DIGEST_LABELS = { day: "日报", week: "周报", month: "月报" };
const FOCUS_DIGEST_LEVELS = { day: "daily", week: "weekly", month: "monthly" };

function enterCalDigestDetailMode(type, key) {
  calDetailMode = "digest";
  calDetailSessionKey = null;
  highlightCalSessionRow(null);
  const titleEl = $("calDetailTitle");
  const backBtn = $("btnCalDetailBack");
  if (titleEl) {
    const label = FOCUS_DIGEST_LABELS[type] || "报告";
    titleEl.textContent = key ? `${label} · ${key}` : "报告详情";
  }
  if (backBtn) backBtn.hidden = true;
}

function enterCalSessionDetailMode(session) {
  calDetailMode = "session";
  calDetailSessionKey = { provider: session.provider, id: session.id };
  const titleEl = $("calDetailTitle");
  const backBtn = $("btnCalDetailBack");
  if (titleEl) titleEl.textContent = session.title || session.id;
  if (backBtn) backBtn.hidden = false;
  highlightCalSessionRow(calDetailSessionKey);
}

function highlightCalSessionRow(key) {
  document.querySelectorAll(".cal-session-row").forEach((row) => {
    const active = Boolean(key && row.dataset.provider === key.provider && row.dataset.id === key.id);
    row.classList.toggle("active", active);
  });
}

function returnToCalDigestDetail() {
  if (!detailFocus) {
    calDetailMode = "digest";
    calDetailSessionKey = null;
    highlightCalSessionRow(null);
    const titleEl = $("calDetailTitle");
    if (titleEl) titleEl.textContent = "报告详情";
    $("btnCalDetailBack")?.setAttribute("hidden", "");
    const detail = $("calDetail");
    if (detail) {
      detail.innerHTML =
        "<p class=\"muted\">点击日期 / 周 / 月查看 session 与报告；点击 session 可在本列预览。</p>";
    }
    return;
  }
  enterCalDigestDetailMode(detailFocus.type, detailFocus.key);
  renderFocusDigestDetail(detailFocus.type, detailFocus.key);
}

async function openCalSessionDetail(session) {
  if (!session?.provider || !session?.id) return;
  enterCalSessionDetailMode(session);
  activeSessionKey = `${session.provider}:${session.id}`;
  await openSessionPreview(session, { paneId: "calDetail", idPrefix: "cal" });
}

function isFuturePeriod(type, key) {
  if (type === "day") return isFutureDayKey(key);
  if (type === "week") return key > currentWeekLabel();
  if (type === "month") return key > currentMonthLabel();
  return false;
}

function getFocusDigestEntry(type, key) {
  if (type === "day") {
    return entriesForDay(key).find((e) => e.level === "daily");
  }
  if (type === "week") return getWeeklyEntry(key);
  if (type === "month") return getMonthlyEntry(key);
  return undefined;
}

function startDigestGeneration(level, periodKey) {
  if (level === "daily") {
    selectedDayKey = periodKey;
    detailFocus = { type: "day", key: periodKey };
    updatePeriodLabel();
    runDaily(periodKey);
    return;
  }
  if (level === "weekly") {
    selectedDayKey = null;
    detailFocus = { type: "week", key: periodKey };
    updatePeriodLabel();
    runWeekly(periodKey);
    return;
  }
  if (level === "monthly") {
    focusViewedMonth();
    runMonthly(periodKey);
  }
}

function wireDigestPanelActions(root) {
  if (!root) return;
  root.querySelectorAll(".dig-generate").forEach((btn) => {
    btn.addEventListener("click", (ev) => {
      ev.stopPropagation();
      startDigestGeneration(btn.dataset.level || "daily", btn.dataset.periodKey || "");
    });
  });
  root.querySelectorAll(".dig-regen").forEach((btn) => {
    btn.addEventListener("click", (ev) => {
      ev.stopPropagation();
      regenerateDigest(
        btn.dataset.level || "daily",
        btn.dataset.id || "",
        btn.dataset.periodKey || ""
      );
    });
  });
  root.querySelectorAll(".dig-gtd").forEach((btn) => {
    btn.addEventListener("click", (ev) => {
      ev.stopPropagation();
      openGtdFromDigest(btn.dataset.level || "daily", btn.dataset.id || "");
    });
  });
}

const FOCUS_SCOPE_WORDS = { day: "这一天", week: "这一周", month: "这一月" };

function periodRangeForType(type, key) {
  if (type === "day") return dayRangeFromKey(key);
  if (type === "week") return weekRangeFromKey(key);
  if (type === "month") return monthRangeFromKey(key);
  return null;
}

/** Whether the focused period has any catalog sessions. */
function periodHasSessions(type, key) {
  const focus = detailFocus;
  const range = periodRangeForType(type, key);
  if (!range) return false;

  const focusMatches = focus?.type === type && focus?.key === key;
  const loadedSeq = `${type}:${key}:${range.fromMs}:${range.toMs}`;
  if (focusMatches && calSessionListSeq === loadedSeq) {
    return calSessionCache.length > 0;
  }

  if (type === "day") {
    return calMonthSessionDays.has(key);
  }

  for (let t = range.fromMs; t < range.toMs; t += 86400000) {
    if (calMonthSessionDays.has(dayKeyFromMs(t))) return true;
  }
  return false;
}

function emptyDigestPanelHtml(type, key, hasSessions) {
  const label = FOCUS_DIGEST_LABELS[type] || "Digest";
  const level = FOCUS_DIGEST_LEVELS[type] || "daily";
  const scope = FOCUS_SCOPE_WORDS[type] || "本期";

  const header = `
      <header class="digest-panel-head">
        <h3><span class="badge ${escapeHtml(level)}">${escapeHtml(level)}</span>${escapeHtml(label)} · ${escapeHtml(key)}</h3>
      </header>`;

  if (!hasSessions) {
    return `
    <div class="digest-panel digest-panel-empty digest-panel-quiet">
      ${header}
      <p class="empty-hint muted">${escapeHtml(scope)}还没有 CLI 会话记录，暂时不必生成${escapeHtml(label)}。</p>
    </div>`;
  }

  return `
    <div class="digest-panel digest-panel-empty">
      ${header}
      <p class="empty-hint muted">${escapeHtml(scope)}有会话活动，${escapeHtml(label)}还没整理好。如果想汇总一下，可以点下方按钮（需先在 Settings 配置工具 LLM）。</p>
      <button type="button" class="tool-btn dig-generate" data-level="${escapeHtml(level)}" data-period-key="${escapeHtml(
        key
      )}">生成${escapeHtml(label)}</button>
    </div>`;
}

/**
 * Right panel: view or generate digest for the focused day / week / month.
 * @param {"day"|"week"|"month"} type
 * @param {string} key
 */
function renderFocusDigestDetail(type, key) {
  const detail = $("calDetail");
  if (!detail || !key) return;

  enterCalDigestDetailMode(type, key);

  const label = FOCUS_DIGEST_LABELS[type] || "Digest";

  if (type === "day" && generatingDays.has(key)) {
    showGeneratingDetail("day", key);
    return;
  }
  if (type === "week" && generatingPeriodKey === `weekly:${key}`) {
    showGeneratingDetail("week", key);
    return;
  }
  if (type === "month" && generatingPeriodKey === `monthly:${key}`) {
    showGeneratingDetail("month", key);
    return;
  }

  if (!generatingDays.size && !weeklyMonthlyBusy) {
    hideGenProgress();
  }

  if (isFuturePeriod(type, key)) {
    detail.innerHTML = `<p class="empty-hint muted">未来的日期还无法生成${escapeHtml(label)}，等有活动后再来看看吧。</p>`;
    return;
  }

  const entry = getFocusDigestEntry(type, key);
  if (entry) {
    const staleCheck =
      type === "day"
        ? calDayStaleMap.get(key)
        : type === "week"
          ? calWeekStaleMap.get(key)
          : type === "month"
            ? calMonthStaleMap.get(key)
            : undefined;
    renderDigestEntries([entry], staleCheck, type);
    return;
  }

  detail.innerHTML = emptyDigestPanelHtml(type, key, periodHasSessions(type, key));
  wireDigestPanelActions(detail);
}

/** Parse period key from memory id: daily:YYYY-MM-DD | weekly:YYYY-Www | monthly:YYYY-MM */
function periodKeyFromMemoryId(level, id) {
  if (!id) return "";
  const prefixes = ["daily:", "weekly:", "monthly:"];
  for (const p of prefixes) {
    if (id.startsWith(p)) return id.slice(p.length);
  }
  // fallback: strip known level prefix
  if (level === "daily" && id.startsWith("daily:")) return id.slice(6);
  if (level === "weekly" && id.startsWith("weekly:")) return id.slice(7);
  if (level === "monthly" && id.startsWith("monthly:")) return id.slice(8);
  return id;
}

function regenerateDigest(level, memoryId, explicitPeriodKey = "") {
  const key = explicitPeriodKey || periodKeyFromMemoryId(level, memoryId);
  if (!key) {
    setGenFinal("无法解析 digest id", "error");
    return;
  }
  if (level === "daily") {
    if (weeklyMonthlyBusy) {
      setGenFinal("周报/月报生成中，请稍候…", "error");
      return;
    }
    if (generatingDays.has(key)) {
      focusGeneratingDetail("day", key);
      return;
    }
    selectedDayKey = key;
    detailFocus = { type: "day", key };
    updatePeriodLabel();
    runDaily(key, { reasonMessage: "手动重新生成" });
    return;
  }
  if (level === "weekly") {
    if (generatingPeriodKey === `weekly:${key}`) {
      focusGeneratingDetail("week", key);
      return;
    }
    if (weeklyMonthlyBusy || generatingDays.size > 0) {
      setGenFinal("有任务进行中，请稍候再重新生成周报…", "error");
      return;
    }
    detailFocus = { type: "week", key };
    runWeekly(key);
    return;
  }
  if (level === "monthly") {
    if (generatingPeriodKey === `monthly:${key}`) {
      focusGeneratingDetail("month", key);
      return;
    }
    if (weeklyMonthlyBusy || generatingDays.size > 0) {
      setGenFinal("有任务进行中，请稍候再重新生成月报…", "error");
      return;
    }
    detailFocus = { type: "month", key };
    runMonthly(key);
    return;
  }
  setGenFinal(`未知 level: ${level}`, "error");
}

/** Last scoped GTD source (from detail card). */
let gtdScoped = /** @type {{ level: string, memoryId: string } | null} */ (null);

/**
 * Cache GTD analysis per digest id. Only refresh on「重新分析」.
 * @type {Map<string, { level: string, proposals: any[], warnings: string[], statusText: string }>}
 */
const gtdCacheByMemoryId = new Map();

/** Collect current DOM edits into cache for active scoped digest. */
function snapshotGtdCache() {
  if (!gtdScoped?.memoryId) return;
  const root = $("gtdPreview");
  if (!root) return;

  const proposals = [];
  root.querySelectorAll(".gtd-row").forEach((row) => {
    const idx = Number(row.dataset.idx);
    const edited = collectEditedGtdItem(idx);
    const base = gtdPreviewItems[idx];
    if (!edited) return;
    proposals.push({
      ...(base || {}),
      provider: edited.provider,
      sessionId: edited.sessionId,
      title: edited.title,
      projectPath: edited.projectPath,
      previousGtd: edited.previousGtd,
      proposedGtd: edited.gtd,
      reason: edited.reason,
      tasks: edited.tasks,
      sourceMemoryIds: edited.sourceMemoryIds,
      todolistPreview: edited.todolistMarkdown
    });
  });

  const prev = gtdCacheByMemoryId.get(gtdScoped.memoryId);
  const statusEl = $("gtdSyncStatus");
  gtdCacheByMemoryId.set(gtdScoped.memoryId, {
    level: gtdScoped.level,
    proposals,
    warnings: prev?.warnings || [],
    statusText: statusEl?.textContent || prev?.statusText || ""
  });
}

function restoreGtdCache(memoryId) {
  const cached = gtdCacheByMemoryId.get(memoryId);
  if (!cached) return false;
  renderGtdPreview(cached.proposals, cached.warnings);
  const status = $("gtdSyncStatus");
  if (status) {
    const text =
      cached.statusText ||
      `缓存预览 · ${cached.proposals.length} 项 · 源 ${cached.level}:${periodKeyFromMemoryId(
        cached.level,
        memoryId
      )} · 点「重新分析」可刷新`;
    // Prefer ok when we have items; keep error styling only if empty
    setStatus(status, text, cached.proposals.length ? "ok" : "error");
  }
  return true;
}

/**
 * Open GTD sheet for a digest. Uses cache unless forceAnalyze.
 * @param {string} level
 * @param {string} memoryId
 * @param {{ forceAnalyze?: boolean }} [opts]
 */
async function openGtdFromDigest(level, memoryId, opts = {}) {
  if (!memoryId) {
    setGenFinal("缺少 digest id", "error");
    return;
  }
  // Persist edits from previous open before switching source
  snapshotGtdCache();

  gtdScoped = { level, memoryId };
  openSheet("sheetGtd");

  if (!opts.forceAnalyze && gtdCacheByMemoryId.has(memoryId)) {
    restoreGtdCache(memoryId);
    return;
  }
  await previewGtdSync({ force: true });
}

function staleDigestHint(check, type = "day") {
  if (!check) return "";
  const label = FOCUS_DIGEST_LABELS[type] || "Digest";
  if (type === "day") {
    if (check.reason === "new_sessions" && check.newSessionCount > 0) {
      return `有 ${check.newSessionCount} 个新 session 还没写进日报，方便的话可以再生成一次同步一下。`;
    }
    if (check.reason === "updated_sessions" && check.updatedSessionCount > 0) {
      return `有 ${check.updatedSessionCount} 个 session 在日报之后又更新了，方便的话可以再生成一次保持最新。`;
    }
    return check.message || "日报可能不是最新的，方便的话可以再生成一次。";
  }
  if (check.reason === "updated_sessions" && check.updatedSessionCount > 0) {
    return `有 ${check.updatedSessionCount} 个 session 在${label}之后又更新了，方便的话可以再生成一次保持最新。`;
  }
  if (check.reason === "new_sessions" && check.newSessionCount > 0) {
    return `底层日报有变化，${label}可能不是最新的。方便的话可以再生成一次同步一下。`;
  }
  return check.message || `${label}可能不是最新的，方便的话可以再生成一次。`;
}

function renderDigestEntries(entries, staleCheck, focusType = "day") {
  const detail = $("calDetail");
  if (!detail) return;
  if (!entries.length) {
    detail.innerHTML = `<p class="empty-hint">暂无 digest。</p>`;
    return;
  }
  const banner = staleCheck
    ? `<div class="digest-stale-banner">
        <p class="muted">${escapeHtml(staleDigestHint(staleCheck, focusType))}</p>
      </div>`
    : "";
  detail.innerHTML = banner + entries.map((e) => digestCardHtml(e)).join("");
  wireDigestPanelActions(detail);
}

function refreshDetailFocus() {
  if (calDetailMode === "session") return;
  if (!detailFocus) {
    if (selectedDayKey) renderFocusDigestDetail("day", selectedDayKey);
    return;
  }
  renderFocusDigestDetail(detailFocus.type, detailFocus.key);
}

function renderCalendar() {
  syncCalPickers();
  updatePeriodLabel();
  const grid = $("calendarGrid");
  grid.innerHTML = "";
  const index = buildDayIndex(calEntries);

  const first = new Date(calView.year, calView.month, 1);
  // Monday-based: getDay Sun=0 → convert
  let startOffset = first.getDay() - 1;
  if (startOffset < 0) {
    startOffset = 6;
  }
  const gridStart = new Date(calView.year, calView.month, 1 - startOffset);
  const todayKey = todayInputValue();
  const thisWeek = currentWeekLabel();

  for (let row = 0; row < 6; row++) {
    let weekLabelForRow = null;
    for (let col = 0; col < 7; col++) {
      const i = row * 7 + col;
      const d = new Date(gridStart.getFullYear(), gridStart.getMonth(), gridStart.getDate() + i);
      const key = dayKeyFromDate(d);
      const outside = d.getMonth() !== calView.month;
      if (col === 0) {
        weekLabelForRow = isoWeekLabelFromDate(d);
      }
      const cell = document.createElement("button");
      cell.type = "button";
      cell.className = "cal-cell";
      if (outside) cell.classList.add("outside");
      if (key === todayKey) cell.classList.add("today");
      if (key === selectedDayKey) cell.classList.add("selected");
      if (generatingDays.has(key)) cell.classList.add("generating");
      cell.dataset.day = key;
      if (generatingDays.has(key)) {
        cell.title = `正在生成日报 ${key}…`;
      }

      const marks = document.createElement("div");
      marks.className = "marks";
      const bucket = index[key];
      appendDayCellMark(marks, { dayKey: key, outside, dailyEntry: bucket?.daily });

      cell.innerHTML = `<span class="day-num">${d.getDate()}</span>`;
      cell.appendChild(marks);
      if (generatingDays.has(key)) {
        const spin = document.createElement("span");
        spin.className = "cal-cell-loading";
        spin.setAttribute("aria-hidden", "true");
        cell.appendChild(spin);
      }
      cell.addEventListener("click", () => selectDay(key));
      grid.appendChild(cell);
    }

    // Week action button after Sunday
    const weekBtn = document.createElement("button");
    weekBtn.type = "button";
    weekBtn.className = "cal-week-btn";
    weekBtn.dataset.week = weekLabelForRow || "";
    const wLabel = weekLabelForRow || "";
    const weekShortLabel = /W\d{2}$/i.exec(wLabel)?.[0]?.toUpperCase() || "W--";
    const isFutureWeek = wLabel > thisWeek;
    const hasW = hasWeeklyDigest(wLabel);
    const staleW = calWeekStaleMap.get(wLabel);
    if (hasW) weekBtn.classList.add("has-digest");
    if (staleW) weekBtn.classList.add("has-digest-stale");
    if (isFutureWeek) weekBtn.classList.add("future");
    if (generatingPeriodKey === `weekly:${wLabel}`) weekBtn.classList.add("generating");
    const staleBadge = staleW
      ? `<span class="cal-period-stale" title="${escapeHtml(staleW.message || "周报待更新")}">更</span>`
      : "";
    weekBtn.innerHTML = `<span class="cal-week-label">${escapeHtml(weekShortLabel)}</span>${staleBadge}`;
    weekBtn.title = isFutureWeek
      ? `未来周 ${wLabel}`
      : staleW
        ? `周报 ${wLabel} · ${staleW.message || "待更新"}`
        : hasW
          ? `周报 ${wLabel} · 点击查看（右侧面板可重新生成）`
          : `周报 ${wLabel} · 点击查看 session，右侧面板生成`;
    weekBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      onWeekButton(wLabel);
    });
    grid.appendChild(weekBtn);
  }

  // Month button state
  const monthBtn = $("btnCalMonthDigest");
  if (monthBtn) {
    const mLabel = viewMonthLabel();
    const thisMonth = currentMonthLabel();
    const isFutureMonth = mLabel > thisMonth;
    const hasM = hasMonthlyDigest(mLabel);
    const staleM = calMonthStaleMap.get(mLabel);
    monthBtn.classList.toggle("has-digest", hasM);
    monthBtn.classList.toggle("has-digest-stale", Boolean(staleM));
    monthBtn.classList.toggle("future", isFutureMonth);
    monthBtn.classList.toggle("generating", generatingPeriodKey === `monthly:${mLabel}`);
    monthBtn.classList.toggle(
      "selected",
      detailFocus?.type === "month" && detailFocus.key === mLabel
    );
    monthBtn.disabled = isFutureMonth;
    const monthStaleBadge = staleM
      ? `<span class="cal-period-stale" title="${escapeHtml(staleM.message || "月报待更新")}">更</span>`
      : "";
    monthBtn.innerHTML = isFutureMonth
      ? "月（未来）"
      : `月 · ${escapeHtml(mLabel)}${monthStaleBadge}`;
    monthBtn.title = isFutureMonth
      ? "未来月份"
      : staleM
        ? `月 ${mLabel} · ${staleM.message || "待更新"}`
        : hasM
          ? `月 ${mLabel} · 点击查看 session 与月报（右侧面板可重新生成）`
          : `月 ${mLabel} · 点击查看 session，右侧面板生成月报`;
  }
}

function entriesForDay(dayKey) {
  return calEntries.filter((e) => entryDayKey(e) === dayKey);
}

function hasDailyDigest(dayKey) {
  return calEntries.some((e) => (e.level || "daily") === "daily" && entryDayKey(e) === dayKey);
}

/**
 * Day-cell status tags (mutually exclusive):
 * - daily (D): digest up to date
 * - daily-stale (更): digest exists but sessions changed
 * - daily-missing (未): has sessions, no digest
 * - no-session (无): no sessions in catalog for this day
 * Spinner (generating) is separate — no text tag while running.
 * Outside-month / future days: no tag.
 * @param {HTMLElement} marks
 * @param {{ dayKey: string, outside: boolean, dailyEntry?: any }} ctx
 */
function appendDayCellMark(marks, ctx) {
  const { dayKey, outside, dailyEntry } = ctx;
  if (outside || isFutureDayKey(dayKey) || generatingDays.has(dayKey)) return;

  if (dailyEntry) {
    const stale = calDayStaleMap.get(dayKey);
    const m = document.createElement("span");
    if (stale) {
      m.className = "mark daily-stale";
      m.textContent = "更";
      const parts = [];
      if (stale.newSessionCount > 0) parts.push(`${stale.newSessionCount} 个新 session`);
      if (stale.updatedSessionCount > 0) parts.push(`${stale.updatedSessionCount} 个有更新`);
      m.title = `日报已有，${parts.join("、") || "session 有变化"} · ${dayKey}`;
    } else {
      m.className = "mark daily";
      m.textContent = "D";
      m.title = dailyEntry.title || dailyEntry.id || `日报已是最新 · ${dayKey}`;
    }
    marks.appendChild(m);
    return;
  }

  if (calMonthSessionDays.has(dayKey)) {
    const m = document.createElement("span");
    m.className = "mark daily-missing";
    m.textContent = "未";
    m.title = `有 session，日报未生成 · ${dayKey}`;
    marks.appendChild(m);
    return;
  }

  const m = document.createElement("span");
  m.className = "mark no-session";
  m.textContent = "无";
  m.title = `无 session · ${dayKey}`;
  marks.appendChild(m);
}

/**
 * Jump right panel to a day/week/month that is currently generating.
 * @param {"day"|"week"|"month"} type
 * @param {string} key
 */
function focusGeneratingDetail(type, key) {
  detailFocus = { type, key };
  if (type === "day") {
    selectedDayKey = key;
  }
  updatePeriodLabel();
  renderCalendar();
  renderCalSessionList();
  showGeneratingDetail(type, key);
  // Keep / restore progress strip on the right
  if (lastProgressSnapshot) {
    applyDigestProgress(lastProgressSnapshot, { skipDetail: true });
  } else {
    showGenProgress();
    $("genProgress")?.classList.add("is-loading");
    const line = $("genProgressLine");
    if (line) {
      const label = type === "day" ? "日报" : type === "week" ? "周报" : "月报";
      line.textContent = `正在生成${label} ${key}…`;
      line.classList.remove("is-ok", "is-error");
    }
  }
}

/**
 * @param {"day"|"week"|"month"} type
 * @param {string} key
 */
function showGeneratingDetail(type, key) {
  const detail = $("calDetail");
  if (!detail) return;
  enterCalDigestDetailMode(type, key);
  const label = type === "day" ? "日报" : type === "week" ? "周报" : "月报";
  detail.innerHTML = `
    <div class="detail-generating">
      <p class="empty-hint">
        正在生成<strong>${escapeHtml(label)}</strong>
        <span class="detail-generating-key">${escapeHtml(key)}</span>
      </p>
      <p class="muted detail-generating-hint">进度见上方进度条与 session 明细。</p>
    </div>`;
}

function selectDay(dayKey) {
  selectedDayKey = dayKey;
  detailFocus = { type: "day", key: dayKey };
  updatePeriodLabel();
  renderCalendar();
  renderCalSessionList();
  renderFocusDigestDetail("day", dayKey);
}

function onWeekButton(weekLabel) {
  if (!weekLabel) return;
  selectedDayKey = null;
  detailFocus = { type: "week", key: weekLabel };
  updatePeriodLabel();
  renderCalendar();
  renderCalSessionList();
  renderFocusDigestDetail("week", weekLabel);
}

function onMonthButton() {
  focusViewedMonth();
  renderCalendar();
  renderCalSessionList();
  renderFocusDigestDetail("month", viewMonthLabel());
}

function applyMonthSessions(sessions) {
  calMonthSessionDays = new Set();
  for (const s of sessions) {
    if (s?.updatedAt) calMonthSessionDays.add(dayKeyFromMs(s.updatedAt));
  }
}

function isStaleDigestCheck(check) {
  return (
    check?.needed &&
    (check.reason === "new_sessions" || check.reason === "updated_sessions")
  );
}

function weekLabelsWithDigest() {
  const labels = new Set();
  for (const e of calEntries) {
    if (e.level !== "weekly") continue;
    const wk = periodKeyFromEntry(e);
    if (wk) labels.add(wk);
  }
  return [...labels];
}

async function refreshCalStaleMaps() {
  calDayStaleMap = new Map();
  calWeekStaleMap = new Map();
  calMonthStaleMap = new Map();

  const monthLabel = viewMonthLabel();
  const days = new Set();
  for (const e of calEntries) {
    if ((e.level || "daily") !== "daily") continue;
    const dk = entryDayKey(e);
    if (dk.startsWith(monthLabel)) {
      days.add(dk);
    }
  }

  const tasks = [];

  for (const day of days) {
    tasks.push(
      agentResume.needsDailyDigestRefresh(day).then((check) => {
        if (isStaleDigestCheck(check)) calDayStaleMap.set(day, check);
      })
    );
  }

  for (const week of weekLabelsWithDigest()) {
    tasks.push(
      agentResume.needsWeeklyDigestRefresh(week).then((check) => {
        if (isStaleDigestCheck(check)) calWeekStaleMap.set(week, check);
      })
    );
  }

  if (hasMonthlyDigest(monthLabel)) {
    tasks.push(
      agentResume.needsMonthlyDigestRefresh(monthLabel).then((check) => {
        if (isStaleDigestCheck(check)) calMonthStaleMap.set(monthLabel, check);
      })
    );
  }

  await Promise.all(tasks.map((p) => p.catch(() => undefined)));
}

async function refreshMonthSessionActivity(opts = {}) {
  const monthRange = monthRangeFromKey(viewMonthLabel());
  if (!monthRange) return;
  try {
    const sessions = await agentResume.listSessionsInRange({
      fromMs: monthRange.fromMs,
      toMs: monthRange.toMs,
      limit: 2000
    });
    applyMonthSessions(sessions);
    await refreshCalStaleMaps();
    renderCalendar();
    if (detailFocus || selectedDayKey) {
      refreshDetailFocus();
    }
    await renderCalSessionList({ preserveScroll: opts.preserveScroll !== false });
  } catch {
    // keep previous month activity markers on failure
  }
}

async function loadMemory() {
  setStatus($("memoryStatus"), "");
  try {
    const { fromMs, toMs } = monthRangeMs(calView.year, calView.month);
    const monthRange = monthRangeFromKey(viewMonthLabel());
    const [entries, sessions] = await Promise.all([
      agentResume.listMemory({
        fromMs,
        toMs,
        limit: 300
      }),
      monthRange
        ? agentResume.listSessionsInRange({
            fromMs: monthRange.fromMs,
            toMs: monthRange.toMs,
            limit: 2000
          })
        : Promise.resolve([])
    ]);
    calEntries = entries;
    applyMonthSessions(sessions);
    calDayStaleMap = new Map();
    calWeekStaleMap = new Map();
    calMonthStaleMap = new Map();
    renderCalendar();
    if (detailFocus || selectedDayKey) {
      refreshDetailFocus();
    } else {
      $("calDetail").innerHTML =
        `<p class="muted">点击日期 / 周 / 月查看 session 与报告；点击 session 可在本列预览。</p>`;
      const titleEl = $("calDetailTitle");
      if (titleEl) titleEl.textContent = "报告详情";
      $("btnCalDetailBack")?.setAttribute("hidden", "");
    }
    renderCalSessionList();
    void refreshCalStaleMaps().then(() => {
      renderCalendar();
      if (detailFocus || selectedDayKey) {
        refreshDetailFocus();
      }
    });
  } catch (error) {
    $("calendarGrid").innerHTML = "";
    $("calDetail").innerHTML = `<p class="status error">${escapeHtml(
      error instanceof Error ? error.message : String(error)
    )}</p>`;
  }
}

function shiftCalMonth(delta) {
  let y = calView.year;
  let m = calView.month + delta;
  while (m < 0) {
    m += 12;
    y -= 1;
  }
  while (m > 11) {
    m -= 12;
    y += 1;
  }
  calView = { year: y, month: m };
  focusViewedMonth();
  loadMemory();
}

function goCalToday() {
  const n = new Date();
  calView = { year: n.getFullYear(), month: n.getMonth() };
  selectedDayKey = todayInputValue();
  detailFocus = { type: "day", key: selectedDayKey };
  updatePeriodLabel();
  loadMemory();
}

function formatSummaryEnsureStats(result) {
  const parts = [];
  const ed = result.ensuredDailies;
  if (ed) {
    parts.push(`补日报 +${ed.ok?.length || 0}/skip ${ed.skipped?.length || 0}${ed.failed?.length ? `/fail ${ed.failed.length}` : ""}`);
  }
  const ew = result.ensuredWeeklies;
  if (ew) {
    parts.push(`补周报 +${ew.ok?.length || 0}/skip ${ew.skipped?.length || 0}${ew.failed?.length ? `/fail ${ew.failed.length}` : ""}`);
  }
  const summarized = result.summarizedCount ?? 0;
  const skipped = result.summarySkippedCount ?? 0;
  const failed = result.summaryFailed?.length ?? 0;
  if (summarized || skipped || failed) {
    parts.push(`summarize +${summarized}/skip ${skipped}${failed ? `/fail ${failed}` : ""}`);
  }
  return parts.length ? ` · ${parts.join(" · ")}` : "";
}

/** @type {Set<string>} */
const activeSummarizeSessions = new Set();

function showGenProgress() {
  const box = $("genProgress");
  if (!box) return;
  box.hidden = false;
  box.classList.remove("is-done", "is-error");
}

/** Hide progress strip (e.g. when only viewing historical digests). */
function hideGenProgress() {
  const box = $("genProgress");
  if (box) box.hidden = true;
  box?.classList.remove("is-loading");
  hideGenSessionRow();
  const line = $("genProgressLine");
  if (line) {
    line.textContent = "";
    line.classList.remove("is-ok", "is-error");
  }
  const bar = $("genProgressBar");
  if (bar) bar.style.width = "0%";
  lastProgressSnapshot = null;
}

function hideGenSessionRow() {
  const row = $("genProgressSessionRow");
  const barWrap = $("genProgressBarWrap");
  if (row) row.hidden = true;
  if (barWrap) barWrap.hidden = true;
  activeSummarizeSessions.clear();
}

/** @type {Record<string, unknown> | null} last progress for re-focus while loading */
let lastProgressSnapshot = null;

/**
 * @param {{ phase?: string, message?: string, index?: number, total?: number, session?: { provider?: string, id?: string, title?: string }, level?: string, periodLabel?: string }} event
 * @param {{ skipDetail?: boolean }} [opts]
 */
function applyDigestProgress(event, opts = {}) {
  lastProgressSnapshot = { ...event };
  syncCalendarFromDigestProgress(event);
  const box = $("genProgress");
  const line = $("genProgressLine");
  const row = $("genProgressSessionRow");
  const sessionEl = $("genProgressSession");
  const barWrap = $("genProgressBarWrap");
  const bar = $("genProgressBar");
  if (!box || !line) return;

  const phase = event.phase || "";
  showGenProgress();
  box.classList.remove("is-done", "is-error");
  box.classList.toggle("is-loading", phase !== "complete" && phase !== "error");
  line.classList.remove("is-ok", "is-error");

  if (event.message) {
    line.textContent = event.message;
  }

  // If user is focused on a generating day/week/month, keep detail in "正在生成" state.
  if (!opts.skipDetail && detailFocus) {
    const { type, key } = detailFocus;
    const genDay = type === "day" && generatingDays.has(key);
    const genWeek = type === "week" && generatingPeriodKey === `weekly:${key}`;
    const genMonth = type === "month" && generatingPeriodKey === `monthly:${key}`;
    if (genDay || genWeek || genMonth) {
      showGeneratingDetail(type, key);
    }
  }

  const sessionKey =
    event.session?.provider && event.session?.id
      ? `${event.session.provider}:${event.session.id}`
      : "";

  if (phase === "session_start" && sessionKey) {
    activeSummarizeSessions.add(sessionKey);
    if (row && sessionEl) {
      row.hidden = false;
      const title = event.session?.title || event.session?.id || "session";
      const provider = event.session?.provider || "";
      const idx =
        event.index != null && event.total != null ? `${event.index}/${event.total} · ` : "";
      sessionEl.textContent = `${idx}${provider} · ${title}`;
      sessionEl.title = sessionEl.textContent;
    }
  }

  if (
    (phase === "session_done" || phase === "session_fail" || phase === "session_skip") &&
    sessionKey
  ) {
    activeSummarizeSessions.delete(sessionKey);
    if (row && sessionEl && event.session) {
      row.hidden = false;
      const title = event.session.title || event.session.id || "session";
      const provider = event.session.provider || "";
      const idx =
        event.index != null && event.total != null ? `${event.index}/${event.total} · ` : "";
      const mark =
        phase === "session_done" ? "✓ " : phase === "session_fail" ? "✗ " : "· ";
      sessionEl.textContent = `${mark}${idx}${provider} · ${title}`;
      sessionEl.title = sessionEl.textContent;
    }
  }

  if (event.total != null && event.total > 0 && barWrap && bar) {
    barWrap.hidden = false;
    const idx = Math.min(event.total, Math.max(0, event.index ?? 0));
    const pct = Math.round((idx / event.total) * 100);
    bar.style.width = `${pct}%`;
  }

  if (phase === "digest" || phase === "embed" || phase === "start" || phase === "ensure_summaries") {
    if (phase === "digest" || phase === "embed") {
      // keep last session line but stop emphasizing active work if none
      if (!activeSummarizeSessions.size && row) {
        // keep row visible with last session text; bar may stay
      }
    }
  }

  if (phase === "complete") {
    box.classList.add("is-done");
    box.classList.remove("is-loading");
    line.classList.add("is-ok");
    if (bar) bar.style.width = "100%";
    if (barWrap) barWrap.hidden = false;
  }

  if (phase === "error") {
    box.classList.add("is-error");
    box.classList.remove("is-loading");
    line.classList.add("is-error");
    hideGenSessionRow();
  }
}

function setGenFinal(text, kind) {
  showGenProgress();
  const box = $("genProgress");
  const line = $("genProgressLine");
  if (!line) return;
  line.textContent = text;
  line.classList.remove("is-ok", "is-error");
  box?.classList.remove("is-done", "is-error", "is-loading");
  if (kind === "ok") {
    line.classList.add("is-ok");
    box?.classList.add("is-done");
    box?.classList.remove("is-loading");
  }
  if (kind === "error") {
    line.classList.add("is-error");
    box?.classList.add("is-error");
    box?.classList.remove("is-loading");
    hideGenSessionRow();
  }
}

function isLlmConfigured(settings) {
  const apiKey = settings?.llm?.apiKey?.trim();
  const baseUrl = settings?.llm?.baseUrl?.trim();
  const model = settings?.llm?.model?.trim();
  return Boolean(apiKey && baseUrl && model);
}

function openLlmSettings() {
  closeAllSheets();
  switchTab("settings");
  showSettingsPane("provider");
}

function showLlmRequiredDetail(digestLabel) {
  const detail = $("calDetail");
  if (!detail) return;
  detail.innerHTML = `
    <div class="detail-error">
      <p class="empty-hint error">无法生成${escapeHtml(digestLabel)}：尚未配置工具 LLM</p>
      <p class="muted">日历中的 session 来自本地索引；生成日报 / 周报 / 月报需要调用工具 LLM API（会先补全缺失的日报，再聚合为周报 / 月报）。</p>
      <p class="muted">请在 <strong>Settings → Provider</strong> 填写 Base URL、Model、API Key，保存后重试。</p>
      <button type="button" class="tool-btn" id="btnLlmSettings">去 Settings 配置</button>
    </div>`;
  $("btnLlmSettings")?.addEventListener("click", openLlmSettings);
}

/** @returns {Promise<boolean>} */
async function ensureLlmReady(digestLabel) {
  try {
    const settings = await agentResume.getSettings();
    if (isLlmConfigured(settings)) return true;
  } catch {
    // fall through to error UI
  }
  const msg = `无法生成${digestLabel}：请先在 Settings → Provider 配置工具 LLM（baseUrl / model / apiKey）`;
  setGenFinal(msg, "error");
  showLlmRequiredDetail(digestLabel);
  return false;
}

function isLlmConfigError(error) {
  const msg = error instanceof Error ? error.message : String(error);
  return /LLM is not configured/i.test(msg);
}

function handleDigestError(digestLabel, error) {
  const err = error instanceof Error ? error.message : String(error);
  if (isLlmConfigError(error)) {
    setGenFinal(`无法生成${digestLabel}：请先在 Settings → Provider 配置工具 LLM`, "error");
    showLlmRequiredDetail(digestLabel);
    return;
  }
  setGenFinal(`${digestLabel} 失败：${err}`, "error");
}

/** Days currently generating a daily digest (parallel OK). */
const generatingDays = new Set();
/** Weekly / monthly job in flight (single at a time). */
let weeklyMonthlyBusy = false;

function syncWeeklyMonthlyButtons() {
  const busy = weeklyMonthlyBusy || generatingDays.size > 0;
  // Never disable the period currently generating — user may re-click to focus detail.
  document.querySelectorAll(".cal-week-btn:not(.future)").forEach((btn) => {
    const selfBusy = generatingPeriodKey === `weekly:${btn.dataset.week}`;
    btn.disabled = busy && !selfBusy;
  });
  const monthBtn = $("btnCalMonthDigest");
  if (monthBtn && !monthBtn.classList.contains("future")) {
    const mLabel = viewMonthLabel();
    const selfBusy = generatingPeriodKey === `monthly:${mLabel}`;
    monthBtn.disabled = busy && !selfBusy;
  }
}

function updateDayCellMarks(dayKey) {
  const cell = document.querySelector(`.cal-cell[data-day="${dayKey}"]`);
  if (!cell) return;
  const marks = cell.querySelector(".marks");
  if (!marks) return;
  marks.innerHTML = "";
  const outside = cell.classList.contains("outside");
  const bucket = buildDayIndex(calEntries)[dayKey];
  appendDayCellMark(marks, { dayKey, outside, dailyEntry: bucket?.daily });
}

function extractDayKeyFromProgressMessage(message) {
  if (typeof message !== "string") return null;
  const match = message.match(/\b(\d{4}-\d{2}-\d{2})\b/);
  return match?.[1] || null;
}

function resolveProgressDayKey(event) {
  if (event.dayKey && /^\d{4}-\d{2}-\d{2}$/.test(event.dayKey)) {
    return event.dayKey;
  }
  if (event.level === "daily" && /^\d{4}-\d{2}-\d{2}$/.test(event.periodLabel || "")) {
    return event.periodLabel;
  }
  return extractDayKeyFromProgressMessage(event.message);
}

async function refreshDayCalendarState(dayKey) {
  const range = dayRangeFromKey(dayKey);
  if (!range) return;
  try {
    const entries = await agentResume.listMemory({
      fromMs: range.fromMs,
      toMs: range.toMs,
      limit: 20
    });
    calEntries = calEntries.filter(
      (e) => !((e.level || "daily") === "daily" && entryDayKey(e) === dayKey)
    );
    for (const e of entries) {
      if ((e.level || "daily") === "daily" && entryDayKey(e) === dayKey) {
        calEntries.push(e);
      }
    }
    const check = await agentResume.needsDailyDigestRefresh(dayKey);
    if (isStaleDigestCheck(check)) {
      calDayStaleMap.set(dayKey, check);
    } else {
      calDayStaleMap.delete(dayKey);
    }
    updateDayCellMarks(dayKey);
    if (detailFocus?.type === "day" && detailFocus.key === dayKey) {
      renderFocusDigestDetail("day", dayKey);
    }
  } catch {
    updateDayCellMarks(dayKey);
  }
}

/**
 * Keep calendar day tags in sync while weekly/monthly jobs cascade through dailies.
 * @param {{ phase?: string, level?: string, dayKey?: string, message?: string }} event
 */
function syncCalendarFromDigestProgress(event) {
  const dayKey = resolveProgressDayKey(event);
  if (!dayKey) return;

  const phase = event.phase || "";
  const dailyActivePhases = new Set([
    "start",
    "ensure_summaries",
    "session_start",
    "session_done",
    "session_skip",
    "session_fail",
    "digest",
    "embed"
  ]);
  const inCascade =
    weeklyMonthlyBusy || event.level === "daily" || /日报/.test(event.message || "");

  if (dailyActivePhases.has(phase) && inCascade) {
    if (phase === "ensure_summaries" && !event.message?.includes(dayKey)) {
      return;
    }
    markDayGenerating(dayKey, true);
    return;
  }

  if (phase === "complete" && inCascade) {
    markDayGenerating(dayKey, false);
    void refreshDayCalendarState(dayKey);
    return;
  }

  if (phase === "error" && inCascade) {
    markDayGenerating(dayKey, false);
    void refreshDayCalendarState(dayKey);
  }
}

function markDayGenerating(dayKey, on) {
  if (on) {
    generatingDays.add(dayKey);
  } else {
    generatingDays.delete(dayKey);
  }
  syncWeeklyMonthlyButtons();

  const cell = document.querySelector(`.cal-cell[data-day="${dayKey}"]`);
  if (!cell) {
    renderCalendar();
    return;
  }
  if (on) {
    cell.classList.add("generating");
    cell.title = `正在生成日报 ${dayKey}…`;
    const marks = cell.querySelector(".marks");
    if (marks) marks.innerHTML = "";
    if (!cell.querySelector(".cal-cell-loading")) {
      const spin = document.createElement("span");
      spin.className = "cal-cell-loading";
      spin.setAttribute("aria-hidden", "true");
      cell.appendChild(spin);
    }
  } else {
    cell.classList.remove("generating");
    cell.title = "";
    cell.querySelector(".cal-cell-loading")?.remove();
    updateDayCellMarks(dayKey);
  }
}

function formatParallelDailyStatus() {
  const days = [...generatingDays].sort();
  if (!days.length) return "";
  if (days.length === 1) return `生成日报 ${days[0]}…`;
  return `并行生成 ${days.length} 天日报：${days.join(" · ")}`;
}

/**
 * @param {string} [dayKey]
 * @param {{ reasonMessage?: string }} [opts]
 */
async function runDaily(dayKey, opts = {}) {
  const day = dayKey || getActivePeriods().day;
  if (generatingDays.has(day)) return;
  if (weeklyMonthlyBusy) {
    setGenFinal("周报/月报生成中，请稍候…", "error");
    return;
  }
  if (!(await ensureLlmReady("日报"))) return;

  markDayGenerating(day, true);
  detailFocus = { type: "day", key: day };
  selectedDayKey = day;
  showGeneratingDetail("day", day);
  hideGenSessionRow();
  const reason = opts.reasonMessage ? ` · ${opts.reasonMessage}` : "";
  applyDigestProgress({
    phase: "start",
    level: "daily",
    periodLabel: day,
    message: formatParallelDailyStatus() + "（先 summarize sessions）" + reason
  });
  try {
    const result = await agentResume.runDailyDigest({
      date: day
    });
    const ready = result.summaryReadyCount ?? result.snippetCount ?? 0;
    const still = generatingDays.size > 1; // will delete self in finally after this check
    const msg = `日报 ${day} OK · ${result.replaced ? "覆盖" : "新建"} · ${result.sessionCount} sessions · summary ${ready}${formatSummaryEnsureStats(
      result
    )}${result.embedded ? " · embedded" : ""}`;
    if (still) {
      // Other days still running — keep progress open with multi status
      applyDigestProgress({
        phase: "start",
        level: "daily",
        periodLabel: day,
        message: `${msg} · 仍在生成：${[...generatingDays].filter((d) => d !== day).sort().join(" · ")}`
      });
    } else {
      setGenFinal(msg, "ok");
    }
    await loadMemory();
    if (detailFocus?.type === "day" && detailFocus.key === day) {
      renderFocusDigestDetail("day", day);
    }
  } catch (error) {
    const err = error instanceof Error ? error.message : String(error);
    if (generatingDays.size > 1) {
      applyDigestProgress({
        phase: "error",
        level: "daily",
        periodLabel: day,
        message: `日报 ${day} 失败：${err} · 仍在生成：${[...generatingDays].filter((d) => d !== day).sort().join(" · ")}`
      });
    } else if (isLlmConfigError(error)) {
      handleDigestError("日报", error);
    } else {
      setGenFinal(`日报 ${day} 失败：${err}`, "error");
    }
  } finally {
    markDayGenerating(day, false);
    if (generatingDays.size > 0) {
      applyDigestProgress({
        phase: "start",
        level: "daily",
        periodLabel: day,
        message: formatParallelDailyStatus()
      });
    }
  }
}

/**
 * @param {string} [weekKey]
 */
async function runWeekly(weekKey) {
  const week = weekKey || getActivePeriods().week;
  if (weeklyMonthlyBusy || generatingDays.size > 0) {
    setGenFinal("有任务进行中，请稍候再生成周报…", "error");
    return;
  }
  if (!(await ensureLlmReady("周报"))) return;
  weeklyMonthlyBusy = true;
  generatingPeriodKey = `weekly:${week}`;
  detailFocus = { type: "week", key: week };
  syncWeeklyMonthlyButtons();
  renderCalendar();
  hideGenSessionRow();
  showGeneratingDetail("week", week);
  applyDigestProgress({
    phase: "start",
    level: "weekly",
    periodLabel: week,
    message: `生成周报 ${week}…（先逐个更新本周待刷新日报）`
  });
  try {
    const result = await agentResume.runWeeklyDigest(week);
    setGenFinal(
      `周报 ${week} OK · ${result.replaced ? "覆盖" : "新建"} · sources ${result.sourceCount} (dailies ${
        result.usedDailies
      })${formatSummaryEnsureStats(result)}${result.embedded ? " · embedded" : ""}`,
      "ok"
    );
    await loadMemory();
  } catch (error) {
    handleDigestError("周报", error);
  } finally {
    generatingPeriodKey = null;
    weeklyMonthlyBusy = false;
    syncWeeklyMonthlyButtons();
    renderCalendar();
    refreshDetailFocus();
  }
}

/**
 * @param {string} [monthKey]
 */
async function runMonthly(monthKey) {
  const month = monthKey || getActivePeriods().month;
  if (weeklyMonthlyBusy || generatingDays.size > 0) {
    setGenFinal("有任务进行中，请稍候再生成月报…", "error");
    return;
  }
  if (!(await ensureLlmReady("月报"))) return;
  weeklyMonthlyBusy = true;
  generatingPeriodKey = `monthly:${month}`;
  detailFocus = { type: "month", key: month };
  syncWeeklyMonthlyButtons();
  renderCalendar();
  hideGenSessionRow();
  showGeneratingDetail("month", month);
  applyDigestProgress({
    phase: "start",
    level: "monthly",
    periodLabel: month,
    message: `生成月报 ${month}…（先更新本月日报，再更新周报）`
  });
  try {
    const result = await agentResume.runMonthlyDigest(month);
    setGenFinal(
      `月报 ${month} OK · ${result.replaced ? "覆盖" : "新建"} · sources ${result.sourceCount} (dailies ${
        result.usedDailies
      })${formatSummaryEnsureStats(result)}${result.embedded ? " · embedded" : ""}`,
      "ok"
    );
    await loadMemory();
  } catch (error) {
    handleDigestError("月报", error);
  } finally {
    generatingPeriodKey = null;
    weeklyMonthlyBusy = false;
    syncWeeklyMonthlyButtons();
    renderCalendar();
    refreshDetailFocus();
  }
}

function formatBackfillStats(label, s) {
  if (!s) return "";
  const fail = s.failed?.length || 0;
  return `${label}: ok ${s.ok?.length || 0} / skip ${s.skipped?.length || 0} / fail ${fail} (planned ${s.planned?.length || 0})`;
}

async function previewBackfill() {
  const status = $("backfillStatus");
  const maxDays = Number($("backfillMaxDays").value) || 400;
  const skipExisting = $("backfillSkipExisting").checked;
  setStatus(status, "Scanning catalog…");
  try {
    const p = await agentResume.previewBackfillDigests({ maxDays, skipExisting });
    setStatus(
      status,
      `Preview · sessions ${p.sessionRowsScanned} · days ${p.days.length} · weeks ${p.weeks.length} · months ${p.months.length} · ~${p.estimatedLlmCalls} LLM calls` +
        (p.days.length
          ? ` · range ${p.days[0]} → ${p.days[p.days.length - 1]}`
          : " · no activity days"),
      p.days.length ? "ok" : "error"
    );
  } catch (error) {
    setStatus(status, error instanceof Error ? error.message : String(error), "error");
  }
}

async function runBackfill() {
  const status = $("backfillStatus");
  const maxDays = Number($("backfillMaxDays").value) || 400;
  const skipExisting = $("backfillSkipExisting").checked;
  const skipEmbedding = $("backfillSkipEmbedding").checked;

  setStatus(status, "Scanning…");
  try {
    const preview = await agentResume.previewBackfillDigests({ maxDays, skipExisting });
    const ok = window.confirm(
      `将批量生成历史 digests（日→周→月）。\n\n` +
        `Sessions 扫描: ${preview.sessionRowsScanned}\n` +
        `Days: ${preview.days.length} · Weeks: ${preview.weeks.length} · Months: ${preview.months.length}\n` +
        `预计 LLM 调用: ~${preview.estimatedLlmCalls}\n` +
        (preview.days.length
          ? `日期范围: ${preview.days[0]} → ${preview.days[preview.days.length - 1]}\n`
          : "") +
        `\n可能较慢并产生 API 费用。是否继续？`
    );
    if (!ok) {
      setStatus(status, "Cancelled");
      return;
    }

    setStatus(status, "Backfilling (daily → weekly → monthly)… this may take a while");
    const result = await agentResume.backfillDigests({
      maxDays,
      skipExisting,
      skipEmbedding
    });
    const parts = [
      formatBackfillStats("daily", result.daily),
      formatBackfillStats("weekly", result.weekly),
      formatBackfillStats("monthly", result.monthly)
    ];
    const fails =
      (result.daily.failed?.length || 0) +
      (result.weekly.failed?.length || 0) +
      (result.monthly.failed?.length || 0);
    if (fails && result.daily.failed?.[0]) {
      console.warn("backfill failures", {
        daily: result.daily.failed,
        weekly: result.weekly.failed,
        monthly: result.monthly.failed
      });
    }
    setStatus(status, parts.join(" · "), fails ? "error" : "ok");
    await loadMemory();
  } catch (error) {
    setStatus(status, error instanceof Error ? error.message : String(error), "error");
  }
}

/** @type {any[]} */
let gtdPreviewItems = [];

function gtdOptionsHtml(selected) {
  return ["inbox", "next", "waiting", "someday", "reference"]
    .map(
      (s) =>
        `<option value="${s}" ${s === selected ? "selected" : ""}>@${s}</option>`
    )
    .join("");
}

/**
 * @param {any[]} proposals
 * @param {string[]} [warnings]
 */
function renderGtdPreview(proposals, warnings) {
  gtdPreviewItems = (proposals || []).map((p) => ({ ...p }));
  const root = $("gtdPreview");
  root.innerHTML = "";
  if (!gtdPreviewItems.length) {
    const warnHtml =
      warnings?.length > 0
        ? `<ul class="gtd-empty-warnings">${warnings
            .map((w) => `<li>${escapeHtml(w)}</li>`)
            .join("")}</ul>`
        : "";
    root.innerHTML = `<div class="muted gtd-empty">
      <p>无 GTD 提议。</p>
      ${warnHtml || "<p>可能原因：该 digest 周期内无关联 session，或模型未给出可落库的 session id。</p>"}
      <p>可先确认当日有 session、日报已生成；或换 weekly/monthly 再试。</p>
    </div>`;
    return;
  }

  gtdPreviewItems.forEach((p, idx) => {
    const row = document.createElement("div");
    row.className = "gtd-row";
    row.dataset.idx = String(idx);
    const prev = p.previousGtd ? `@${p.previousGtd}` : "(none)";
    // Expanded by default; click head to collapse/expand body.
    row.innerHTML = `
      <div class="gtd-row-head" role="button" tabindex="0" title="点击折叠/展开">
        <span class="gtd-row-chevron" aria-hidden="true"></span>
        <div class="gtd-row-title">
          <strong>${escapeHtml(p.title || p.sessionId)}</strong>
          <div class="meta">${escapeHtml(p.provider)} · ${escapeHtml(
            String(p.sessionId).slice(0, 18)
          )}… · was ${escapeHtml(prev)}</div>
        </div>
        <button type="button" class="tool-btn gtd-add-btn" data-idx="${idx}">添加GTD</button>
      </div>
      <div class="gtd-edit-grid">
        <label>GTD
          <select class="gtd-status" data-idx="${idx}">${gtdOptionsHtml(p.proposedGtd)}</select>
        </label>
        <label>Reason
          <textarea class="gtd-reason" data-idx="${idx}" rows="2">${escapeHtml(p.reason || "")}</textarea>
        </label>
        <label>Tasks（每行一项）
          <textarea class="gtd-tasks" data-idx="${idx}" rows="3">${escapeHtml(
            (p.tasks || []).join("\n")
          )}</textarea>
        </label>
        <label>todolist.md（可编辑，添加时写入）
          <textarea class="gtd-md md" data-idx="${idx}" rows="8">${escapeHtml(
            p.todolistPreview || ""
          )}</textarea>
        </label>
      </div>
    `;
    root.appendChild(row);
  });

  root.querySelectorAll(".gtd-row-head").forEach((head) => {
    head.addEventListener("click", (e) => {
      // Don't toggle when clicking 添加GTD
      if (e.target.closest(".gtd-add-btn")) return;
      const row = head.closest(".gtd-row");
      if (!row) return;
      row.classList.toggle("collapsed");
    });
    head.addEventListener("keydown", (e) => {
      if (e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        head.click();
      }
    });
  });

  root.querySelectorAll(".gtd-add-btn").forEach((btn) => {
    btn.addEventListener("click", (e) => {
      e.stopPropagation();
      applyOneGtdItem(Number(btn.dataset.idx));
    });
  });

  root.querySelectorAll("textarea.gtd-md").forEach((ta) => {
    ta.addEventListener("focus", () => {
      if (ta.dataset.skipExpand === "1") return;
      openGtdMdEditor(ta);
    });
    ta.setAttribute("title", "聚焦后打开大编辑窗口");
  });
}

/** @type {HTMLTextAreaElement | null} */
let gtdMdSourceTa = null;

function ensureGtdMdOverlay() {
  let overlay = $("gtdMdOverlay");
  if (overlay) return overlay;

  overlay = document.createElement("div");
  overlay.id = "gtdMdOverlay";
  overlay.className = "gtd-md-overlay";
  overlay.hidden = true;
  overlay.innerHTML = `
    <div class="gtd-md-overlay-backdrop" data-gtd-md-close></div>
    <div class="gtd-md-overlay-panel" role="dialog" aria-label="todolist.md 编辑">
      <div class="gtd-md-overlay-head">
        <strong>todolist.md</strong>
        <span class="muted gtd-md-overlay-hint">Esc 或点完成关闭</span>
        <button type="button" class="tool-btn" data-gtd-md-close>完成</button>
      </div>
      <textarea class="gtd-md-overlay-ta" spellcheck="false"></textarea>
    </div>
  `;
  document.body.appendChild(overlay);

  const close = () => closeGtdMdEditor();
  overlay.querySelectorAll("[data-gtd-md-close]").forEach((el) => {
    el.addEventListener("click", close);
  });
  overlay.querySelector(".gtd-md-overlay-ta")?.addEventListener("keydown", (e) => {
    if (e.key === "Escape") {
      e.preventDefault();
      e.stopPropagation();
      closeGtdMdEditor();
    }
  });
  return overlay;
}

/**
 * Expand todolist.md into a large focused editor overlay.
 * @param {HTMLTextAreaElement} sourceTa
 */
function openGtdMdEditor(sourceTa) {
  if (!sourceTa) return;
  gtdMdSourceTa = sourceTa;
  const overlay = ensureGtdMdOverlay();
  const big = overlay.querySelector(".gtd-md-overlay-ta");
  if (!big) return;
  big.value = sourceTa.value;
  overlay.hidden = false;
  // blur source so re-focus can open again later
  sourceTa.blur();
  requestAnimationFrame(() => {
    big.focus();
    // place caret at end
    const len = big.value.length;
    big.setSelectionRange(len, len);
  });
}

function closeGtdMdEditor() {
  const overlay = $("gtdMdOverlay");
  if (!overlay || overlay.hidden) return;
  const big = overlay.querySelector(".gtd-md-overlay-ta");
  if (gtdMdSourceTa && big) {
    gtdMdSourceTa.value = big.value;
  }
  overlay.hidden = true;
  const back = gtdMdSourceTa;
  gtdMdSourceTa = null;
  // restore focus to small field without re-opening overlay
  if (back) {
    back.dataset.skipExpand = "1";
    back.focus();
    setTimeout(() => {
      delete back.dataset.skipExpand;
    }, 0);
  }
}

function collectEditedGtdItem(idx) {
  const p = gtdPreviewItems[idx];
  if (!p) return null;
  const root = $("gtdPreview");
  const statusEl = root.querySelector(`select.gtd-status[data-idx="${idx}"]`);
  const reasonEl = root.querySelector(`textarea.gtd-reason[data-idx="${idx}"]`);
  const tasksEl = root.querySelector(`textarea.gtd-tasks[data-idx="${idx}"]`);
  const mdEl = root.querySelector(`textarea.gtd-md[data-idx="${idx}"]`);
  const tasks = (tasksEl?.value || "")
    .split("\n")
    .map((t) => t.trim())
    .filter(Boolean);
  return {
    provider: p.provider,
    sessionId: p.sessionId,
    gtd: statusEl?.value || p.proposedGtd,
    reason: reasonEl?.value || "",
    tasks,
    sourceMemoryIds: p.sourceMemoryIds || [],
    title: p.title,
    projectPath: p.projectPath,
    previousGtd: p.previousGtd,
    todolistMarkdown: mdEl?.value || p.todolistPreview || ""
  };
}

/**
 * Run LLM GTD analysis for current scoped digest and write cache.
 * Called by「重新分析」or first open without cache.
 * @param {{ force?: boolean }} [opts]
 */
async function previewGtdSync(opts = {}) {
  const status = $("gtdSyncStatus");
  if (!gtdScoped?.memoryId) {
    setStatus(status, "请先在详情卡片点击「GTD分析」，指定要分析的 digest。", "error");
    return;
  }
  const { level, memoryId } = gtdScoped;

  // Safety: non-force callers should not re-hit LLM if cache exists
  if (!opts.force && gtdCacheByMemoryId.has(memoryId)) {
    restoreGtdCache(memoryId);
    return;
  }

  setStatus(status, `从当前 ${level} digest 分析 GTD…`);
  try {
    // Always scoped; never auto-generate today's daily.
    const result = await agentResume.previewMemoryGtdSync({
      ensureDigests: false,
      memoryIds: [memoryId]
    });
    renderGtdPreview(result.proposals, result.warnings);
    const warnPreview =
      result.warnings?.length > 0
        ? ` · ${result.warnings.slice(0, 2).join("；")}${result.warnings.length > 2 ? "…" : ""}`
        : "";
    const statusText =
      `可编辑预览 · ${result.proposals.length} 项 · 源 ${level}:${periodKeyFromMemoryId(level, memoryId)}` +
      (result.skipped.length ? ` · skipped ${result.skipped.length}` : "") +
      (result.warnings.length ? ` · warnings ${result.warnings.length}` : "") +
      warnPreview +
      " · 尚未落库（已缓存，重新分析可刷新）";
    setStatus(status, statusText, result.proposals.length ? "ok" : "error");
    gtdCacheByMemoryId.set(memoryId, {
      level,
      proposals: (result.proposals || []).map((p) => ({ ...p })),
      warnings: result.warnings || [],
      statusText
    });
    if (result.warnings.length) {
      console.warn("gtd preview warnings", result.warnings);
    }
  } catch (error) {
    gtdPreviewItems = [];
    $("gtdPreview").innerHTML = "";
    setStatus(status, error instanceof Error ? error.message : String(error), "error");
  }
}

/**
 * Apply a single GTD proposal row.
 * @param {number} idx
 */
async function applyOneGtdItem(idx) {
  const status = $("gtdSyncStatus");
  const item = collectEditedGtdItem(idx);
  if (!item) {
    setStatus(status, "无效的提议项", "error");
    return;
  }

  const btn = document.querySelector(`.gtd-add-btn[data-idx="${idx}"]`);
  if (btn) {
    btn.disabled = true;
    btn.textContent = "添加中…";
  }

  setStatus(status, `正在添加 GTD：${item.title || item.sessionId}…`);
  try {
    const result = await agentResume.applyMemoryGtdSync({ items: [item] });
    const sample = result.applied[0]?.todolistPath || "";
    if (result.applied.length) {
      setStatus(
        status,
        `已添加 GTD · ${item.title || item.sessionId}` + (sample ? ` · ${sample}` : ""),
        "ok"
      );
      // Remove applied row from preview
      const row = document.querySelector(`.gtd-row[data-idx="${idx}"]`);
      if (row) row.remove();
      gtdPreviewItems[idx] = null;
      if (!document.querySelector("#gtdPreview .gtd-row")) {
        $("gtdPreview").innerHTML = `<p class="muted">全部已添加。</p>`;
        gtdPreviewItems = [];
      }
      // Keep cache in sync (remaining rows only)
      snapshotGtdCache();
      const cached = gtdScoped?.memoryId && gtdCacheByMemoryId.get(gtdScoped.memoryId);
      if (cached) {
        cached.statusText =
          $("gtdSyncStatus")?.textContent ||
          `可编辑预览 · ${cached.proposals.length} 项（已添加部分）`;
      }
    } else {
      const err = result.failed?.[0]?.error || "落库失败";
      setStatus(status, err, "error");
      if (btn) {
        btn.disabled = false;
        btn.textContent = "添加GTD";
      }
    }
    if (result.failed?.length) {
      console.warn("gtd apply failed", result.failed);
    }
  } catch (error) {
    setStatus(status, error instanceof Error ? error.message : String(error), "error");
    if (btn) {
      btn.disabled = false;
      btn.textContent = "添加GTD";
    }
  }
}



let loadedSettings = null;

function resolvePanelHomeForDisplay(raw) {
  const trimmed = raw?.trim();
  return trimmed || "~/.agent-resume-panel";
}

function updateSettingsNotesRootDisplay() {
  const panelHome = $("settingsForm")?.panelHome?.value ?? "";
  const el = $("settingsNotesRootPath");
  if (el) el.textContent = `${resolvePanelHomeForDisplay(panelHome)}/notes`;
}

async function loadSettingsForm() {
  const s = await agentResume.getSettings();
  loadedSettings = s;
  const form = $("settingsForm");
  form.panelHome.value = s.panelHome || "";

  const toolBase = s.llm?.baseUrl || "";
  const toolModel = s.llm?.model || "";
  const toolKey = s.llm?.apiKey || "";
  form.llmBaseUrl.value = toolBase;
  form.llmModel.value = toolModel;
  form.llmApiKey.value = toolKey;
  form.llmLang.value = s.llm?.outputLanguage || "";

  // Conversation model: prefer chatLlm, else prefill from tool LLM
  form.chatBaseUrl.value = s.chatLlm?.baseUrl?.trim() || toolBase;
  form.chatModel.value = s.chatLlm?.model?.trim() || toolModel;
  form.chatApiKey.value = s.chatLlm?.apiKey?.trim() || toolKey;

  form.embBaseUrl.value = s.embedding?.baseUrl || "";
  form.embModel.value = s.embedding?.model || "";
  form.embApiKey.value = s.embedding?.apiKey || "";
  form.memoryEnabled.checked = Boolean(s.memory?.enabled);
  form.dailyHour.value = s.memory?.scheduleDailyHour ?? 22;
  form.weeklyHour.value = s.memory?.scheduleWeeklyHour ?? 9;
  form.monthlyHour.value = s.memory?.scheduleMonthlyHour ?? 9;
  form.codexHome.value = s.agentHomes?.codexHome || "~/.codex";
  form.claudeHome.value = s.agentHomes?.claudeHome || "~/.claude";
  form.antigravityHome.value = s.agentHomes?.antigravityHome || "~/.gemini";
  form.grokHome.value = s.agentHomes?.grokHome || "~/.grok";
  form.almaDataDir.value = s.agentHomes?.almaDataDir || "~/Library/Application Support/alma";
  form.opencodeHome.value = s.agentHomes?.opencodeHome || "~/.local/share/opencode";
  form.piHome.value = s.agentHomes?.piHome || "~/.pi/agent";
  form.syncMaxItems.value = s.sessionSync?.maxItems ?? 10000;
  form.syncStalePolicy.value = s.sessionSync?.stalePolicy || "hide";
  form.showArchivedCodex.checked = Boolean(s.sessionSync?.showArchivedCodex);
  form.showSubagentCodex.checked = Boolean(s.sessionSync?.showSubagentCodex);
  form.showArchivedOpenCode.checked = Boolean(s.sessionSync?.showArchivedOpenCode);
  form.showSubagentGrok.checked = Boolean(s.sessionSync?.showSubagentGrok);
  form.hideCronAlma.checked = s.sessionSync?.hideCronAlma !== false;
  form.hideChannelAlma.checked = s.sessionSync?.hideChannelAlma !== false;
  form.showIncognitoAlma.checked = Boolean(s.sessionSync?.showIncognitoAlma);
  if (form.workbenchScratchDir) {
    form.workbenchScratchDir.value = s.workbench?.scratchDir || "";
  }
  if (form.workbenchDefaultProvider) {
    form.workbenchDefaultProvider.value = s.workbench?.defaultNewSessionProvider || "codex";
  }
  if (form.workbenchProjectEditor) {
    form.workbenchProjectEditor.value = s.workbench?.projectEditor || "auto";
  }
  if (form.workbenchTerminalMode) {
    const mode = s.workbench?.terminalMode || "xterm";
    form.workbenchTerminalMode.value =
      mode === "external-ghostty" ? "external-system" : mode;
  }
  if (form.workbenchExternalLaunchMode) {
    form.workbenchExternalLaunchMode.value =
      s.workbench?.externalLaunchMode || s.ghosttyLaunchMode || "executeCommand";
  }
  updateSettingsNotesRootDisplay();
}

async function saveSettingsForm() {
  const form = $("settingsForm");
  const status = $("settingsStatus");
  const enabling = form.memoryEnabled.checked;
  if (enabling) {
    const ok = window.confirm(
      "启用定时分析后，Desktop 将在设定时刻读取 session 数据并调用工具 LLM / embedding API，可能产生费用。是否继续？"
    );
    if (!ok) {
      form.memoryEnabled.checked = false;
      return;
    }
  }

  const llmBaseUrl = form.llmBaseUrl.value.trim();
  const llmModel = form.llmModel.value.trim();
  const llmApiKey = form.llmApiKey.value;
  const chatBaseUrl = form.chatBaseUrl.value.trim();
  const chatModel = form.chatModel.value.trim();
  const chatApiKey = form.chatApiKey.value;

  const settings = {
    ...(loadedSettings || {}),
    panelHome: form.panelHome.value.trim() || undefined,
    llm: {
      ...(loadedSettings?.llm || {}),
      baseUrl: llmBaseUrl,
      model: llmModel,
      apiKey: llmApiKey,
      outputLanguage: form.llmLang.value.trim() || "zh-CN"
    },
    chatLlm: {
      ...(loadedSettings?.chatLlm || {}),
      baseUrl: chatBaseUrl || undefined,
      model: chatModel || undefined,
      apiKey: chatApiKey || undefined
    },
    embedding: {
      ...(loadedSettings?.embedding || {}),
      baseUrl: form.embBaseUrl.value.trim() || undefined,
      model: form.embModel.value.trim() || "text-embedding-3-small",
      apiKey: form.embApiKey.value || undefined
    },
    memory: {
      ...(loadedSettings?.memory || {}),
      enabled: form.memoryEnabled.checked,
      includeTranscripts: true,
      maxSessionsPerDigest: 40,
      snippetMaxChars: 2500,
      scheduleDailyHour: Number(form.dailyHour.value) || 22,
      scheduleWeeklyHour: Number(form.weeklyHour.value) || 9,
      scheduleMonthlyHour: Number(form.monthlyHour.value) || 9
    },
    agentHomes: {
      ...(loadedSettings?.agentHomes || {}),
      codexHome: form.codexHome.value.trim() || "~/.codex",
      claudeHome: form.claudeHome.value.trim() || "~/.claude",
      antigravityHome: form.antigravityHome.value.trim() || "~/.gemini",
      grokHome: form.grokHome.value.trim() || "~/.grok",
      almaDataDir: form.almaDataDir.value.trim() || "~/Library/Application Support/alma",
      opencodeHome: form.opencodeHome.value.trim() || "~/.local/share/opencode",
      piHome: form.piHome.value.trim() || "~/.pi/agent"
    },
    sessionSync: {
      ...(loadedSettings?.sessionSync || {}),
      maxItems: Math.max(1, Math.min(50000, Number(form.syncMaxItems.value) || 10000)),
      stalePolicy: form.syncStalePolicy.value === "purge" ? "purge" : "hide",
      showArchivedCodex: form.showArchivedCodex.checked,
      showSubagentCodex: form.showSubagentCodex.checked,
      showArchivedOpenCode: form.showArchivedOpenCode.checked,
      showSubagentGrok: form.showSubagentGrok.checked,
      hideCronAlma: form.hideCronAlma.checked,
      hideChannelAlma: form.hideChannelAlma.checked,
      showIncognitoAlma: form.showIncognitoAlma.checked
    },
    workbench: {
      ...(loadedSettings?.workbench || {}),
      scratchDir: form.workbenchScratchDir?.value.trim() || undefined,
      defaultNewSessionProvider: form.workbenchDefaultProvider?.value || "codex",
      projectEditor: form.workbenchProjectEditor?.value || "auto",
      terminalMode:
        form.workbenchTerminalMode?.value === "external-system" ? "external-system" : "xterm",
      externalLaunchMode: form.workbenchExternalLaunchMode?.value || "executeCommand"
    }
  };
  try {
    const result = await agentResume.saveSettings(settings);
    loadedSettings = result.settings;
    wbProjectEditorInfo = null;
    if (result.sync) lastSessionSyncAt = result.sync.syncedAt || Date.now();
    await refreshSessionViews({ quiet: true });
    const sched = result.schedulerEnabled ? " · scheduler ON" : " · scheduler OFF";
    setStatus(status, `Saved · ${result.file}${sched}`, "ok");
  } catch (error) {
    setStatus(status, error instanceof Error ? error.message : String(error), "error");
  }
}

/** @type {Array<{ role: 'user'|'assistant', content: string, citations?: any[], fallback?: boolean, streaming?: boolean }>} */
let chatTurns = [];
/** @type {Map<string, string>} */
const askMarkdownHtmlCache = new Map();
const ASK_MARKDOWN_CACHE_MAX = 200;
/** @type {number[]} */
let chatRowHeights = [];
let chatStickToBottom = true;
let chatVirtualScrollWired = false;
/** @type {{ start: number, end: number }} */
let chatVirtualLastRange = { start: -1, end: -1 };
const CHAT_VIRTUAL_GAP = 6;
const CHAT_VIRTUAL_OVERSCAN_PX = 360;
/** @type {number | null} */
let activeAskStreamIdx = null;
/** @type {(() => void) | null} */
let activeAskStreamOff = null;
/** @type {number | null} */
let chatContextTurnIdx = null;
let askCancelRequested = false;
let activeAskSendGen = 0;
/** @type {ReturnType<typeof setTimeout> | null} */
let askIndexProgressHideTimer = null;
/** @type {ReturnType<typeof setTimeout> | null} */
let askBackgroundStatusClearTimer = null;
/** @type {boolean} */
let askAuditLoaded = false;
/** @type {boolean} */
let askAuditLoading = false;

function hideAskIndexProgress(delayMs = 0) {
  if (askIndexProgressHideTimer) {
    clearTimeout(askIndexProgressHideTimer);
    askIndexProgressHideTimer = null;
  }
  const hide = () => {
    const progress = $("askIndexProgress");
    if (progress) progress.hidden = true;
  };
  if (delayMs > 0) {
    askIndexProgressHideTimer = setTimeout(hide, delayMs);
  } else {
    hide();
  }
}

function applyAskIndexProgress(event) {
  const progress = $("askIndexProgress");
  const text = $("askIndexProgressText");
  const count = $("askIndexProgressCount");
  const bar = $("askIndexProgressBar");
  if (!progress || !text || !count || !bar || !event) return;

  if (askIndexProgressHideTimer) {
    clearTimeout(askIndexProgressHideTimer);
    askIndexProgressHideTimer = null;
  }
  progress.hidden = false;
  progress.classList.toggle("is-scanning", event.phase === "scanning");
  progress.classList.toggle("is-error", event.phase === "error");
  text.textContent = event.noteTitle
    ? `${event.message || "正在索引笔记…"} · ${event.noteTitle}`
    : event.message || "正在索引笔记…";

  const total = Number(event.total) || 0;
  const current = Math.max(0, Number(event.current) || 0);
  let ratio = total > 0 ? current / total : 0;
  if (event.phase === "embedding" && total > 0 && event.chunkTotal) {
    ratio = (current + Math.min(1, (Number(event.chunkCurrent) || 0) / event.chunkTotal)) / total;
  }
  if (event.phase === "complete") ratio = 1;
  bar.style.width = `${Math.max(0, Math.min(100, ratio * 100))}%`;
  const displayCurrent = event.phase === "embedding" ? current + 1 : current;
  count.textContent = total > 0 ? `${Math.min(displayCurrent, total)}/${total}` : "";

  if (event.phase === "complete") {
    hideAskIndexProgress(1600);
  } else if (event.phase === "error") {
    hideAskIndexProgress(5000);
  }
}

function askAuditStatusLabel(status) {
  const labels = {
    proposed: "待确认",
    confirmed: "已确认",
    applied: "已执行",
    rejected: "已拒绝",
    failed: "失败"
  };
  return labels[status] || status || "未知";
}

function askAuditActionLabel(action) {
  const labels = {
    "note.create": "新建笔记",
    "note.append": "追加内容",
    "note.write": "修改笔记",
    "note.rename": "重命名",
    "note.move": "移动笔记",
    "note.delete": "删除笔记"
  };
  return labels[action] || action || "笔记操作";
}

function renderAskAuditList(events) {
  const list = $("askAuditList");
  if (!list) return;
  if (!events?.length) {
    list.innerHTML = `<p class="muted ask-audit-empty">暂无追踪记录</p>`;
    return;
  }
  list.innerHTML = events
    .map((event) => {
      const title = event.noteTitle || event.relMdPath || event.noteId || "未指定笔记";
      const meta = [formatTime(event.createdAtMs), event.actor || "ask", event.traceId ? `trace ${event.traceId.slice(0, 8)}` : ""]
        .filter(Boolean)
        .join(" · ");
      const error = event.error ? `<div class="ask-audit-error">${escapeHtml(event.error)}</div>` : "";
      return `<article class="ask-audit-item" data-status="${escapeHtml(event.status || "")}">
        <div class="ask-audit-item-main">
          <span class="ask-audit-action">${escapeHtml(askAuditActionLabel(event.action))}</span>
          <span class="ask-audit-note">${escapeHtml(title)}</span>
        </div>
        <div class="ask-audit-item-meta">
          <span class="ask-audit-status">${escapeHtml(askAuditStatusLabel(event.status))}</span>
          <span>${escapeHtml(meta)}</span>
        </div>
        ${error}
      </article>`;
    })
    .join("");
}

async function loadAskAudit() {
  if (askAuditLoading || typeof agentResume.listAskNoteAudit !== "function") {
    return;
  }
  askAuditLoading = true;
  const list = $("askAuditList");
  if (list) {
    list.innerHTML = `<p class="muted ask-audit-empty">加载追踪记录…</p>`;
  }
  try {
    const events = await agentResume.listAskNoteAudit({ limit: 80 });
    renderAskAuditList(events || []);
    askAuditLoaded = true;
  } catch (error) {
    if (list) {
      list.innerHTML = `<p class="status error ask-audit-empty">${escapeHtml(
        error instanceof Error ? error.message : String(error)
      )}</p>`;
    }
  } finally {
    askAuditLoading = false;
  }
}

function toggleAskAuditPanel(forceOpen) {
  const panel = $("askAuditPanel");
  const button = $("btnAskAudit");
  if (!panel) return;
  const open = forceOpen ?? panel.hidden;
  panel.hidden = !open;
  button?.classList.toggle("active", open);
  if (open && !askAuditLoaded) {
    void loadAskAudit();
  }
}

/** @type {Map<string, any>} */
const citationPreviewCache = new Map();
/** @type {ReturnType<typeof setTimeout> | null} */
let citationPreviewHideTimer = null;
/** @type {number} */
let citationPreviewHoverCount = 0;
/** @type {any | null} */
let activeCitationPreview = null;
/** @type {HTMLElement | null} */
let activeCitationChipEl = null;
/** @type {HTMLElement | null} */
let citationPopoverEl = null;

function citationLevelToFocusType(level) {
  if (level === "weekly") return "week";
  if (level === "monthly") return "month";
  return "day";
}

function citationToFocus(citation) {
  if (citation?.source === "note" || citation?.level === "note") return null;
  const level = citation?.level || "daily";
  const periodKey = periodKeyFromMemoryId(level, citation?.memoryId || "");
  if (!periodKey) return null;
  return { type: citationLevelToFocusType(level), key: periodKey, level };
}

function truncateDigestPreview(content, max = 900) {
  const t = String(content || "").trim();
  if (!t) return "";
  if (t.length <= max) return t;
  return `${t.slice(0, max)}…`;
}

function ensureCitationPopover() {
  if (citationPopoverEl) {
    return citationPopoverEl;
  }
  const popover = document.createElement("div");
  popover.id = "citationPopover";
  popover.className = "citation-popover";
  popover.hidden = true;
  popover.innerHTML = `
    <div class="citation-popover-content">
      <div class="citation-preview-head"></div>
      <div class="citation-preview-body"></div>
      <button type="button" class="citation-preview-open ghost-btn">在 Memory 中查看</button>
    </div>`;
  popover.addEventListener("mouseenter", () => bumpCitationPreviewHover(1));
  popover.addEventListener("mouseleave", () => bumpCitationPreviewHover(-1));
  popover.querySelector(".citation-preview-open")?.addEventListener("click", () => {
    if (activeCitationPreview) {
      void openCitationInMemory(activeCitationPreview);
    }
  });
  document.body.appendChild(popover);

  citationPopoverEl = popover;
  return popover;
}

function positionCitationPopover(anchor) {
  const popover = ensureCitationPopover();
  const rect = anchor.getBoundingClientRect();
  const gap = 8;
  const margin = 8;

  popover.hidden = false;
  popover.style.visibility = "hidden";
  const popRect = popover.getBoundingClientRect();
  const viewportW = window.innerWidth;
  const viewportH = window.innerHeight;

  let left = rect.right + gap;
  let placement = "right";
  if (left + popRect.width > viewportW - margin) {
    left = rect.left - gap - popRect.width;
    placement = "left";
  }
  left = Math.max(margin, Math.min(left, viewportW - popRect.width - margin));

  let top = rect.top;
  if (top + popRect.height > viewportH - margin) {
    top = viewportH - popRect.height - margin;
  }
  top = Math.max(margin, top);

  popover.style.left = `${Math.round(left)}px`;
  popover.style.top = `${Math.round(top)}px`;
  popover.dataset.placement = placement;
  popover.style.visibility = "";
}

function setActiveCitationChip(chip) {
  if (activeCitationChipEl && activeCitationChipEl !== chip) {
    activeCitationChipEl.classList.remove("is-active");
  }
  activeCitationChipEl = chip;
  if (chip) {
    chip.classList.add("is-active");
  }
}

function clearCitationPreviewHover() {
  citationPreviewHoverCount = 0;
  if (citationPreviewHideTimer) {
    clearTimeout(citationPreviewHideTimer);
    citationPreviewHideTimer = null;
  }
}

function bumpCitationPreviewHover(delta) {
  citationPreviewHoverCount = Math.max(0, citationPreviewHoverCount + delta);
  if (citationPreviewHoverCount > 0) {
    if (citationPreviewHideTimer) {
      clearTimeout(citationPreviewHideTimer);
      citationPreviewHideTimer = null;
    }
    return;
  }
  if (citationPreviewHideTimer) {
    clearTimeout(citationPreviewHideTimer);
  }
  citationPreviewHideTimer = setTimeout(() => hideCitationPreview(), 450);
}

function hideCitationPreview() {
  clearCitationPreviewHover();
  activeCitationPreview = null;
  setActiveCitationChip(null);
  if (citationPopoverEl) {
    citationPopoverEl.hidden = true;
  }
}

async function resolveCitationEntry(citation) {
  const sourceId = citation?.source === "note" ? citation?.noteId : citation?.memoryId;
  if (!sourceId) {
    return null;
  }
  if (citationPreviewCache.has(sourceId)) {
    return citationPreviewCache.get(sourceId);
  }
  if (citation.contentPreview) {
    const previewEntry = {
      id: sourceId,
      level: citation.level || "daily",
      title: citation.title || sourceId,
      content: citation.contentPreview
    };
    citationPreviewCache.set(sourceId, previewEntry);
    return previewEntry;
  }
  if (citation?.source === "note" || citation?.level === "note") {
    return null;
  }
  const memoryId = citation.memoryId;
  const fromCal = calEntries.find((e) => e.id === memoryId);
  if (fromCal?.content) {
    citationPreviewCache.set(memoryId, fromCal);
    return fromCal;
  }
  if (typeof agentResume.getMemoryEntry === "function") {
    const entry = await agentResume.getMemoryEntry(memoryId);
    if (entry) {
      citationPreviewCache.set(memoryId, entry);
      return entry;
    }
  }
  return null;
}

async function showCitationPreview(anchor, citation) {
  setActiveCitationChip(anchor);
  activeCitationPreview = citation;

  const popover = ensureCitationPopover();
  positionCitationPopover(anchor);
  const head = popover.querySelector(".citation-preview-head");
  const body = popover.querySelector(".citation-preview-body");
  if (head) head.textContent = "加载中…";
  if (body) body.innerHTML = "";

  const level = citation?.level || "daily";
  const isNote = citation?.source === "note" || level === "note";
  const focusType = citationLevelToFocusType(level);
  const levelLabel = isNote ? "笔记" : FOCUS_DIGEST_LABELS[focusType] || level;
  const openButton = popover.querySelector(".citation-preview-open");
  if (openButton) {
    openButton.textContent = isNote ? "在 Notes 中查看" : "在 Memory 中查看";
  }

  try {
    const entry = await resolveCitationEntry(citation);
    if (activeCitationPreview !== citation) return;
    const title = entry?.title || citation.title || citation.noteId || citation.memoryId || "引用";
    if (head) {
      head.innerHTML = `<span class="badge ${escapeHtml(level)}">${escapeHtml(levelLabel)}</span> ${escapeHtml(title)}`;
    }
    const preview = entry?.content ? truncateDigestPreview(entry.content) : "";
    if (body) {
      body.innerHTML = preview
        ? renderMarkdown(preview)
        : `<p class="muted">暂无预览内容${citation.noteId || citation.memoryId ? `（${escapeHtml(citation.noteId || citation.memoryId)}）` : ""}</p>`;
    }
    if (activeCitationChipEl) {
      positionCitationPopover(activeCitationChipEl);
    }
  } catch (error) {
    if (activeCitationPreview !== citation) return;
    const msg = error instanceof Error ? error.message : String(error);
    if (head) {
      head.textContent = citation.title || citation.noteId || citation.memoryId || "引用";
    }
    if (body) {
      body.innerHTML = `<p class="muted">预览加载失败：${escapeHtml(msg)}</p>`;
    }
    if (activeCitationChipEl) {
      positionCitationPopover(activeCitationChipEl);
    }
  }
}

async function openCitationInMemory(citation) {
  if (citation?.source === "note" || citation?.level === "note") {
    if (citation.operation === "delete") {
      hideCitationPreview();
      setStatus($("agentStatus"), "该笔记已被删除，无法在 Notes 中打开", "error");
      return;
    }
    if (!citation.noteId) {
      setStatus($("agentStatus"), "无法解析笔记引用", "error");
      return;
    }
    hideCitationPreview();
    closeAllSheets();
    switchTab("notes");
    await loadNotes();
    await openNoteInEditor(citation.noteId);
    return;
  }
  const focus = citationToFocus(citation);
  if (!focus) {
    setStatus($("agentStatus"), "无法解析引用报告", "error");
    return;
  }
  hideCitationPreview();
  closeAllSheets();
  switchTab("memory");

  if (focus.type === "day") {
    const [y, m] = focus.key.split("-").map(Number);
    if (Number.isFinite(y) && Number.isFinite(m)) {
      calView = { year: y, month: m - 1 };
    }
    selectedDayKey = focus.key;
    detailFocus = { type: "day", key: focus.key };
  } else if (focus.type === "week") {
    const monday = mondayOfIsoWeekLabel(focus.key);
    if (monday) {
      calView = { year: monday.getFullYear(), month: monday.getMonth() };
    }
    selectedDayKey = null;
    detailFocus = { type: "week", key: focus.key };
  } else if (focus.type === "month") {
    const [y, m] = focus.key.split("-").map(Number);
    if (Number.isFinite(y) && Number.isFinite(m)) {
      calView = { year: y, month: m - 1 };
    }
    selectedDayKey = null;
    detailFocus = { type: "month", key: focus.key };
  }

  updatePeriodLabel();
  try {
    await loadMemory();
    renderCalendar();
    await renderCalSessionList();
    renderFocusDigestDetail(focus.type, focus.key);
    setStatus($("memoryStatus"), `已打开 ${FOCUS_DIGEST_LABELS[focus.type] || ""} ${focus.key}`, "ok");
  } catch (error) {
    setStatus($("memoryStatus"), error instanceof Error ? error.message : String(error), "error");
  }
}

const NOTE_ACTION_OPERATIONS = new Set(["create", "write", "append"]);
const NOTE_ACTION_LABELS = { create: "新建", write: "修改", append: "追加" };

/** @type {Map<number, Set<string>>} */
const chatCitationExpanded = new Map();

function isNoteCitation(citation) {
  return citation?.source === "note" || citation?.level === "note";
}

function isMemoryCitation(citation) {
  if (isNoteCitation(citation)) {
    return false;
  }
  return citation?.source === "memory" || !citation?.source;
}

function partitionCitations(citations) {
  const memory = [];
  const notes = [];
  for (const c of citations || []) {
    if (isNoteCitation(c)) {
      notes.push(c);
    } else if (isMemoryCitation(c)) {
      memory.push(c);
    }
  }
  return { memory, notes };
}

function collectNoteActionCitations(citations) {
  /** @type {Map<string, { citation: object, index: number }>} */
  const byNoteId = new Map();
  for (let i = 0; i < (citations || []).length; i++) {
    const c = citations[i];
    if (!NOTE_ACTION_OPERATIONS.has(c.operation) || !isNoteCitation(c) || !c.noteId) {
      continue;
    }
    byNoteId.set(c.noteId, { citation: c, index: i });
  }
  return Array.from(byNoteId.values());
}

function isCitationSectionExpanded(turnIdx, group) {
  return chatCitationExpanded.get(turnIdx)?.has(group) ?? false;
}

function setCitationSectionExpanded(turnIdx, group, expanded) {
  let groups = chatCitationExpanded.get(turnIdx);
  if (!groups) {
    groups = new Set();
    chatCitationExpanded.set(turnIdx, groups);
  }
  if (expanded) {
    groups.add(group);
  } else {
    groups.delete(group);
  }
}

function estimateCitationBlocksHeight(turnIdx, citations) {
  if (!citations?.length) {
    return 0;
  }
  const { memory, notes } = partitionCitations(citations);
  const actions = collectNoteActionCitations(citations);
  let height = 0;
  if (actions.length) {
    const rows = Math.ceil(actions.length / 2);
    height += 8 + rows * 32;
  }
  for (const [group, items] of [
    ["memory", memory],
    ["note", notes]
  ]) {
    if (!items.length) {
      continue;
    }
    height += 30;
    if (isCitationSectionExpanded(turnIdx, group)) {
      height += 4 + items.length * 34;
    }
  }
  if (height > 0) {
    height += 8;
  }
  return height;
}

function buildCitationSection(group, label, citations, turnIdx) {
  const section = document.createElement("div");
  section.className = "citation-section";
  section.dataset.citationGroup = group;
  const expanded = isCitationSectionExpanded(turnIdx, group);
  if (!expanded) {
    section.classList.add("collapsed");
  }

  const head = document.createElement("button");
  head.type = "button";
  head.className = "citation-section-head";
  head.setAttribute("aria-expanded", expanded ? "true" : "false");
  head.innerHTML = `<span class="citation-section-chevron" aria-hidden="true"></span><span class="citation-section-label">${escapeHtml(label)} (${citations.length})</span>`;

  const body = document.createElement("div");
  body.className = "citation-section-body";
  for (const c of citations) {
    body.appendChild(buildCitationChip(c));
  }

  section.appendChild(head);
  section.appendChild(body);
  return section;
}

function buildCitationSections(citations, turnIdx) {
  const { memory, notes } = partitionCitations(citations);
  if (!memory.length && !notes.length) {
    return null;
  }
  const root = document.createElement("div");
  root.className = "citation-sections";
  if (memory.length) {
    root.appendChild(buildCitationSection("memory", "报告引用", memory, turnIdx));
  }
  if (notes.length) {
    root.appendChild(buildCitationSection("note", "笔记引用", notes, turnIdx));
  }
  return root;
}

function buildNoteActionBubbles(citations) {
  const actions = collectNoteActionCitations(citations);
  if (!actions.length) {
    return null;
  }
  const root = document.createElement("div");
  root.className = "note-action-bubbles";
  for (const { citation, index } of actions) {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "note-action-bubble";
    btn.dataset.citationIndex = String(index);
    const opLabel = NOTE_ACTION_LABELS[citation.operation] || "笔记";
    const title = citation.title || citation.noteId || "未命名笔记";
    btn.textContent = `${opLabel} · ${title}`;
    btn.title = `在 Notes 中打开：${title}`;
    root.appendChild(btn);
  }
  return root;
}

function toggleCitationSection(sectionEl, turnIdx) {
  const group = sectionEl.dataset.citationGroup;
  if (!group) {
    return;
  }
  const expanded = sectionEl.classList.toggle("collapsed") === false;
  setCitationSectionExpanded(turnIdx, group, expanded);
  const head = sectionEl.querySelector(".citation-section-head");
  if (head) {
    head.setAttribute("aria-expanded", expanded ? "true" : "false");
  }
  delete chatRowHeights[turnIdx];
  renderChatVirtual();
}

function buildCitationChip(citation) {
  const chip = document.createElement("span");
  chip.className = "citation-chip";
  if (citation.operation) {
    chip.dataset.operation = citation.operation;
  }
  const sess = citation.session
    ? ` · ${citation.session.provider}/${String(citation.session.id).slice(0, 10)}…`
    : "";
  const score = citation.score != null ? ` · ${Number(citation.score).toFixed(3)}` : "";
  const isNote = citation?.source === "note" || citation?.level === "note";
  const focusType = citationLevelToFocusType(citation.level || "daily");
  const levelLabel = isNote ? "笔记" : FOCUS_DIGEST_LABELS[focusType] || citation.level || "daily";
  const indexLabel = isNote ? `N${citation.index}` : citation.index;
  const heading = isNote && citation.heading ? ` · ${citation.heading}` : "";
  const operationLabels = {
    search: "🔍 搜索",
    read: "📖 读取",
    create: "➕ 新建",
    write: "✏️ 修改",
    append: "📝 追加",
    delete: "🗑 删除"
  };
  const operationLabel = operationLabels[citation.operation];
  const sourceLabel = operationLabel ? `${operationLabel} · ${levelLabel}` : levelLabel;
  chip.textContent = `[${indexLabel}] ${sourceLabel} · ${citation.title || citation.noteId || citation.memoryId}${heading}${score}${sess}`;
  chip.title = "悬停预览";
  chip.addEventListener("mouseenter", () => {
    bumpCitationPreviewHover(1);
    void showCitationPreview(chip, citation);
  });
  chip.addEventListener("mouseleave", () => bumpCitationPreviewHover(-1));
  return chip;
}

async function copyText(text) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    // fallback
    const ta = document.createElement("textarea");
    ta.value = text;
    document.body.appendChild(ta);
    ta.select();
    document.execCommand("copy");
    ta.remove();
    return true;
  }
}

function setAgentComposeEnabled(enabled) {
  const input = $("agentInput");
  const sendBtn = $("btnAgentSend");
  if (input) input.disabled = !enabled;
  if (sendBtn) sendBtn.disabled = !enabled;
}

function renderMarkdownCached(content) {
  const source = String(content ?? "");
  if (!source) {
    return "";
  }
  if (askMarkdownHtmlCache.has(source)) {
    const cached = askMarkdownHtmlCache.get(source);
    askMarkdownHtmlCache.delete(source);
    askMarkdownHtmlCache.set(source, cached);
    return cached;
  }
  const html = renderMarkdown(source);
  askMarkdownHtmlCache.set(source, html);
  if (askMarkdownHtmlCache.size > ASK_MARKDOWN_CACHE_MAX) {
    const oldest = askMarkdownHtmlCache.keys().next().value;
    askMarkdownHtmlCache.delete(oldest);
  }
  return html;
}

function clearAskMarkdownCache() {
  askMarkdownHtmlCache.clear();
}

function resetChatRowHeights() {
  chatRowHeights = [];
  chatCitationExpanded.clear();
}

function estimateChatRowHeight(turn, turnIdx = -1) {
  if (!turn) {
    return 48;
  }
  const chars = turn.content?.length || 0;
  const lines = Math.max(1, Math.ceil(chars / 46));
  if (turn.role === "user") {
    return Math.max(44, 28 + lines * 20);
  }
  let height = 62 + lines * 20;
  if (turn.citations?.length) {
    height += estimateCitationBlocksHeight(turnIdx, turn.citations);
  }
  if (turn.streaming) {
    height += 10;
  }
  return Math.min(Math.max(height, 52), 720);
}

function getChatRowHeight(idx) {
  const cached = chatRowHeights[idx];
  if (cached != null && cached > 0) {
    return cached;
  }
  return estimateChatRowHeight(chatTurns[idx], idx);
}

function buildChatRowOffsets() {
  const offsets = [];
  let total = 0;
  for (let i = 0; i < chatTurns.length; i++) {
    offsets.push(total);
    total += getChatRowHeight(i);
    if (i < chatTurns.length - 1) {
      total += CHAT_VIRTUAL_GAP;
    }
  }
  return { offsets, total };
}

function findChatVisibleRange(scrollTop, viewportHeight) {
  const n = chatTurns.length;
  const layout = buildChatRowOffsets();
  if (!n) {
    return { ...layout, start: 0, end: -1 };
  }

  const top = Math.max(0, scrollTop - CHAT_VIRTUAL_OVERSCAN_PX);
  const bottom = scrollTop + viewportHeight + CHAT_VIRTUAL_OVERSCAN_PX;

  let start = 0;
  for (let i = 0; i < n; i++) {
    const rowBottom = layout.offsets[i] + getChatRowHeight(i);
    if (rowBottom > top) {
      start = i;
      break;
    }
    start = i;
  }

  let end = start;
  for (let i = start; i < n; i++) {
    if (layout.offsets[i] >= bottom) {
      break;
    }
    end = i;
  }

  if (activeAskStreamIdx != null) {
    start = Math.min(start, activeAskStreamIdx);
    end = Math.max(end, activeAskStreamIdx);
  }

  return { ...layout, start, end };
}

function chatEmptyStateHtml() {
  return `<div class="chat-empty-state">
      <p class="chat-empty-title">开始对话</p>
      <p class="chat-empty-hint">用自然语言问记忆。先生成 Daily/Weekly digests 效果更好。</p>
    </div>`;
}

function ensureChatVirtualShell(log) {
  if (log.dataset.virtual === "1") {
    return {
      inner: log.querySelector(".chat-virtual-inner"),
      window: log.querySelector(".chat-virtual-window")
    };
  }
  log.innerHTML = "";
  log.dataset.virtual = "1";
  const inner = document.createElement("div");
  inner.className = "chat-virtual-inner";
  const win = document.createElement("div");
  win.className = "chat-virtual-window";
  inner.appendChild(win);
  log.appendChild(inner);
  if (!chatVirtualScrollWired) {
    chatVirtualScrollWired = true;
    log.addEventListener("scroll", onChatLogScroll, { passive: true });
  }
  return { inner, window: win };
}

function onChatLogScroll() {
  const log = $("chatLog");
  if (!log || !chatTurns.length) {
    return;
  }
  hideChatContextMenu();
  hideCitationPreview();
  if (log.scrollTop < 72 && askChatHasMoreOlder && !askChatLoadingOlder) {
    void loadOlderAskChat();
  }
  const atBottom = log.scrollHeight - log.scrollTop - log.clientHeight < 48;
  chatStickToBottom = atBottom;
  const { start, end } = findChatVisibleRange(log.scrollTop, log.clientHeight);
  if (start === chatVirtualLastRange.start && end === chatVirtualLastRange.end) {
    return;
  }
  renderChatVirtual();
}

function scrollChatToBottom() {
  const log = $("chatLog");
  if (log) {
    log.scrollTop = log.scrollHeight;
  }
}

function renderChatVirtual(opts = {}) {
  const log = $("chatLog");
  if (!log) {
    return;
  }

  if (!chatTurns.length) {
    log.dataset.virtual = "";
    log.innerHTML = chatEmptyStateHtml();
    resetChatRowHeights();
    return;
  }

  const { inner, window: win } = ensureChatVirtualShell(log);
  if (!inner || !win) {
    return;
  }

  const viewHeight = log.clientHeight || 0;
  const layoutPreview = buildChatRowOffsets();
  const scrollTop = opts.scrollToBottom
    ? Math.max(0, layoutPreview.total - viewHeight + 8)
    : log.scrollTop;
  let { start, end, offsets, total } = findChatVisibleRange(scrollTop, viewHeight);

  inner.style.height = `${total}px`;
  win.style.transform = `translateY(${offsets[start] || 0}px)`;
  win.replaceChildren();

  let heightsChanged = false;
  for (let i = start; i <= end; i++) {
    const row = buildChatTurnRow(chatTurns[i], i);
    win.appendChild(row);
    const measured = row.offsetHeight;
    if (measured > 0 && chatRowHeights[i] !== measured) {
      chatRowHeights[i] = measured;
      heightsChanged = true;
    }
  }

  if (heightsChanged) {
    const relayout = buildChatRowOffsets();
    inner.style.height = `${relayout.total}px`;
    win.style.transform = `translateY(${relayout.offsets[start] || 0}px)`;
    total = relayout.total;
  }

  chatVirtualLastRange = { start, end };

  if (opts.scrollToBottom) {
    requestAnimationFrame(() => {
      log.scrollTop = log.scrollHeight;
      chatStickToBottom = true;
    });
  }
}

function setAssistantBodyContent(contentEl, content, streaming) {
  if (!contentEl) {
    return;
  }
  if (streaming) {
    contentEl.classList.remove("markdown-body");
    contentEl.innerHTML = "";
    contentEl.textContent = content;
    return;
  }
  contentEl.classList.add("markdown-body");
  contentEl.innerHTML = renderMarkdownCached(content);
}

function updateStreamingBubble(idx) {
  const turn = chatTurns[idx];
  if (!turn || turn.role !== "assistant") {
    return;
  }
  const bubble = $("chatLog")?.querySelector(`[data-turn-idx="${idx}"]`);
  if (!bubble) {
    renderChatVirtual({ scrollToBottom: chatStickToBottom });
    return;
  }
  const body = bubble.querySelector(".chat-body");
  const contentEl = body?.querySelector(".chat-body-text");
  setAssistantBodyContent(contentEl, turn.content, true);
  const row = bubble.closest(".chat-message");
  if (row) {
    const measured = row.offsetHeight;
    if (measured > 0 && chatRowHeights[idx] !== measured) {
      chatRowHeights[idx] = measured;
      renderChatVirtual({ scrollToBottom: chatStickToBottom });
      return;
    }
  }
  if (chatStickToBottom) {
    scrollChatToBottom();
  }
}

function assistantStatusLabel(turn) {
  if (turn.streaming) {
    return "正在输入…";
  }
  return turn.fallback ? "近期摘要" : "记忆检索";
}

function appendChatFooter(bubble, turn, turnIdx) {
  const footer = document.createElement("div");
  footer.className = "chat-footer";

  const meta = document.createElement("span");
  meta.className = "chat-footer-meta";
  meta.textContent = assistantStatusLabel(turn);
  footer.appendChild(meta);

  if (!turn.streaming && turn.content) {
    const btnCopy = document.createElement("button");
    btnCopy.type = "button";
    btnCopy.className = "chat-copy-btn";
    btnCopy.textContent = "复制";
    btnCopy.addEventListener("click", async () => {
      await copyText(turn.content);
      setStatus($("agentStatus"), "已复制回答", "ok");
    });
    footer.appendChild(btnCopy);
  }

  bubble.appendChild(footer);
}

function buildChatTurnRow(turn, idx) {
  const row = document.createElement("div");
  row.className = `chat-message ${turn.role === "user" ? "chat-message-out" : "chat-message-in"}`;

  const bubble = document.createElement("div");
  bubble.className = `chat-bubble ${turn.role}${turn.streaming ? " streaming" : ""}`;
  bubble.dataset.turnIdx = String(idx);

  if (turn.role === "user") {
    bubble.textContent = turn.content;
    row.appendChild(bubble);
    return row;
  }

  const sender = document.createElement("div");
  sender.className = "chat-sender";
  sender.textContent = "Memory Agent";
  bubble.appendChild(sender);

  const body = document.createElement("div");
  body.className = "chat-body";
  const contentEl = document.createElement("div");
  contentEl.className = "chat-body-text";
  setAssistantBodyContent(contentEl, turn.content, turn.streaming);
  body.appendChild(contentEl);
  bubble.appendChild(body);

  if (turn.streaming) {
    const cursor = document.createElement("span");
    cursor.className = "chat-stream-cursor";
    cursor.setAttribute("aria-hidden", "true");
    body.appendChild(cursor);
    appendChatFooter(bubble, turn, idx);
    row.appendChild(bubble);
    return row;
  }

  const actionBubbles = buildNoteActionBubbles(turn.citations);
  if (actionBubbles) {
    bubble.appendChild(actionBubbles);
  }
  const citationSections = buildCitationSections(turn.citations, idx);
  if (citationSections) {
    bubble.appendChild(citationSections);
  }

  appendChatFooter(bubble, turn, idx);
  row.appendChild(bubble);
  return row;
}

function appendChatTurn(idx) {
  const turn = chatTurns[idx];
  if (!turn) {
    return;
  }
  chatRowHeights[idx] = estimateChatRowHeight(turn, idx);
  chatStickToBottom = true;
  renderChatVirtual({ scrollToBottom: true });
}

function updateChatTurn(idx) {
  if (!chatTurns[idx]) {
    return;
  }
  delete chatRowHeights[idx];
  renderChatVirtual({ scrollToBottom: chatStickToBottom });
}

function renderAskChat() {
  renderChatFull();
  askChatRendered = true;
}

function renderChatFull() {
  resetChatRowHeights();
  chatStickToBottom = true;
  chatVirtualLastRange = { start: -1, end: -1 };
  const log = $("chatLog");
  if (log) {
    log.dataset.virtual = "";
  }
  renderChatVirtual({ scrollToBottom: true });
}

function detachAskStreamListener() {
  if (activeAskStreamOff) {
    activeAskStreamOff();
    activeAskStreamOff = null;
  }
}

function stopAskStreamListener() {
  detachAskStreamListener();
  activeAskStreamIdx = null;
}

function isAskAbortedError(error) {
  return error instanceof DOMException && error.name === "AbortError";
}

function hideChatContextMenu() {
  const menu = $("chatContextMenu");
  if (menu) {
    menu.hidden = true;
  }
  chatContextTurnIdx = null;
}

function showChatUserContextMenu(event, turnIdx) {
  const turn = chatTurns[turnIdx];
  if (!turn || turn.role !== "user") {
    return;
  }
  event.preventDefault();
  event.stopPropagation();
  hideNotesContextMenu();
  hideWorkbenchContextMenu();
  chatContextTurnIdx = turnIdx;
  const menu = $("chatContextMenu");
  if (!menu) {
    return;
  }
  const resendBtn = menu.querySelector('[data-chat-action="resend"]');
  if (resendBtn) {
    resendBtn.disabled = !turn.content?.trim();
  }
  menu.hidden = false;
  const x = Math.min(event.clientX, window.innerWidth - 160);
  const y = Math.min(event.clientY, window.innerHeight - 100);
  menu.style.left = `${x}px`;
  menu.style.top = `${y}px`;
}

async function handleChatContextAction(action) {
  const idx = chatContextTurnIdx;
  hideChatContextMenu();
  const turn = chatTurns[idx];
  if (!turn || turn.role !== "user") {
    return;
  }
  if (action === "copy") {
    await copyText(turn.content);
    setStatus($("agentStatus"), "已复制", "ok");
    return;
  }
  if (action === "resend") {
    const content = turn.content?.trim();
    if (!content) {
      return;
    }
    if (activeAskStreamIdx != null) {
      await cancelActiveAsk({ reenableCompose: false });
    }
    await sendAgent(content);
  }
}

async function cancelActiveAsk(options = {}) {
  const { reenableCompose = true } = options;
  if (activeAskStreamIdx == null) {
    return;
  }
  askCancelRequested = true;
  if (typeof agentResume.cancelAskAgent === "function") {
    await agentResume.cancelAskAgent();
  }
  const streamIdx = activeAskStreamIdx;
  stopAskStreamListener();
  if (chatTurns[streamIdx]?.streaming) {
    chatTurns.splice(streamIdx, 1);
    renderChatFull();
  }
  hideAskIndexProgress(0);
  if (reenableCompose) {
    setAgentComposeEnabled(true);
  }
}

async function sendAgent(queryOverride) {
  const input = $("agentInput");
  const query = (typeof queryOverride === "string" ? queryOverride : input.value).trim();
  if (!query || activeAskStreamIdx != null) {
    return;
  }
  const sendGen = ++activeAskSendGen;

  // Auto-rename thread if it is still named "新对话"
  const activeThread = askThreads.find((t) => t.id === activeAskThreadId);
  if (activeThread && activeThread.title === "新对话") {
    const newTitle = query.slice(0, 30);
    activeThread.title = newTitle;
    void agentResume.renameAskThread({ id: activeAskThreadId, title: newTitle }).then(() => {
      renderAskThreadsSidebar();
      updateAskChatTitleHeader();
    });
  }

  chatTurns.push({ role: "user", content: query });
  if (typeof queryOverride !== "string") {
    input.value = "";
  }
  appendChatTurn(chatTurns.length - 1);
  setAgentComposeEnabled(false);
  setStatus($("agentStatus"), "检索记忆…");

  const history = chatTurns
    .filter((t) => t.role === "user" || t.role === "assistant")
    .slice(0, -1)
    .map((t) => ({ role: t.role, content: t.content }));

  const streamIdx = chatTurns.length;
  chatTurns.push({
    role: "assistant",
    content: "",
    citations: [],
    streaming: true
  });
  activeAskStreamIdx = streamIdx;
  appendChatTurn(streamIdx);

  detachAskStreamListener();
  if (typeof agentResume.onAskStream === "function") {
    activeAskStreamOff = agentResume.onAskStream((event) => {
      if (activeAskStreamIdx !== streamIdx) {
        return;
      }
      if (event.phase === "retrieving") {
        setStatus($("agentStatus"), "检索记忆…");
      } else if (event.phase === "indexing_notes") {
        applyAskIndexProgress(event);
        setStatus($("agentStatus"), event.message || "正在索引笔记…");
      } else if (event.phase === "generating") {
        hideAskIndexProgress();
        setStatus($("agentStatus"), event.message || "生成回答…");
      } else if (event.phase === "tool_calling") {
        setStatus($("agentStatus"), `调用工具: ${event.toolName || "…"}…`);
      } else if (event.phase === "tool_executing") {
        setStatus($("agentStatus"), `执行工具: ${event.toolName || "…"}`);
      } else if (event.phase === "chunk" && event.delta) {
        chatTurns[streamIdx].content += event.delta;
        updateStreamingBubble(streamIdx);
      }
    });
  }

  try {
    const result = await agentResume.askAgent({ query, history, threadId: activeAskThreadId, enableTools: askEnableTools });
    chatTurns[streamIdx] = {
      role: "assistant",
      content: result.answer,
      citations: result.citations || [],
      fallback: result.fallback
    };
    askChatLoadedFromDb = true;
    askChatRendered = true;
    updateChatTurn(streamIdx);
    if (result.persistWarning) {
      setStatus($("agentStatus"), result.persistWarning, "error");
    } else {
      setStatus(
        $("agentStatus"),
        result.fallback
          ? `完成 · ${result.citations?.length || 0} 条来源 · fallback 检索`
          : `完成 · ${result.citations?.length || 0} 条来源${result.toolCallsExecuted ? ` · ${result.toolCallsExecuted} 次工具调用` : ""}`,
        "ok"
      );
    }
    if (!$("askAuditPanel")?.hidden) {
      void loadAskAudit();
    }
  } catch (error) {
    if (askCancelRequested || isAskAbortedError(error)) {
      askCancelRequested = false;
      return;
    }
    chatTurns.splice(streamIdx, 1);
    renderChatFull();
    setStatus($("agentStatus"), error instanceof Error ? error.message : String(error), "error");
  } finally {
    if (sendGen !== activeAskSendGen) {
      return;
    }
    stopAskStreamListener();
    hideAskIndexProgress(800);
    setAgentComposeEnabled(true);
  }
}

async function loadAskChat(options = {}) {
  const render = options.render !== false;
  const force = options.force === true;

  if (askThreads.length === 0 || force) {
    try {
      askThreads = await agentResume.listAskThreads();
      if (askThreads.length > 0) {
        const savedId = localStorage.getItem("activeAskThreadId");
        if (savedId && askThreads.some((t) => t.id === savedId)) {
          activeAskThreadId = savedId;
        } else {
          activeAskThreadId = askThreads[0].id;
          localStorage.setItem("activeAskThreadId", activeAskThreadId);
        }
      } else {
        const thread = await agentResume.createAskThread({ title: "新对话" });
        askThreads = [thread];
        activeAskThreadId = thread.id;
        localStorage.setItem("activeAskThreadId", thread.id);
      }
      renderAskThreadsSidebar();
      updateAskChatTitleHeader();
    } catch (error) {
      setStatus($("agentStatus"), `加载对话列表失败：${error.message || error}`, "error");
      return;
    }
  }

  if (askChatLoadedFromDb && !force) {
    if (render && !askChatRendered) {
      renderAskChat();
    }
    return;
  }
  if (askChatLoadPromise && !force) {
    await askChatLoadPromise;
    if (render && !askChatRendered) {
      renderAskChat();
    }
    return;
  }
  if (typeof agentResume.listAskChat !== "function") {
    return;
  }

  askChatLoadPromise = (async () => {
    try {
      const result = await agentResume.listAskChat({ limit: ASK_CHAT_PAGE_SIZE, threadId: activeAskThreadId });
      chatTurns = mapAskMessages(result?.messages);
      askChatHasMoreOlder = Boolean(result?.hasMore);
      syncAskChatCursor();
      askChatLoadedFromDb = true;
      if (render) {
        renderAskChat();
      }
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      setStatus($("agentStatus"), `加载对话失败：${msg}`, "error");
    } finally {
      askChatLoadPromise = null;
    }
  })();

  await askChatLoadPromise;
}

async function loadOlderAskChat() {
  if (
    askChatLoadingOlder ||
    !askChatHasMoreOlder ||
    askChatOldestSortOrder == null ||
    typeof agentResume.listOlderAskChat !== "function"
  ) {
    return;
  }
  const log = $("chatLog");
  askChatLoadingOlder = true;
  const prevScrollHeight = log?.scrollHeight ?? 0;
  const prevScrollTop = log?.scrollTop ?? 0;
  try {
    const result = await agentResume.listOlderAskChat({
      beforeSortOrder: askChatOldestSortOrder,
      limit: ASK_CHAT_PAGE_SIZE,
      threadId: activeAskThreadId
    });
    const older = mapAskMessages(result?.messages);
    if (!older.length) {
      askChatHasMoreOlder = false;
      return;
    }
    chatTurns = [...older, ...chatTurns];
    askChatHasMoreOlder = Boolean(result?.hasMore);
    syncAskChatCursor();
    resetChatRowHeights();
    chatVirtualLastRange = { start: -1, end: -1 };
    renderChatVirtual();
    if (log) {
      requestAnimationFrame(() => {
        log.scrollTop = log.scrollHeight - prevScrollHeight + prevScrollTop;
        chatStickToBottom = false;
      });
    }
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    setStatus($("agentStatus"), `加载更早消息失败：${msg}`, "error");
  } finally {
    askChatLoadingOlder = false;
  }
}

async function clearChat() {
  if (activeAskStreamIdx != null) {
    return;
  }
  try {
    if (typeof agentResume.clearAskChat === "function") {
      await agentResume.clearAskChat({ threadId: activeAskThreadId });
    }
  } catch (error) {
    setStatus($("agentStatus"), error instanceof Error ? error.message : String(error), "error");
    return;
  }
  chatTurns = [];
  askChatLoadedFromDb = true;
  askChatRendered = true;
  askChatHasMoreOlder = false;
  askChatOldestSortOrder = null;
  clearAskMarkdownCache();
  resetChatRowHeights();
  renderChatFull();
  setStatus($("agentStatus"), "");
}

function loadAskSidebarCollapsedState() {
  const collapsedVal = localStorage.getItem("askSidebarCollapsed");
  const narrow = window.innerWidth < 760;
  setAskSidebarCollapsed(collapsedVal != null ? collapsedVal === "1" : narrow, { persist: collapsedVal != null });
}

function setAskSidebarCollapsed(collapsed, { persist = true } = {}) {
  askSidebarCollapsed = collapsed;
  $("askSidebarPane")?.classList.toggle("is-collapsed", collapsed);
  const btn = $("btnAskToggleSidebar");
  if (btn) {
    btn.setAttribute("aria-expanded", String(!collapsed));
    btn.title = collapsed ? "显示侧栏" : "隐藏侧栏";
  }
  if (persist) {
    localStorage.setItem("askSidebarCollapsed", collapsed ? "1" : "0");
  }
}

function toggleAskSidebarCollapsed() {
  setAskSidebarCollapsed(!askSidebarCollapsed);
}

async function handleNewAskChat() {
  try {
    const thread = await agentResume.createAskThread({ title: "新对话" });
    askThreads.unshift(thread);
    activeAskThreadId = thread.id;
    localStorage.setItem("activeAskThreadId", thread.id);

    chatTurns = [];
    resetChatRowHeights();
    chatVirtualLastRange = { start: -1, end: -1 };

    renderAskThreadsSidebar();
    updateAskChatTitleHeader();
    renderChatFull();

    $("agentInput")?.focus();
  } catch (error) {
    setStatus($("agentStatus"), `创建对话失败：${error.message || error}`, "error");
  }
}

function openAskRenameDialog() {
  const thread = askThreads.find((t) => t.id === activeAskThreadId);
  if (!thread) return;
  const dialog = $("askRenameDialog");
  const input = $("askRenameInput");
  if (dialog && input) {
    input.value = thread.title;
    dialog.hidden = false;
    input.focus();
    input.select();
  }
}

function closeAskRenameDialog() {
  const dialog = $("askRenameDialog");
  if (dialog) dialog.hidden = true;
}

async function confirmAskRename() {
  const input = $("askRenameInput");
  const title = input?.value.trim();
  if (!title) return;

  try {
    await agentResume.renameAskThread({ id: activeAskThreadId, title });
    const thread = askThreads.find((t) => t.id === activeAskThreadId);
    if (thread) {
      thread.title = title;
    }
    closeAskRenameDialog();
    renderAskThreadsSidebar();
    updateAskChatTitleHeader();
  } catch (error) {
    setStatus($("agentStatus"), `重命名失败：${error.message || error}`, "error");
  }
}

function updateAskChatTitleHeader() {
  const thread = askThreads.find((t) => t.id === activeAskThreadId);
  const titleHeader = $("askChatTitle");
  if (titleHeader) {
    titleHeader.textContent = thread ? thread.title : "Ask";
  }
}

function renderAskThreadsSidebar() {
  const list = $("askSidebarList");
  if (!list) return;
  list.innerHTML = "";

  for (const t of askThreads) {
    const row = document.createElement("button");
    row.type = "button";
    row.className = `ask-thread-row${t.id === activeAskThreadId ? " active" : ""}`;
    row.addEventListener("click", () => selectAskThread(t.id));

    const label = document.createElement("span");
    label.className = "ask-thread-row-label";
    label.textContent = t.title;
    label.title = t.title;
    row.appendChild(label);

    const delBtn = document.createElement("button");
    delBtn.type = "button";
    delBtn.className = "ask-thread-row-delete";
    delBtn.title = "删除对话";
    delBtn.innerHTML = `
      <svg viewBox="0 0 24 24" width="14" height="14" aria-hidden="true" style="pointer-events: none;">
        <path fill="currentColor" d="M6 19c0 1.1.9 2 2 2h8c1.1 0 2-.9 2-2V7H6v12zM19 4h-3.5l-1-1h-5l-1 1H5v2h14V4z"/>
      </svg>
    `;
    delBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      void deleteAskThreadConfirm(t.id);
    });
    row.appendChild(delBtn);

    list.appendChild(row);
  }
}

async function selectAskThread(threadId) {
  if (threadId === activeAskThreadId) return;
  activeAskThreadId = threadId;
  localStorage.setItem("activeAskThreadId", threadId);

  renderAskThreadsSidebar();
  updateAskChatTitleHeader();

  askChatLoadedFromDb = false;
  askChatRendered = false;
  await loadAskChat({ force: true });
}

async function deleteAskThreadConfirm(threadId) {
  const thread = askThreads.find((t) => t.id === threadId);
  if (!thread) return;
  if (!confirm(`确定要删除对话 "${thread.title}" 吗？`)) return;

  try {
    await agentResume.deleteAskThread({ id: threadId });
    askThreads = askThreads.filter((t) => t.id !== threadId);

    if (activeAskThreadId === threadId) {
      if (askThreads.length > 0) {
        activeAskThreadId = askThreads[0].id;
        localStorage.setItem("activeAskThreadId", activeAskThreadId);
      } else {
        activeAskThreadId = null;
        localStorage.removeItem("activeAskThreadId");
        await handleNewAskChat();
        return;
      }
    }

    renderAskThreadsSidebar();
    updateAskChatTitleHeader();

    askChatLoadedFromDb = false;
    askChatRendered = false;
    await loadAskChat({ force: true });
  } catch (error) {
    setStatus($("agentStatus"), `删除失败：${error.message || error}`, "error");
  }
}

function wire() {
  if (typeof agentResume.onDigestProgress === "function") {
    agentResume.onDigestProgress((event) => applyDigestProgress(event));
  }
  if (typeof agentResume.onNotesIndexProgress === "function") {
    agentResume.onNotesIndexProgress((event) => {
      applyAskIndexProgress(event);
      if (activeAskStreamIdx == null) {
        if (askBackgroundStatusClearTimer) {
          clearTimeout(askBackgroundStatusClearTimer);
          askBackgroundStatusClearTimer = null;
        }
        setStatus(
          $("agentStatus"),
          event.message || "正在索引笔记…",
          event.phase === "error" ? "error" : event.phase === "complete" ? "ok" : undefined
        );
        if (event.phase === "complete") {
          askBackgroundStatusClearTimer = setTimeout(() => {
            if (activeAskStreamIdx == null) setStatus($("agentStatus"), "");
          }, 1800);
        }
      }
    });
  }
  if (typeof agentResume.onSessionsSynced === "function") {
    agentResume.onSessionsSynced((result) => {
      lastSessionSyncAt = result.syncedAt || Date.now();
      void refreshSessionViews({ quiet: true });
      if (notesLoaded) renderNotesPanel();
      if (result.warnings?.length) setStatus($("memoryStatus"), result.warnings.join(" · "), "error");
    });
  }
  if (typeof agentResume.onSessionsSyncFailed === "function") {
    agentResume.onSessionsSyncFailed((message) => setStatus($("memoryStatus"), message, "error"));
  }

  loadSidebarFoldersCollapsedState();
  $("btnNotesToggleFolders")?.addEventListener("click", () => toggleNotesFoldersCollapsed());
  $("btnWbToggleFolders")?.addEventListener("click", () => toggleWbFoldersCollapsed());

  document.querySelectorAll(".primary-tabs .tab").forEach((btn) => {
    btn.addEventListener("click", () => {
      closeAllSheets();
      switchTab(btn.dataset.tab);
    });
  });

  $("btnOpenSettings").addEventListener("click", () => {
    closeAllSheets();
    switchTab("settings");
    showSettingsPane("provider");
  });
  $("btnSettingsBack").addEventListener("click", () => switchTab("memory"));
  document.querySelectorAll("[data-settings-pane]").forEach((btn) => {
    btn.addEventListener("click", () => {
      showSettingsPane(btn.dataset.settingsPane);
      if (btn.dataset.settingsPane === "usage") {
        loadUsagePage();
      }
    });
  });
  $("btnUsageRefresh")?.addEventListener("click", () => loadUsagePage());
  $("usageDays")?.addEventListener("change", () => loadUsagePage());
  $("btnOpenSessions").addEventListener("click", () => {
    openSheet("sheetSessions");
  });

  document.querySelectorAll("[data-close-sheet]").forEach((el) => {
    el.addEventListener("click", () => closeSheet(el.dataset.closeSheet));
  });

  $("btnRefreshSessions").addEventListener("click", () => syncAndRefreshSessionViews($("sessionsMeta")).catch(() => undefined));
  $("btnRefreshMemory").addEventListener("click", async () => {
    try {
      await syncAndRefreshSessionViews($("memoryStatus"));
      await loadMemory();
    } catch {
      // Old catalog and memory data remain visible.
    }
  });
  $("btnCalPrev").addEventListener("click", () => shiftCalMonth(-1));
  $("btnCalNext").addEventListener("click", () => shiftCalMonth(1));
  $("btnCalToday").addEventListener("click", () => goCalToday());
  $("calYearSelect")?.addEventListener("change", () => applyCalPicker());
  $("calMonthSelect")?.addEventListener("change", () => applyCalPicker());
  $("btnCalMonthDigest")?.addEventListener("click", () => onMonthButton());
  $("btnCalDetailBack")?.addEventListener("click", () => returnToCalDigestDetail());
  $("btnSaveSettings").addEventListener("click", () => saveSettingsForm());
  $("settingsForm")?.panelHome?.addEventListener("input", () => updateSettingsNotesRootDisplay());
  $("btnSettingsOpenNotesFolder")?.addEventListener("click", () => void agentResume.notesOpenFolder());
  $("btnSettingsOpenPanelHome")?.addEventListener("click", () => void agentResume.settingsOpenPanelHome());
  $("btnGtdPreview").addEventListener("click", () => previewGtdSync({ force: true }));
  $("btnBackfillPreview")?.addEventListener("click", () => previewBackfill());
  $("btnBackfillRun")?.addEventListener("click", () => runBackfill());
  loadAskSidebarCollapsedState();
  $("btnAskNewChat")?.addEventListener("click", () => handleNewAskChat());
  $("btnAskToggleSidebar")?.addEventListener("click", () => toggleAskSidebarCollapsed());
  $("btnAskRenameChat")?.addEventListener("click", () => openAskRenameDialog());
  $("btnAskRenameConfirm")?.addEventListener("click", () => confirmAskRename());
  document.querySelectorAll("[data-ask-rename-cancel]").forEach((el) => {
    el.addEventListener("click", () => closeAskRenameDialog());
  });
  $("askRenameInput")?.addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
      e.preventDefault();
      confirmAskRename();
    }
  });

  $("btnAgentSend").addEventListener("click", () => void sendAgent());
  $("chatLog")?.addEventListener("click", (e) => {
    const actionBtn = e.target.closest(".note-action-bubble");
    if (actionBtn) {
      e.preventDefault();
      const bubble = actionBtn.closest(".chat-bubble");
      const turnIdx = Number(bubble?.dataset.turnIdx);
      const citationIndex = Number(actionBtn.dataset.citationIndex);
      const citation = chatTurns[turnIdx]?.citations?.[citationIndex];
      if (citation) {
        void openCitationInMemory(citation);
      }
      return;
    }
    const sectionHead = e.target.closest(".citation-section-head");
    if (sectionHead) {
      e.preventDefault();
      const section = sectionHead.closest(".citation-section");
      const bubble = sectionHead.closest(".chat-bubble");
      const turnIdx = Number(bubble?.dataset.turnIdx);
      if (section && Number.isFinite(turnIdx)) {
        toggleCitationSection(section, turnIdx);
      }
    }
  });
  $("chatLog")?.addEventListener("contextmenu", (e) => {
    const bubble = e.target.closest(".chat-bubble.user");
    if (!bubble) {
      return;
    }
    const idx = Number(bubble.dataset.turnIdx);
    if (!Number.isFinite(idx)) {
      return;
    }
    showChatUserContextMenu(e, idx);
  });
  $("chatContextMenu")?.addEventListener("click", (e) => e.stopPropagation());
  document.querySelectorAll("[data-chat-action]").forEach((btn) => {
    btn.addEventListener("click", (e) => {
      e.stopPropagation();
      void handleChatContextAction(btn.dataset.chatAction);
    });
  });
  document.addEventListener("click", () => hideChatContextMenu());
  function syncAskToolsToggleUi(notifyStatus) {
    const btn = $("btnAgentTools");
    if (btn) {
      btn.classList.toggle("active", askEnableTools);
      btn.setAttribute("aria-pressed", String(askEnableTools));
      btn.title = askEnableTools ? "工具已开启：可通过对话操作笔记" : "开启后可通过对话操作笔记（新建/搜索）";
    }
    if (notifyStatus) {
      setStatus($("agentStatus"), askEnableTools ? "工具模式已开启" : "工具模式已关闭", askEnableTools ? "ok" : undefined);
    }
  }
  syncAskToolsToggleUi(false);
  $("btnAgentTools")?.addEventListener("click", () => {
    askEnableTools = !askEnableTools;
    syncAskToolsToggleUi(true);
  });
  $("btnAskAudit")?.addEventListener("click", () => toggleAskAuditPanel());
  $("btnAskAuditRefresh")?.addEventListener("click", () => loadAskAudit());
  $("btnClearChat").addEventListener("click", () => {
    if (activeAskThreadId) {
      void deleteAskThreadConfirm(activeAskThreadId);
    }
  });
  $("agentInput").addEventListener("keydown", (e) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      void sendAgent();
    }
  });

  $("btnWorkbenchNewSession")?.addEventListener("click", (e) => {
    e.stopPropagation();
    void handleWorkbenchNewSessionClick();
  });
  $("wbTargetSearch")?.addEventListener("input", (e) => {
    wbTargetPopoverSearch = e.target.value ?? "";
    renderWorkbenchTargetList();
  });
  $("btnWorkbenchNewTerminal")?.addEventListener("click", (e) => {
    e.stopPropagation();
    void openBlankWorkbenchTerminal();
  });
  $("btnWorkbenchRefresh")?.addEventListener("click", () => void loadWorkbenchSessions());
  $("btnWorkbenchRemove")?.addEventListener("click", () => void removeActiveWorkbenchSession());
  updateWorkbenchToolbarState();
  $("wbSearch")?.addEventListener("input", (e) => {
    wbSearch = e.target.value ?? "";
    renderWorkbenchSessionList();
  });
  $("tab-workbench")?.addEventListener("click", (e) => {
    if (shouldKeepWorkbenchSelection(e.target)) return;
    clearWorkbenchSelection();
  });
  $("wbContextMenu")?.addEventListener("click", (e) => e.stopPropagation());
  document.querySelectorAll("[data-wb-action]").forEach((btn) => {
    btn.addEventListener("click", (e) => {
      e.stopPropagation();
      void handleWorkbenchContextAction(btn.dataset.wbAction);
    });
  });
  document.addEventListener("click", () => hideWorkbenchContextMenu());
  $("btnWbRenameAuto")?.addEventListener("click", () => void runWorkbenchSessionAutoRename());
  $("btnWbRenameConfirm")?.addEventListener("click", () => {
    const title = $("wbRenameInput")?.value.trim();
    if (!title) {
      alertWorkbenchError(wbRenamePending?.kind === "project" ? "名称不能为空" : "标题不能为空");
      return;
    }
    const kind = wbRenamePending?.kind === "project" ? "project" : "manual";
    closeWorkbenchRenameDialog({ kind, title });
  });
  document.querySelectorAll("[data-wb-rename-cancel]").forEach((btn) => {
    btn.addEventListener("click", () => closeWorkbenchRenameDialog(null));
  });
  $("wbRenameInput")?.addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
      e.preventDefault();
      $("btnWbRenameConfirm")?.click();
    } else if (e.key === "Escape") {
      e.preventDefault();
      closeWorkbenchRenameDialog(null);
    }
  });
  document.addEventListener("contextmenu", (e) => {
    if (
      !e.target.closest(".chat-bubble.user") &&
      !e.target.closest("#chatContextMenu")
    ) {
      hideChatContextMenu();
    }
    if (
      !e.target.closest(".wb-list-item") &&
      !e.target.closest(".wb-folder-row") &&
      !e.target.closest("#wbContextMenu")
    ) {
      hideWorkbenchContextMenu();
    }
  });
  window.addEventListener("resize", () => fitWorkbenchTerminal());
  if (typeof ResizeObserver !== "undefined") {
    const stack = $("wbTerminalStack");
    if (stack) {
      wbResizeObserver?.disconnect();
      wbResizeObserver = new ResizeObserver(() => fitWorkbenchTerminal());
      wbResizeObserver.observe(stack);
    }
  }

  $("notesSearch")?.addEventListener("input", (e) => {
    notesSearch = e.target.value ?? "";
    renderNotesPanel();
  });
  $("notesFindInput")?.addEventListener("input", () => updateNotesFindResults({ select: true }));
  $("notesFindInput")?.addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
      e.preventDefault();
      navigateNotesFind(e.shiftKey ? -1 : 1, { focus: false });
    } else if (e.key === "Escape") {
      e.preventDefault();
      closeNotesFind();
    }
  });
  $("btnNotesFindPrev")?.addEventListener("click", () => navigateNotesFind(-1));
  $("btnNotesFindNext")?.addEventListener("click", () => navigateNotesFind(1));
  $("btnNotesFindClose")?.addEventListener("click", () => closeNotesFind());
  $("btnNotesNew")?.addEventListener("click", (e) => {
    e.stopPropagation();
    void handleNotesNewClick();
  });
  $("btnNotesImport")?.addEventListener("click", (e) => {
    e.stopPropagation();
    void handleNotesImportClick();
  });
  $("btnNotesRefresh")?.addEventListener("click", () => void loadNotes());
  $("btnNotesDelete")?.addEventListener("click", () => void deleteActiveNote());
  $("notesPreview")?.addEventListener("click", (e) => {
    const img = e.target?.closest?.("img");
    if (!img) return;
    e.preventDefault();
    openNotesImagePreview(img);
  });
  $("notesPreview")?.addEventListener("keydown", (e) => {
    const img = e.target?.closest?.("img");
    if (!img || (e.key !== "Enter" && e.key !== " ")) return;
    e.preventDefault();
    openNotesImagePreview(img);
  });
  $("notesImagePreview")?.addEventListener("click", (e) => {
    if (e.target === e.currentTarget) closeNotesImagePreview();
  });
  $("btnNotesImagePreviewClose")?.addEventListener("click", closeNotesImagePreview);
  updateNotesToolbarState();
  $("notesViewSegmented")?.querySelectorAll("[data-mode]").forEach((btn) => {
    btn.addEventListener("click", () => void switchNotesViewMode(btn.dataset.mode));
  });
  $("notesTargetSearch")?.addEventListener("input", (e) => {
    notesTargetPopoverSearch = e.target.value ?? "";
    renderNotesTargetList();
  });
  $("notesTargetPopover")?.querySelectorAll("[data-target-kind]").forEach((btn) => {
    btn.addEventListener("click", (e) => {
      e.stopPropagation();
      notesTargetPopoverKind = btn.dataset.targetKind || "library";
      $("notesTargetPopover")?.querySelectorAll("[data-target-kind]").forEach((tab) => {
        tab.classList.toggle("active", tab.dataset.targetKind === notesTargetPopoverKind);
      });
      renderNotesTargetList();
      $("notesTargetSearch")?.focus();
    });
  });
  document.addEventListener("keydown", (e) => {
    if (isFindShortcut(e) && canOpenNotesFind()) {
      e.preventDefault();
      openNotesFind();
      return;
    }
    if (
      e.metaKey &&
      !e.ctrlKey &&
      !e.altKey &&
      e.key?.toLowerCase() === "w" &&
      isWorkbenchActive() &&
      $("wbRenameDialog")?.hidden !== false &&
      $("wbTargetPopover")?.hidden !== false
    ) {
      e.preventDefault();
      void closeActiveWorkbenchTerminal();
      return;
    }
    if (e.key === "Escape") {
      if (isNotesImagePreviewOpen()) {
        closeNotesImagePreview();
        return;
      }
      if (notesFindOpen) {
        closeNotesFind();
        return;
      }
      hideNotesTargetPopover();
      hideWorkbenchTargetPopover();
      closeWorkbenchRenameDialog(null);
    }
  });
  document.querySelectorAll("[data-notes-action]").forEach((btn) => {
    btn.addEventListener("click", (e) => {
      e.stopPropagation();
      void handleNotesContextAction(btn.dataset.notesAction);
    });
  });
  mountNotesEditor();
  bindNotesTitleEdit($("notesEditorTitle"));
  $("tab-notes")?.addEventListener("click", (e) => {
    if (shouldKeepNotesSelection(e.target)) return;
    void clearNotesSelection();
  });
  document.addEventListener("click", (e) => {
    if (
      !e.target.closest("#wbTargetPopover") &&
      !e.target.closest("#btnWorkbenchNewSession")
    ) {
      hideWorkbenchTargetPopover();
    }
    if (
      !e.target.closest("#notesTargetPopover") &&
      !e.target.closest("#btnNotesNew") &&
      !e.target.closest("#btnNotesImport") &&
      !e.target.closest("#notesContextMenu")
    ) {
      hideNotesTargetPopover();
    }
    if (
      !e.target.closest("#notesContextMenu") &&
      !e.target.closest(".notes-list-item") &&
      !e.target.closest(".notes-folder-row")
    ) {
      hideNotesContextMenu();
    }
  });
}

function showSettingsPane(name) {
  const provider = $("settingsPaneProvider");
  const data = $("settingsPaneData");
  const general = $("settingsPaneGeneral");
  const usage = $("settingsPaneUsage");
  const form = $("settingsForm");
  const saveBar = $("settingsSaveBar");
  if (provider) provider.hidden = name !== "provider";
  if (data) data.hidden = name !== "data";
  if (general) general.hidden = name !== "general";
  if (usage) usage.hidden = name !== "usage";
  if (form) form.hidden = name === "usage";
  if (saveBar) saveBar.hidden = name === "usage";
  document.querySelectorAll("[data-settings-pane]").forEach((btn) => {
    btn.classList.toggle("active", btn.dataset.settingsPane === name);
  });
}

function fmtNum(n) {
  if (n == null || !Number.isFinite(Number(n))) return "—";
  return Number(n).toLocaleString();
}

async function loadUsagePage() {
  const status = $("usageStatus");
  const days = Number($("usageDays")?.value || 30);
  setStatus(status, "Loading usage…");
  try {
    const [summary, events, runs] = await Promise.all([
      agentResume.usageSummary({ days }),
      agentResume.usageListEvents({ days, limit: 80 }),
      agentResume.usageListScheduleRuns({ days, limit: 80 })
    ]);

    const cards = $("usageSummaryCards");
    if (cards) {
      const srcBits = (summary.bySource || [])
        .slice(0, 4)
        .map((s) => `${s.source}:${s.totalTokens}`)
        .join(" · ");
      cards.innerHTML = `
        <div class="usage-card"><div class="label">Total tokens</div><div class="value">${fmtNum(
          summary.totalTokens
        )}</div></div>
        <div class="usage-card"><div class="label">Prompt / Completion</div><div class="value" style="font-size:14px">${fmtNum(
          summary.promptTokens
        )} / ${fmtNum(summary.completionTokens)}</div></div>
        <div class="usage-card"><div class="label">Chat / Embed</div><div class="value" style="font-size:14px">${fmtNum(
          summary.chatTokens
        )} / ${fmtNum(summary.embeddingTokens)}</div></div>
        <div class="usage-card"><div class="label">Events</div><div class="value">${fmtNum(
          summary.eventCount
        )}</div></div>
        <div class="usage-card" style="grid-column:1/-1"><div class="label">By source</div><div class="value" style="font-size:12px;font-weight:500">${escapeHtml(
          srcBits || "—"
        )}</div></div>
      `;
    }

    const dayBody = $("usageByDayBody");
    if (dayBody) {
      dayBody.innerHTML = (summary.byDay || [])
        .map(
          (d) =>
            `<tr><td>${escapeHtml(d.day)}</td><td>${fmtNum(d.totalTokens)}</td><td>${fmtNum(
              d.events
            )}</td><td>${fmtNum(d.scheduleRuns)}</td></tr>`
        )
        .join("") || `<tr><td colspan="4" class="muted">暂无数据</td></tr>`;
    }

    const runsBody = $("scheduleRunsBody");
    if (runsBody) {
      runsBody.innerHTML =
        (runs || [])
          .map(
            (r) =>
              `<tr>
                <td>${escapeHtml(formatTime(r.startedAtMs))}</td>
                <td>${escapeHtml(r.level)}</td>
                <td>${escapeHtml(r.periodKey)}</td>
                <td>${escapeHtml(r.status)}</td>
                <td>${fmtNum(r.totalTokens)}</td>
                <td>${escapeHtml(r.error || "")}</td>
              </tr>`
          )
          .join("") || `<tr><td colspan="6" class="muted">暂无定时执行记录</td></tr>`;
    }

    const evBody = $("usageEventsBody");
    if (evBody) {
      evBody.innerHTML =
        (events || [])
          .map(
            (e) =>
              `<tr>
                <td>${escapeHtml(formatTime(e.createdAtMs))}</td>
                <td>${escapeHtml(e.kind)}</td>
                <td>${escapeHtml(e.source)}${e.jobKey ? ` · ${escapeHtml(e.jobKey)}` : ""}</td>
                <td>${escapeHtml(e.model || "")}</td>
                <td>${fmtNum(e.totalTokens)}</td>
                <td>${fmtNum(e.durationMs)}</td>
              </tr>`
          )
          .join("") || `<tr><td colspan="6" class="muted">暂无调用明细（生成 digests / Ask 后会出现）</td></tr>`;
    }

    setStatus(status, `近 ${days} 天 · ${summary.eventCount} 次调用`, "ok");
  } catch (error) {
    setStatus(status, error instanceof Error ? error.message : String(error), "error");
  }
}

async function boot() {
  initMarkdownHighlight();
  wire();
  refreshPinnedProjects();
  await refreshProjectAliases();
  selectedDayKey = todayInputValue();
  updatePeriodLabel();
  switchTab("memory");
  await loadSettingsForm();
  await loadMemory();
  void loadAskChat({ render: false });
  void syncAndRefreshSessionViews($("memoryStatus")).catch(() => undefined);
}

boot().catch((error) => {
  console.error(error);
  setStatus($("memoryStatus"), error instanceof Error ? error.message : String(error), "error");
});
