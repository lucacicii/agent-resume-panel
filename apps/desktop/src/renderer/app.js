/* global agentResume */

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

function switchTab(name) {
  document.querySelectorAll(".tab").forEach((btn) => {
    btn.classList.toggle("active", btn.dataset.tab === name);
  });
  document.querySelectorAll(".panel").forEach((panel) => {
    panel.classList.toggle("active", panel.id === `tab-${name}`);
  });
}

function todayInputValue() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function monthInputValue() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

async function loadPanelHome() {
  const home = await agentResume.getPanelHome();
  $("panelHomeLabel").textContent = `panelHome: ${home}`;
}

/** @type {any[]} */
let sessionsCache = [];
/** @type {string | null} */
let activeSessionKey = null;
/** @type {{ provider: string, id: string, title: string } | null} */
let activePreviewSession = null;
/** @type {ReturnType<typeof setInterval> | null} */
let sessionsRefreshTimer = null;
/** Fingerprint of last painted list (skip redraw when unchanged). */
let sessionsListFingerprint = "";
/** Prevent overlapping list loads. */
let sessionsLoadInFlight = false;

const SESSIONS_AUTO_REFRESH_MS = 15_000;

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
      <div class="s-meta">${escapeHtml(s.provider)} · ${escapeHtml(basename(s.projectPath))} · ${escapeHtml(
        formatTime(s.updatedAt)
      )}</div>
    `;
    btn.addEventListener("click", () => openSessionPreview(s));
    frag.appendChild(btn);
  }
  list.innerHTML = "";
  list.appendChild(frag);
}

/**
 * @param {{ quiet?: boolean }} [opts]
 * quiet: auto-refresh — no full-list Loading flash; skip paint if unchanged
 */
async function loadSessions(opts = {}) {
  const quiet = opts.quiet === true;
  const list = $("sessionsList");
  const meta = $("sessionsMeta");
  if (!list || !meta) return;
  if (sessionsLoadInFlight) return;
  sessionsLoadInFlight = true;

  if (!quiet) {
    list.innerHTML = "";
    meta.textContent = "Loading…";
  }

  try {
    const next = await agentResume.listSessions(500);
    const fp = sessionsFingerprint(next);
    sessionsCache = next;

    if (quiet && fp === sessionsListFingerprint) {
      meta.textContent = `${sessionsCache.length} sessions · 自动刷新 ${SESSIONS_AUTO_REFRESH_MS / 1000}s · 点击预览`;
      return;
    }

    sessionsListFingerprint = fp;
    renderSessionsList(sessionsCache);
    meta.textContent = `${sessionsCache.length} sessions · 自动刷新 ${SESSIONS_AUTO_REFRESH_MS / 1000}s · 点击预览`;
  } catch (error) {
    if (!quiet || !sessionsCache.length) {
      meta.textContent = error instanceof Error ? error.message : String(error);
    }
  } finally {
    sessionsLoadInFlight = false;
  }
}

function startSessionsAutoRefresh() {
  stopSessionsAutoRefresh();
  sessionsRefreshTimer = setInterval(() => {
    if (!isSessionsSheetOpen()) {
      stopSessionsAutoRefresh();
      return;
    }
    loadSessions({ quiet: true });
  }, SESSIONS_AUTO_REFRESH_MS);
}

function stopSessionsAutoRefresh() {
  if (sessionsRefreshTimer != null) {
    clearInterval(sessionsRefreshTimer);
    sessionsRefreshTimer = null;
  }
}

/**
 * @param {any} session
 * @param {{ summary?: string, statusHtml?: string }} [opts]
 */
async function openSessionPreview(session, opts = {}) {
  activeSessionKey = `${session.provider}:${session.id}`;
  activePreviewSession = {
    provider: session.provider,
    id: session.id,
    title: session.title
  };
  document.querySelectorAll(".session-row").forEach((el) => {
    el.classList.toggle("active", el.dataset.key === activeSessionKey);
  });
  const pane = $("sessionPreview");
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
    renderSessionPreviewPane(s, preview, summaryText, opts.statusHtml || "");
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
function renderSessionPreviewPane(s, preview, summaryText, statusHtml) {
  const pane = $("sessionPreview");
  let html = `
    <div class="session-preview-head">
      <h3 class="session-preview-title" id="sessionPreviewTitle">${escapeHtml(
        preview.title || s.title
      )}</h3>
      <div class="session-preview-actions">
        <button type="button" class="tool-btn" id="btnSessionSummarize">Summarize</button>
        <button type="button" class="tool-btn" id="btnSessionAutoRename">Auto Rename</button>
      </div>
    </div>
    <div class="muted session-preview-meta">
      ${escapeHtml(s.provider)} · ${escapeHtml(s.id)} · ${escapeHtml(s.projectPath)}
    </div>
    <p class="status" id="sessionAssistStatus">${statusHtml || ""}</p>
    <div class="session-summary-box ${summaryText ? "" : "hidden"}" id="sessionSummaryBox">
      <div class="session-summary-label">Summary</div>
      <div class="session-summary-body" id="sessionSummaryBody">${escapeHtml(summaryText)}</div>
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
  $("btnSessionSummarize")?.addEventListener("click", () => runSessionSummarize());
  $("btnSessionAutoRename")?.addEventListener("click", () => runSessionAutoRename());
}

function setSessionAssistBusy(busy, label) {
  const sumBtn = $("btnSessionSummarize");
  const renBtn = $("btnSessionAutoRename");
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

async function runSessionSummarize() {
  if (!activePreviewSession) return;
  const status = $("sessionAssistStatus");
  setSessionAssistBusy(true, "summarize");
  setStatus(status, "正在 Summarize…");
  try {
    const result = await agentResume.summarizeSession({
      provider: activePreviewSession.provider,
      id: activePreviewSession.id
    });
    const box = $("sessionSummaryBox");
    const body = $("sessionSummaryBody");
    if (box && body) {
      box.classList.remove("hidden");
      body.textContent = result.summary;
    }
    setStatus(status, "Summary 已生成并写入 catalog", "ok");
  } catch (error) {
    setStatus(status, error instanceof Error ? error.message : String(error), "error");
  } finally {
    setSessionAssistBusy(false);
  }
}

async function runSessionAutoRename() {
  if (!activePreviewSession) return;
  const status = $("sessionAssistStatus");
  setSessionAssistBusy(true, "rename");
  setStatus(status, "正在 Auto Rename…");
  try {
    const result = await agentResume.autoRenameSession({
      provider: activePreviewSession.provider,
      id: activePreviewSession.id
    });
    activePreviewSession.title = result.title;
    const titleEl = $("sessionPreviewTitle");
    if (titleEl) titleEl.textContent = result.title;

    const row = document.querySelector(`.session-row[data-key="${activeSessionKey}"] .s-title`);
    if (row) row.textContent = result.title;
    const cached = sessionsCache.find(
      (s) => s.provider === activePreviewSession.provider && s.id === activePreviewSession.id
    );
    if (cached) cached.title = result.title;

    let msg = `已重命名为「${result.title}」`;
    if (!result.nativeRenamed && result.nativeError) {
      msg += `（catalog 已更新；原生存储：${result.nativeError}）`;
    }
    setStatus(status, msg, result.nativeRenamed || !result.nativeError ? "ok" : "error");
  } catch (error) {
    setStatus(status, error instanceof Error ? error.message : String(error), "error");
  } finally {
    setSessionAssistBusy(false);
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
  const el = $(id);
  if (el) el.hidden = true;
  if (id === "sheetSessions") {
    stopSessionsAutoRefresh();
  }
}

function closeAllSheets() {
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
/** @type {string | null} YYYY-MM-DD */
let selectedDayKey = null;

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
  const el = $("currentPeriodLabel");
  if (!el) return;
  const p = getActivePeriods();
  el.textContent = `日 ${p.day} · 周 ${p.week} · 月 ${p.month}`;
}

function dayKeyFromDate(d) {
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
}

function dayKeyFromMs(ms) {
  return dayKeyFromDate(new Date(ms));
}

function monthRangeMs(year, month) {
  // pad grid: 7 days before month start, 14 after end
  const start = new Date(year, month, 1, 0, 0, 0, 0);
  start.setDate(start.getDate() - 10);
  const end = new Date(year, month + 1, 1, 0, 0, 0, 0);
  end.setDate(end.getDate() + 14);
  return { fromMs: start.getTime(), toMs: end.getTime() };
}

function filterLevel() {
  return $("memoryLevel").value;
}

function entryDayKey(entry) {
  if (entry.level === "daily" && typeof entry.id === "string" && entry.id.startsWith("daily:")) {
    return entry.id.slice("daily:".length);
  }
  return dayKeyFromMs(entry.periodStartMs);
}

function buildDayIndex(entries, levelFilter) {
  /** @type {Record<string, { daily?: any, weeklies: any[], monthlies: any[] }>} */
  const map = {};
  for (const e of entries) {
    const level = e.level || "daily";
    if (levelFilter !== "all" && level !== levelFilter) {
      continue;
    }
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
  loadMemory();
}

function renderCalendar() {
  syncCalPickers();
  updatePeriodLabel();
  const grid = $("calendarGrid");
  grid.innerHTML = "";
  const levelFilter = filterLevel();
  const index = buildDayIndex(calEntries, levelFilter);

  const first = new Date(calView.year, calView.month, 1);
  // Monday-based: getDay Sun=0 → convert
  let startOffset = first.getDay() - 1;
  if (startOffset < 0) {
    startOffset = 6;
  }
  const gridStart = new Date(calView.year, calView.month, 1 - startOffset);
  const todayKey = todayInputValue();

  for (let i = 0; i < 42; i++) {
    const d = new Date(gridStart.getFullYear(), gridStart.getMonth(), gridStart.getDate() + i);
    const key = dayKeyFromDate(d);
    const outside = d.getMonth() !== calView.month;
    const cell = document.createElement("button");
    cell.type = "button";
    cell.className = "cal-cell";
    if (outside) cell.classList.add("outside");
    if (key === todayKey) cell.classList.add("today");
    if (key === selectedDayKey) cell.classList.add("selected");
    cell.dataset.day = key;

    const marks = document.createElement("div");
    marks.className = "marks";
    const bucket = index[key];
    if (bucket?.daily) {
      const m = document.createElement("span");
      m.className = "mark daily";
      m.textContent = "D";
      m.title = bucket.daily.title || bucket.daily.id;
      marks.appendChild(m);
    }
    if (bucket?.weeklies?.length) {
      const m = document.createElement("span");
      m.className = "mark weekly";
      m.textContent = "W";
      m.title = bucket.weeklies.map((w) => w.title || w.id).join(", ");
      marks.appendChild(m);
    }
    if (bucket?.monthlies?.length) {
      const m = document.createElement("span");
      m.className = "mark monthly";
      m.textContent = "M";
      m.title = bucket.monthlies.map((x) => x.title || x.id).join(", ");
      marks.appendChild(m);
    }

    cell.innerHTML = `<span class="day-num">${d.getDate()}</span>`;
    cell.appendChild(marks);
    cell.addEventListener("click", () => selectDay(key));
    grid.appendChild(cell);
  }
}

function entriesForDay(dayKey) {
  const levelFilter = filterLevel();
  return calEntries.filter((e) => {
    const level = e.level || "daily";
    if (levelFilter !== "all" && level !== levelFilter) {
      return false;
    }
    return entryDayKey(e) === dayKey;
  });
}

function selectDay(dayKey) {
  selectedDayKey = dayKey;
  updatePeriodLabel();
  renderCalendar();
  renderDayDetail(dayKey);
}

function renderDayDetail(dayKey) {
  const detail = $("calDetail");
  const items = entriesForDay(dayKey);
  const daily = items.find((e) => e.level === "daily");
  const weeklies = items.filter((e) => e.level === "weekly");
  const monthlies = items.filter((e) => e.level === "monthly");

  if (!items.length) {
    detail.innerHTML = `<p class="empty-hint">这一天还没有 digest。可点上方「生成日报」。</p>`;
    return;
  }

  const blocks = [];
  if (daily) {
    blocks.push(daily);
  }
  blocks.push(...weeklies, ...monthlies);

  let html = "";
  for (const e of blocks) {
    const emb = e.embeddingJson ? " · embedding ✓" : "";
    html += `
      <article class="digest-card">
        <header class="digest-card-head">
          <h3><span class="badge ${escapeHtml(e.level)}">${escapeHtml(e.level)}</span>${escapeHtml(
            e.title || e.id
          )}</h3>
          <div class="meta-line">${escapeHtml(formatTime(e.createdAtMs))}${emb}</div>
        </header>
        <pre class="digest-body">${escapeHtml(e.content)}</pre>
      </article>`;
  }

  detail.innerHTML = html;
}

async function loadMemory() {
  setStatus($("memoryStatus"), "");
  try {
    const { fromMs, toMs } = monthRangeMs(calView.year, calView.month);
    calEntries = await agentResume.listMemory({
      fromMs,
      toMs,
      limit: 300
    });
    renderCalendar();
    if (selectedDayKey) {
      renderDayDetail(selectedDayKey);
    } else {
      $("calDetail").innerHTML = `<p class="muted">点击日历上的日期查看 digests，或生成该日日报。</p>`;
    }
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
  loadMemory();
}

function goCalToday() {
  const n = new Date();
  calView = { year: n.getFullYear(), month: n.getMonth() };
  selectedDayKey = todayInputValue();
  updatePeriodLabel();
  loadMemory();
}

function formatSummaryEnsureStats(result) {
  const summarized = result.summarizedCount ?? 0;
  const skipped = result.summarySkippedCount ?? 0;
  const failed = result.summaryFailed?.length ?? 0;
  if (!summarized && !skipped && !failed) return "";
  return ` · summarize +${summarized}/skip ${skipped}${failed ? `/fail ${failed}` : ""}`;
}

/** @type {Set<string>} */
const activeSummarizeSessions = new Set();

function showGenProgress() {
  const box = $("genProgress");
  if (!box) return;
  box.hidden = false;
  box.classList.remove("is-done", "is-error");
}

function hideGenSessionRow() {
  const row = $("genProgressSessionRow");
  const barWrap = $("genProgressBarWrap");
  if (row) row.hidden = true;
  if (barWrap) barWrap.hidden = true;
  activeSummarizeSessions.clear();
}

/**
 * @param {{ phase?: string, message?: string, index?: number, total?: number, session?: { provider?: string, id?: string, title?: string }, level?: string, periodLabel?: string }} event
 */
function applyDigestProgress(event) {
  const box = $("genProgress");
  const line = $("genProgressLine");
  const row = $("genProgressSessionRow");
  const sessionEl = $("genProgressSession");
  const barWrap = $("genProgressBarWrap");
  const bar = $("genProgressBar");
  if (!box || !line) return;

  showGenProgress();
  box.classList.remove("is-done", "is-error");
  line.classList.remove("is-ok", "is-error");

  if (event.message) {
    line.textContent = event.message;
  }

  const phase = event.phase || "";
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
    line.classList.add("is-ok");
    if (bar) bar.style.width = "100%";
    if (barWrap) barWrap.hidden = false;
  }

  if (phase === "error") {
    box.classList.add("is-error");
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
  box?.classList.remove("is-done", "is-error");
  if (kind === "ok") {
    line.classList.add("is-ok");
    box?.classList.add("is-done");
  }
  if (kind === "error") {
    line.classList.add("is-error");
    box?.classList.add("is-error");
    hideGenSessionRow();
  }
}

function setGenButtonsBusy(busy) {
  for (const id of ["btnRunDaily", "btnRunWeekly", "btnRunMonthly"]) {
    const btn = $(id);
    if (btn) btn.disabled = !!busy;
  }
}

async function runDaily() {
  const { day } = getActivePeriods();
  setGenButtonsBusy(true);
  hideGenSessionRow();
  applyDigestProgress({
    phase: "start",
    level: "daily",
    periodLabel: day,
    message: `生成日报 ${day}…（先 summarize sessions，再从 summary 提取）`
  });
  try {
    const result = await agentResume.runDailyDigest(day);
    const ready = result.summaryReadyCount ?? result.snippetCount ?? 0;
    setGenFinal(
      `日报 OK · ${result.replaced ? "覆盖" : "新建"} · ${result.sessionCount} sessions · summary ${ready}${formatSummaryEnsureStats(
        result
      )}${result.embedded ? " · embedded" : ""}`,
      "ok"
    );
    selectedDayKey = day;
    const parts = day.split("-").map(Number);
    if (parts.length === 3) {
      calView = { year: parts[0], month: parts[1] - 1 };
    }
    await loadMemory();
    renderDayDetail(day);
  } catch (error) {
    setGenFinal(error instanceof Error ? error.message : String(error), "error");
  } finally {
    setGenButtonsBusy(false);
  }
}

async function runWeekly() {
  const { week } = getActivePeriods();
  setGenButtonsBusy(true);
  hideGenSessionRow();
  applyDigestProgress({
    phase: "start",
    level: "weekly",
    periodLabel: week,
    message: `生成周报 ${week}…（无日报时会先 summarize sessions）`
  });
  try {
    const result = await agentResume.runWeeklyDigest(week);
    setGenFinal(
      `周报 OK · ${result.replaced ? "覆盖" : "新建"} · sources ${result.sourceCount} (dailies ${
        result.usedDailies
      })${formatSummaryEnsureStats(result)}${result.embedded ? " · embedded" : ""}`,
      "ok"
    );
    await loadMemory();
    if (selectedDayKey) renderDayDetail(selectedDayKey);
  } catch (error) {
    setGenFinal(error instanceof Error ? error.message : String(error), "error");
  } finally {
    setGenButtonsBusy(false);
  }
}

async function runMonthly() {
  const { month } = getActivePeriods();
  setGenButtonsBusy(true);
  hideGenSessionRow();
  applyDigestProgress({
    phase: "start",
    level: "monthly",
    periodLabel: month,
    message: `生成月报 ${month}…（无周报/日报时会先 summarize sessions）`
  });
  try {
    const result = await agentResume.runMonthlyDigest(month);
    setGenFinal(
      `月报 OK · ${result.replaced ? "覆盖" : "新建"} · sources ${result.sourceCount} (W${
        result.usedWeeklies
      }/D${result.usedDailies})${formatSummaryEnsureStats(result)}${result.embedded ? " · embedded" : ""}`,
      "ok"
    );
    await loadMemory();
    if (selectedDayKey) renderDayDetail(selectedDayKey);
  } catch (error) {
    setGenFinal(error instanceof Error ? error.message : String(error), "error");
  } finally {
    setGenButtonsBusy(false);
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

function updateGtdApplyButton() {
  const boxes = document.querySelectorAll("#gtdPreview input.gtd-check:checked");
  $("btnGtdApply").disabled = boxes.length === 0;
  $("btnGtdSelectAll").disabled = gtdPreviewItems.length === 0;
  $("btnGtdSelectNone").disabled = gtdPreviewItems.length === 0;
}

function gtdOptionsHtml(selected) {
  return ["inbox", "next", "waiting", "someday", "reference"]
    .map(
      (s) =>
        `<option value="${s}" ${s === selected ? "selected" : ""}>@${s}</option>`
    )
    .join("");
}

function renderGtdPreview(proposals) {
  gtdPreviewItems = (proposals || []).map((p) => ({ ...p }));
  const root = $("gtdPreview");
  root.innerHTML = "";
  if (!gtdPreviewItems.length) {
    root.innerHTML = `<p class="muted">无提议。请先有 weekly/monthly digests，再分析。</p>`;
    updateGtdApplyButton();
    return;
  }

  gtdPreviewItems.forEach((p, idx) => {
    const row = document.createElement("div");
    row.className = "gtd-row";
    const prev = p.previousGtd ? `@${p.previousGtd}` : "(none)";
    row.innerHTML = `
      <div class="gtd-row-head">
        <label>
          <input type="checkbox" class="gtd-check" data-idx="${idx}" checked />
          <span>
            <strong>${escapeHtml(p.title || p.sessionId)}</strong>
            <div class="meta">${escapeHtml(p.provider)} · ${escapeHtml(
              String(p.sessionId).slice(0, 18)
            )}… · was ${escapeHtml(prev)}</div>
          </span>
        </label>
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
        <label>todolist.md（可编辑，应用时写入）
          <textarea class="gtd-md md" data-idx="${idx}" rows="8">${escapeHtml(
            p.todolistPreview || ""
          )}</textarea>
        </label>
      </div>
    `;
    root.appendChild(row);
  });

  root.querySelectorAll("input.gtd-check").forEach((el) => {
    el.addEventListener("change", () => updateGtdApplyButton());
  });
  updateGtdApplyButton();
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

async function previewGtdSync() {
  const status = $("gtdSyncStatus");
  const ensureDigests = $("ensureDigests").checked;
  setStatus(status, "Analyzing weekly/monthly digests (preview only)…");
  $("btnGtdApply").disabled = true;
  try {
    const result = await agentResume.previewMemoryGtdSync({ ensureDigests });
    renderGtdPreview(result.proposals);
    setStatus(
      status,
      `可编辑预览 · ${result.proposals.length} 项` +
        (result.skipped.length ? ` · skipped ${result.skipped.length}` : "") +
        (result.warnings.length ? ` · warnings ${result.warnings.length}` : "") +
        (result.ensureDigest?.ran ? " · daily generated" : "") +
        " · 尚未落库",
      result.proposals.length ? "ok" : "error"
    );
    if (result.warnings.length) {
      console.warn("gtd preview warnings", result.warnings);
    }
  } catch (error) {
    gtdPreviewItems = [];
    $("gtdPreview").innerHTML = "";
    updateGtdApplyButton();
    setStatus(status, error instanceof Error ? error.message : String(error), "error");
  }
}

async function applyGtdSync() {
  const status = $("gtdSyncStatus");
  const checks = [...document.querySelectorAll("#gtdPreview input.gtd-check:checked")];
  if (!checks.length) {
    setStatus(status, "请先勾选要应用的项", "error");
    return;
  }

  const items = checks
    .map((el) => collectEditedGtdItem(Number(el.dataset.idx)))
    .filter(Boolean);

  const ok = window.confirm(
    `将按你编辑后的内容，对 ${items.length} 个 session 写入 GTD 并覆盖 todolist.md。\n操作标记为 AI。是否继续？`
  );
  if (!ok) {
    return;
  }

  setStatus(status, `Applying ${items.length} item(s)…`);
  try {
    const result = await agentResume.applyMemoryGtdSync({ items });
    const sample = result.applied[0]?.todolistPath || "";
    setStatus(
      status,
      `已落库 ${result.applied.length}` +
        (result.failed.length ? ` · failed ${result.failed.length}` : "") +
        (sample ? ` · e.g. ${sample}` : ""),
      result.applied.length ? "ok" : "error"
    );
    if (result.failed.length) {
      console.warn("gtd apply failed", result.failed);
    }
    if (result.applied.length) {
      gtdPreviewItems = [];
      $("gtdPreview").innerHTML = "";
      updateGtdApplyButton();
    }
  } catch (error) {
    setStatus(status, error instanceof Error ? error.message : String(error), "error");
  }
}

function gtdSelectAll(on) {
  document.querySelectorAll("#gtdPreview input.gtd-check").forEach((el) => {
    el.checked = on;
  });
  updateGtdApplyButton();
}



async function loadSettingsForm() {
  const s = await agentResume.getSettings();
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
    panelHome: form.panelHome.value.trim() || undefined,
    llm: {
      baseUrl: llmBaseUrl,
      model: llmModel,
      apiKey: llmApiKey,
      outputLanguage: form.llmLang.value.trim() || "zh-CN"
    },
    chatLlm: {
      baseUrl: chatBaseUrl || undefined,
      model: chatModel || undefined,
      apiKey: chatApiKey || undefined
    },
    embedding: {
      baseUrl: form.embBaseUrl.value.trim() || undefined,
      model: form.embModel.value.trim() || "text-embedding-3-small",
      apiKey: form.embApiKey.value || undefined
    },
    memory: {
      enabled: form.memoryEnabled.checked,
      includeTranscripts: true,
      maxSessionsPerDigest: 40,
      snippetMaxChars: 2500,
      scheduleDailyHour: Number(form.dailyHour.value) || 22,
      scheduleWeeklyHour: Number(form.weeklyHour.value) || 9,
      scheduleMonthlyHour: Number(form.monthlyHour.value) || 9
    }
  };
  try {
    const result = await agentResume.saveSettings(settings);
    const sched = result.schedulerEnabled ? " · scheduler ON" : " · scheduler OFF";
    setStatus(status, `Saved · ${result.file}${sched}`, "ok");
    await loadPanelHome();
  } catch (error) {
    setStatus(status, error instanceof Error ? error.message : String(error), "error");
  }
}

/** @type {Array<{ role: 'user'|'assistant', content: string, citations?: any[], fallback?: boolean }>} */
let chatTurns = [];

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

function renderChat() {
  const log = $("chatLog");
  log.innerHTML = "";
  if (!chatTurns.length) {
    log.innerHTML = `<p class="muted">向 Meta-Agent 提问。先生成 Daily/Weekly digests 效果更好。</p>`;
    return;
  }

  for (let i = 0; i < chatTurns.length; i++) {
    const turn = chatTurns[i];
    const bubble = document.createElement("div");
    bubble.className = `chat-bubble ${turn.role}`;
    if (turn.role === "user") {
      bubble.textContent = turn.content;
      log.appendChild(bubble);
      continue;
    }

    const meta = document.createElement("div");
    meta.className = "chat-meta";
    meta.textContent = turn.fallback
      ? "Assistant · fallback retrieval (recent digests)"
      : "Assistant · memory retrieval";
    bubble.appendChild(meta);

    const body = document.createElement("div");
    body.textContent = turn.content;
    bubble.appendChild(body);

    if (turn.citations?.length) {
      const list = document.createElement("div");
      list.className = "citation-list";
      for (const c of turn.citations) {
        const chip = document.createElement("div");
        chip.className = "citation-chip";
        const sess = c.session
          ? ` · ${c.session.provider}/${String(c.session.id).slice(0, 10)}…`
          : "";
        const score = c.score != null ? ` · ${Number(c.score).toFixed(3)}` : "";
        chip.textContent = `[${c.index}] ${c.level} · ${c.title}${score}${sess}`;
        list.appendChild(chip);
      }
      bubble.appendChild(list);
    }

    const actions = document.createElement("div");
    actions.className = "chat-actions";

    const btnCopy = document.createElement("button");
    btnCopy.type = "button";
    btnCopy.textContent = "Copy answer";
    btnCopy.addEventListener("click", async () => {
      await copyText(turn.content);
      setStatus($("agentStatus"), "Answer copied", "ok");
    });
    actions.appendChild(btnCopy);

    const session = (turn.citations || []).find((c) => c.session)?.session;
    const btnResume = document.createElement("button");
    btnResume.type = "button";
    btnResume.textContent = "Copy resume cmd";
    btnResume.disabled = !session;
    btnResume.title = session ? "" : "No linked session on citations (daily digests with links work best)";
    btnResume.addEventListener("click", async () => {
      if (!session) return;
      try {
        const res = await agentResume.buildResumeCommand({
          provider: session.provider,
          id: session.id
        });
        await copyText(res.command);
        setStatus($("agentStatus"), "Resume command copied", "ok");
      } catch (error) {
        setStatus($("agentStatus"), error instanceof Error ? error.message : String(error), "error");
      }
    });
    actions.appendChild(btnResume);

    const btnBrief = document.createElement("button");
    btnBrief.type = "button";
    btnBrief.textContent = "Copy handoff brief";
    btnBrief.addEventListener("click", async () => {
      try {
        const prevUser = [...chatTurns].slice(0, i).reverse().find((t) => t.role === "user");
        const res = await agentResume.buildHandoffBrief({
          query: prevUser?.content,
          answer: turn.content,
          citations: turn.citations || []
        });
        await copyText(res.markdown);
        setStatus($("agentStatus"), "Handoff brief copied", "ok");
      } catch (error) {
        setStatus($("agentStatus"), error instanceof Error ? error.message : String(error), "error");
      }
    });
    actions.appendChild(btnBrief);

    bubble.appendChild(actions);
    log.appendChild(bubble);
  }

  log.scrollTop = log.scrollHeight;
}

async function sendAgent() {
  const input = $("agentInput");
  const query = input.value.trim();
  if (!query) {
    return;
  }

  chatTurns.push({ role: "user", content: query });
  input.value = "";
  renderChat();
  setStatus($("agentStatus"), "Thinking…");

  const history = chatTurns
    .filter((t) => t.role === "user" || t.role === "assistant")
    .slice(0, -1)
    .map((t) => ({ role: t.role, content: t.content }));

  try {
    const result = await agentResume.askAgent({ query, history });
    chatTurns.push({
      role: "assistant",
      content: result.answer,
      citations: result.citations || [],
      fallback: result.fallback
    });
    renderChat();
    setStatus(
      $("agentStatus"),
      result.fallback
        ? `Done · ${result.citations?.length || 0} sources · fallback retrieval`
        : `Done · ${result.citations?.length || 0} sources`,
      "ok"
    );
  } catch (error) {
    chatTurns.pop();
    renderChat();
    setStatus($("agentStatus"), error instanceof Error ? error.message : String(error), "error");
  }
}

function clearChat() {
  chatTurns = [];
  renderChat();
  setStatus($("agentStatus"), "");
}

function wire() {
  if (typeof agentResume.onDigestProgress === "function") {
    agentResume.onDigestProgress((event) => applyDigestProgress(event));
  }

  document.querySelectorAll(".tab").forEach((btn) => {
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

  $("btnOpenGtd")?.addEventListener("click", () => openSheet("sheetGtd"));

  document.querySelectorAll("[data-close-sheet]").forEach((el) => {
    el.addEventListener("click", () => closeSheet(el.dataset.closeSheet));
  });

  $("btnRefreshSessions").addEventListener("click", () => loadSessions({ quiet: false }));
  window.addEventListener("focus", () => {
    if (isSessionsSheetOpen()) {
      loadSessions({ quiet: true });
    }
  });
  $("btnRefreshMemory").addEventListener("click", () => loadMemory());
  $("memoryLevel").addEventListener("change", () => {
    renderCalendar();
    if (selectedDayKey) {
      renderDayDetail(selectedDayKey);
    }
  });
  $("btnCalPrev").addEventListener("click", () => shiftCalMonth(-1));
  $("btnCalNext").addEventListener("click", () => shiftCalMonth(1));
  $("btnCalToday").addEventListener("click", () => goCalToday());
  $("calYearSelect")?.addEventListener("change", () => applyCalPicker());
  $("calMonthSelect")?.addEventListener("change", () => applyCalPicker());
  $("btnRunDaily").addEventListener("click", () => runDaily());
  $("btnRunWeekly").addEventListener("click", () => runWeekly());
  $("btnRunMonthly").addEventListener("click", () => runMonthly());
  $("btnSaveSettings").addEventListener("click", () => saveSettingsForm());
  $("btnGtdPreview").addEventListener("click", () => previewGtdSync());
  $("btnGtdApply").addEventListener("click", () => applyGtdSync());
  $("btnGtdSelectAll").addEventListener("click", () => gtdSelectAll(true));
  $("btnGtdSelectNone").addEventListener("click", () => gtdSelectAll(false));
  $("btnBackfillPreview")?.addEventListener("click", () => previewBackfill());
  $("btnBackfillRun")?.addEventListener("click", () => runBackfill());
  $("btnAgentSend").addEventListener("click", () => sendAgent());
  $("btnClearChat").addEventListener("click", () => clearChat());
  $("agentInput").addEventListener("keydown", (e) => {
    if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
      e.preventDefault();
      sendAgent();
    }
  });
}

function showSettingsPane(name) {
  const provider = $("settingsPaneProvider");
  const general = $("settingsPaneGeneral");
  const usage = $("settingsPaneUsage");
  const form = $("settingsForm");
  const saveBar = $("settingsSaveBar");
  if (provider) provider.hidden = name !== "provider";
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
  wire();
  selectedDayKey = todayInputValue();
  updatePeriodLabel();
  switchTab("memory");
  renderChat();
  await loadPanelHome();
  await loadSettingsForm();
  await loadMemory();
}

boot().catch((error) => {
  console.error(error);
  setStatus($("memoryStatus"), error instanceof Error ? error.message : String(error), "error");
});
