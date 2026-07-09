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

function switchTab(name) {
  document.querySelectorAll(".tab").forEach((btn) => {
    btn.classList.toggle("active", btn.dataset.tab === name);
  });
  document.querySelectorAll(".panel").forEach((panel) => {
    panel.classList.toggle("active", panel.id === `tab-${name}`);
  });
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

async function loadMemory() {
  const list = $("digestList");
  list.innerHTML = "";
  try {
    const entries = await agentResume.listDailyDigests(30);
    if (!entries.length) {
      list.innerHTML = `<p class="muted">暂无 daily digest。配置 LLM 后点击「生成今日回顾」。</p>`;
      return;
    }
    for (const e of entries) {
      const card = document.createElement("article");
      card.className = "digest-card";
      const emb = e.embeddingJson ? " · embedding ✓" : "";
      card.innerHTML = `
        <h3>${escapeHtml(e.title || e.id)}</h3>
        <div class="meta-line">${escapeHtml(formatTime(e.createdAtMs))}${emb}</div>
        <pre>${escapeHtml(e.content)}</pre>
      `;
      list.appendChild(card);
    }
  } catch (error) {
    list.innerHTML = `<p class="status error">${escapeHtml(
      error instanceof Error ? error.message : String(error)
    )}</p>`;
  }
}

function todayInputValue() {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

async function runDaily() {
  const status = $("memoryStatus");
  const date = $("dailyDate").value || undefined;
  setStatus(status, "Running daily digest (may load transcripts)…");
  try {
    const result = await agentResume.runDailyDigest(date);
    const parts = [
      result.replaced ? "replaced" : "created",
      `${result.sessionCount} sessions`,
      `${result.snippetCount ?? 0} transcript snippets`,
      result.jobKey
    ];
    if (result.embedded) {
      parts.push("embedded");
    }
    setStatus(status, `OK · ${parts.join(" · ")}`, "ok");
    await loadMemory();
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
}

async function saveSettingsForm() {
  const form = $("settingsForm");
  const status = $("settingsStatus");
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
    memory: { enabled: false }
  };
  try {
    const result = await agentResume.saveSettings(settings);
    setStatus(status, `Saved · ${result.file}`, "ok");
    await loadPanelHome();
  } catch (error) {
    setStatus(status, error instanceof Error ? error.message : String(error), "error");
  }
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function wire() {
  document.querySelectorAll(".tab").forEach((btn) => {
    btn.addEventListener("click", () => switchTab(btn.dataset.tab));
  });
  $("btnRefreshSessions").addEventListener("click", () => loadSessions());
  $("btnRefreshMemory").addEventListener("click", () => loadMemory());
  $("btnRunDaily").addEventListener("click", () => runDaily());
  $("btnSaveSettings").addEventListener("click", () => saveSettingsForm());
}

async function boot() {
  wire();
  $("dailyDate").value = todayInputValue();
  await loadPanelHome();
  await loadSettingsForm();
  await loadSessions();
  await loadMemory();
}

boot().catch((error) => {
  console.error(error);
  $("sessionsMeta").textContent = error instanceof Error ? error.message : String(error);
});
