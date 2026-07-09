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

async function loadSessions() {
  const body = $("sessionsBody");
  body.innerHTML = "";
  $("sessionsMeta").textContent = "Loading…";
  try {
    const sessions = await agentResume.listSessions(500);
    $("sessionsMeta").textContent = `${sessions.length} sessions`;
    const frag = document.createDocumentFragment();
    for (const s of sessions) {
      const tr = document.createElement("tr");
      tr.innerHTML = `
        <td>${escapeHtml(s.title)}</td>
        <td class="provider">${escapeHtml(s.provider)}</td>
        <td title="${escapeHtml(s.projectPath)}">${escapeHtml(basename(s.projectPath))}</td>
        <td class="time">${escapeHtml(formatTime(s.updatedAt))}</td>
      `;
      frag.appendChild(tr);
    }
    body.appendChild(frag);
  } catch (error) {
    $("sessionsMeta").textContent = error instanceof Error ? error.message : String(error);
  }
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

function renderEntries(entries, scoreById) {
  const list = $("digestList");
  list.hidden = false;
  list.innerHTML = "";
  if (!entries.length) {
    list.innerHTML = `<p class="muted">无搜索结果。</p>`;
    return;
  }
  for (const e of entries) {
    const card = document.createElement("article");
    card.className = "digest-card";
    const level = e.level || "daily";
    const emb = e.embeddingJson ? " · embedding ✓" : "";
    const score = scoreById && scoreById[e.id] != null ? scoreById[e.id] : null;
    const scoreHtml =
      score != null ? `<span class="score">score ${score.toFixed(3)}</span>` : "";
    card.innerHTML = `
      <h3><span class="badge ${escapeHtml(level)}">${escapeHtml(level)}</span>${escapeHtml(
        e.title || e.id
      )}${scoreHtml}</h3>
      <div class="meta-line">${escapeHtml(formatTime(e.createdAtMs))}${emb}</div>
      <pre>${escapeHtml(e.content)}</pre>
    `;
    list.appendChild(card);
  }
}

function updateMonthLabel() {
  $("calMonthLabel").textContent = `${calView.year} 年 ${calView.month + 1} 月`;
}

function renderCalendar() {
  updateMonthLabel();
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
  $("dailyDate").value = dayKey;
  renderCalendar();
  renderDayDetail(dayKey);
}

function renderDayDetail(dayKey) {
  const detail = $("calDetail");
  const items = entriesForDay(dayKey);
  const daily = items.find((e) => e.level === "daily");
  const weeklies = items.filter((e) => e.level === "weekly");
  const monthlies = items.filter((e) => e.level === "monthly");

  let html = `<h3>${escapeHtml(dayKey)}</h3>
    <div class="detail-actions">
      <button type="button" id="btnDetailGenDaily">生成 / 覆盖该日日报</button>
    </div>`;

  if (!items.length) {
    html += `<p class="empty-hint">这一天还没有 digest。可点上方按钮生成日报。</p>`;
    detail.innerHTML = html;
    $("btnDetailGenDaily").addEventListener("click", () => {
      $("dailyDate").value = dayKey;
      runDaily();
    });
    return;
  }

  const blocks = [];
  if (daily) {
    blocks.push(daily);
  }
  blocks.push(...weeklies, ...monthlies);

  for (const e of blocks) {
    const emb = e.embeddingJson ? " · embedding ✓" : "";
    html += `
      <article class="digest-card" style="margin-bottom:10px">
        <h3><span class="badge ${escapeHtml(e.level)}">${escapeHtml(e.level)}</span>${escapeHtml(
          e.title || e.id
        )}</h3>
        <div class="meta-line">${escapeHtml(formatTime(e.createdAtMs))}${emb}</div>
        <pre>${escapeHtml(e.content)}</pre>
      </article>`;
  }

  detail.innerHTML = html;
  $("btnDetailGenDaily").addEventListener("click", () => {
    $("dailyDate").value = dayKey;
    runDaily();
  });
}

async function loadMemory() {
  $("digestList").hidden = true;
  $("digestList").innerHTML = "";
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
  $("dailyDate").value = selectedDayKey;
  loadMemory();
}

async function runDaily() {
  const status = $("memoryStatus");
  const date = $("dailyDate").value || undefined;
  setStatus(status, "Running daily digest…");
  try {
    const result = await agentResume.runDailyDigest(date);
    setStatus(
      status,
      `Daily OK · ${result.replaced ? "replaced" : "created"} · ${result.sessionCount} sessions · snippets ${
        result.snippetCount ?? 0
      }${result.embedded ? " · embedded" : ""}`,
      "ok"
    );
    if ($("dailyDate").value) {
      selectedDayKey = $("dailyDate").value;
      const parts = selectedDayKey.split("-").map(Number);
      if (parts.length === 3) {
        calView = { year: parts[0], month: parts[1] - 1 };
      }
    }
    await loadMemory();
  } catch (error) {
    setStatus(status, error instanceof Error ? error.message : String(error), "error");
  }
}

async function runWeekly() {
  const status = $("memoryStatus");
  const weekKey = $("weekKey").value.trim() || undefined;
  setStatus(status, "Running weekly digest…");
  try {
    const result = await agentResume.runWeeklyDigest(weekKey);
    setStatus(
      status,
      `Weekly OK · ${result.replaced ? "replaced" : "created"} · sources ${result.sourceCount} (dailies ${
        result.usedDailies
      })${result.embedded ? " · embedded" : ""}`,
      "ok"
    );
    await loadMemory();
  } catch (error) {
    setStatus(status, error instanceof Error ? error.message : String(error), "error");
  }
}

async function runMonthly() {
  const status = $("memoryStatus");
  const monthKey = $("monthKey").value || undefined;
  setStatus(status, "Running monthly digest…");
  try {
    const result = await agentResume.runMonthlyDigest(monthKey);
    setStatus(
      status,
      `Monthly OK · ${result.replaced ? "replaced" : "created"} · sources ${result.sourceCount} (W${
        result.usedWeeklies
      }/D${result.usedDailies})${result.embedded ? " · embedded" : ""}`,
      "ok"
    );
    await loadMemory();
  } catch (error) {
    setStatus(status, error instanceof Error ? error.message : String(error), "error");
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

async function runGtdSync() {
  const status = $("gtdSyncStatus");
  const ensureDigests = $("ensureDigests").checked;
  const ok = window.confirm(
    "将由 AI 直接改写 catalog 中的 GTD 状态，并覆盖写入 notes 下的 todolist.md。\n操作会标记为 AI 执行。是否继续？"
  );
  if (!ok) {
    return;
  }
  setStatus(status, "Running Memory→GTD sync (AI)…");
  try {
    const result = await agentResume.runMemoryGtdSync({ ensureDigests });
    const sample = result.applied[0]?.todolistPath || "";
    setStatus(
      status,
      `AI applied ${result.applied.length} session(s)` +
        (result.skipped.length ? ` · skipped ${result.skipped.length}` : "") +
        (result.warnings.length ? ` · warnings ${result.warnings.length}` : "") +
        (result.ensureDigest?.ran ? " · daily generated" : "") +
        (sample ? ` · e.g. ${sample}` : ""),
      result.applied.length || !result.warnings.length ? "ok" : "error"
    );
    if (result.warnings.length) {
      console.warn("gtd sync warnings", result.warnings);
    }
  } catch (error) {
    setStatus(status, error instanceof Error ? error.message : String(error), "error");
  }
}

async function runSearch() {
  const status = $("memoryStatus");
  const query = $("searchQuery").value.trim();
  if (!query) {
    setStatus(status, "请输入搜索词", "error");
    return;
  }
  const level = $("memoryLevel").value;
  setStatus(status, "Searching…");
  try {
    const hits = await agentResume.searchMemory({
      query,
      level: level === "all" ? undefined : level,
      limit: 20
    });
    const scoreById = {};
    for (const h of hits) {
      scoreById[h.entry.id] = h.score;
    }
    renderEntries(
      hits.map((h) => h.entry),
      scoreById
    );
    setStatus(
      status,
      hits.length
        ? `Found ${hits.length} hit(s). Digests without embeddings are skipped.`
        : "No hits. Generate digests with embedding configured, then retry.",
      hits.length ? "ok" : "error"
    );
  } catch (error) {
    setStatus(status, error instanceof Error ? error.message : String(error), "error");
  }
}

async function loadSettingsForm() {
  const s = await agentResume.getSettings();
  const form = $("settingsForm");
  form.panelHome.value = s.panelHome || "";
  form.llmBaseUrl.value = s.llm?.baseUrl || "";
  form.llmModel.value = s.llm?.model || "";
  form.llmApiKey.value = s.llm?.apiKey || "";
  form.llmLang.value = s.llm?.outputLanguage || "";
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
      "启用定时分析后，Desktop 将在设定时刻读取 session 数据并调用 LLM / embedding API，可能产生费用。是否继续？"
    );
    if (!ok) {
      form.memoryEnabled.checked = false;
      return;
    }
  }

  const settings = {
    panelHome: form.panelHome.value.trim() || undefined,
    llm: {
      baseUrl: form.llmBaseUrl.value.trim(),
      model: form.llmModel.value.trim(),
      apiKey: form.llmApiKey.value,
      outputLanguage: form.llmLang.value.trim() || "zh-CN"
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
  document.querySelectorAll(".tab").forEach((btn) => {
    btn.addEventListener("click", () => switchTab(btn.dataset.tab));
  });
  $("btnRefreshSessions").addEventListener("click", () => loadSessions());
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
  $("btnRunDaily").addEventListener("click", () => runDaily());
  $("btnRunWeekly").addEventListener("click", () => runWeekly());
  $("btnRunMonthly").addEventListener("click", () => runMonthly());
  $("btnSearch").addEventListener("click", () => runSearch());
  $("searchQuery").addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
      runSearch();
    }
  });
  $("btnSaveSettings").addEventListener("click", () => saveSettingsForm());
  $("btnGtdSync").addEventListener("click", () => runGtdSync());
  $("btnBackfillPreview").addEventListener("click", () => previewBackfill());
  $("btnBackfillRun").addEventListener("click", () => runBackfill());
  $("btnAgentSend").addEventListener("click", () => sendAgent());
  $("btnClearChat").addEventListener("click", () => clearChat());
  $("agentInput").addEventListener("keydown", (e) => {
    if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
      e.preventDefault();
      sendAgent();
    }
  });
}

async function boot() {
  wire();
  $("dailyDate").value = todayInputValue();
  $("monthKey").value = monthInputValue();
  renderChat();
  await loadPanelHome();
  await loadSettingsForm();
  await loadSessions();
  await loadMemory();
}

boot().catch((error) => {
  console.error(error);
  $("sessionsMeta").textContent = error instanceof Error ? error.message : String(error);
});
