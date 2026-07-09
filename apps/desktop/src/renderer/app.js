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

function renderEntries(entries, scoreById) {
  const list = $("digestList");
  list.innerHTML = "";
  if (!entries.length) {
    list.innerHTML = `<p class="muted">暂无 memory 条目。先生成日报，再做周报/月报或语义搜索。</p>`;
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

async function loadMemory() {
  const level = $("memoryLevel").value;
  try {
    const entries = await agentResume.listMemory({
      level: level === "all" ? undefined : level,
      limit: 50
    });
    renderEntries(entries);
  } catch (error) {
    $("digestList").innerHTML = `<p class="status error">${escapeHtml(
      error instanceof Error ? error.message : String(error)
    )}</p>`;
  }
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
    $("memoryLevel").value = "daily";
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
    $("memoryLevel").value = "weekly";
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
    $("memoryLevel").value = "monthly";
    await loadMemory();
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

function wire() {
  document.querySelectorAll(".tab").forEach((btn) => {
    btn.addEventListener("click", () => switchTab(btn.dataset.tab));
  });
  $("btnRefreshSessions").addEventListener("click", () => loadSessions());
  $("btnRefreshMemory").addEventListener("click", () => loadMemory());
  $("memoryLevel").addEventListener("change", () => loadMemory());
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
}

async function boot() {
  wire();
  $("dailyDate").value = todayInputValue();
  $("monthKey").value = monthInputValue();
  await loadPanelHome();
  await loadSettingsForm();
  await loadSessions();
  await loadMemory();
}

boot().catch((error) => {
  console.error(error);
  $("sessionsMeta").textContent = error instanceof Error ? error.message : String(error);
});
