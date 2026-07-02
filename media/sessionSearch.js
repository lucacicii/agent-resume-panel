(function () {
  const vscode = acquireVsCodeApi();

  /** @type {{ projects: Array<{projectPath: string, name: string, sessionCount: number, favorited: boolean, compactPath: string}>, sessions: Array<{provider: string, id: string, title: string, projectPath: string, projectName: string, branch?: string, updatedAtLabel: string}> }} */
  let state = { projects: [], sessions: [] };
  let selectedProjectPath = null;
  let query = "";
  let previewLoadingKey = null;
  /** @type {{ provider: string, id: string } | null} */
  let activePreviewSession = null;

  const searchInput = document.getElementById("search");
  const chipsEl = document.getElementById("chips");
  const sessionsEl = document.getElementById("sessions");
  const previewOverlay = document.getElementById("preview-overlay");
  const previewTitle = document.getElementById("preview-title");
  const previewNotice = document.getElementById("preview-notice");
  const previewSummary = document.getElementById("preview-summary");
  const previewMessages = document.getElementById("preview-messages");
  const previewResume = document.getElementById("preview-resume");
  const previewResumeWith = document.getElementById("preview-resume-with");
  const previewSummarize = document.getElementById("preview-summarize");
  const previewAutoRename = document.getElementById("preview-auto-rename");
  const previewRename = document.getElementById("preview-rename");
  const previewClose = document.getElementById("preview-close");

  searchInput.addEventListener("input", () => {
    query = searchInput.value;
    renderSessions();
  });

  previewResume.addEventListener("click", () => {
    if (!activePreviewSession) {
      return;
    }
    vscode.postMessage({
      type: "previewResume",
      provider: activePreviewSession.provider,
      id: activePreviewSession.id
    });
  });

  previewResumeWith.addEventListener("click", () => {
    if (!activePreviewSession) {
      return;
    }
    vscode.postMessage({
      type: "previewResumeWith",
      provider: activePreviewSession.provider,
      id: activePreviewSession.id
    });
  });

  previewSummarize.addEventListener("click", () => {
    if (!activePreviewSession) {
      return;
    }
    setAiButtonsDisabled(true);
    vscode.postMessage({
      type: "summarize",
      provider: activePreviewSession.provider,
      id: activePreviewSession.id
    });
  });

  previewAutoRename.addEventListener("click", () => {
    if (!activePreviewSession) {
      return;
    }
    setAiButtonsDisabled(true);
    vscode.postMessage({
      type: "autoRename",
      provider: activePreviewSession.provider,
      id: activePreviewSession.id
    });
  });

  previewRename.addEventListener("click", () => {
    if (!activePreviewSession) {
      return;
    }
    previewRename.disabled = true;
    vscode.postMessage({
      type: "rename",
      provider: activePreviewSession.provider,
      id: activePreviewSession.id
    });
  });

  previewClose.addEventListener("click", closePreview);
  previewOverlay.addEventListener("click", (event) => {
    if (event.target === previewOverlay) {
      closePreview();
    }
  });

  window.addEventListener("message", (event) => {
    const message = event.data;
    if (message.type === "init") {
      state = {
        projects: message.projects || [],
        sessions: message.sessions || []
      };
      selectedProjectPath = null;
      query = searchInput.value;
      renderChips();
      renderSessions();
      syncPreviewTitle();
      previewRename.disabled = false;
      if (
        activePreviewSession &&
        !state.sessions.some(
          (entry) =>
            entry.provider === activePreviewSession.provider && entry.id === activePreviewSession.id
        )
      ) {
        closePreview();
      }
      return;
    }

    if (message.type === "previewLoading") {
      previewLoadingKey = sessionKey(message.provider, message.id);
      renderSessions();
      return;
    }

    if (message.type === "previewResult") {
      previewLoadingKey = null;
      renderSessions();
      if (message.error) {
        return;
      }
      showPreview(message);
      return;
    }

    if (message.type === "renameDone") {
      previewRename.disabled = false;
      return;
    }

    if (message.type === "titleUpdated") {
      previewTitle.textContent = message.title || "Session Preview";
      previewRename.disabled = false;
      setAiButtonsDisabled(false);
      syncPreviewTitle();
      return;
    }

    if (message.type === "summaryLoading") {
      renderSummary("Summarizing session...");
      return;
    }

    if (message.type === "summaryResult") {
      renderSummary(message.summary || "");
      setAiButtonsDisabled(false);
      return;
    }

    if (message.type === "summaryError") {
      renderSummary(message.error || "Summarize failed.", true);
      setAiButtonsDisabled(false);
      return;
    }

    if (message.type === "autoRenameDone") {
      setAiButtonsDisabled(false);
    }
  });

  function renderChips() {
    chipsEl.innerHTML = "";

    const allChip = createChip("All Projects", state.sessions.length, null, !selectedProjectPath, "Show sessions from all projects");
    chipsEl.appendChild(allChip);

    for (const project of state.projects) {
      const label = (project.favorited ? "★ " : "") + project.name;
      const chip = createChip(
        label,
        project.sessionCount,
        project.projectPath,
        selectedProjectPath === project.projectPath,
        project.compactPath
      );
      chipsEl.appendChild(chip);
    }
  }

  function createChip(label, count, projectPath, active, tooltip) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "chip" + (active ? " active" : "");
    button.title = tooltip || label;
    button.innerHTML = `${escapeHtml(label)}<span class="count">(${count})</span>`;
    button.addEventListener("click", () => {
      selectedProjectPath = projectPath;
      renderChips();
      renderSessions();
    });
    return button;
  }

  function renderSessions() {
    const filtered = state.sessions.filter(matchesSession);
    sessionsEl.innerHTML = "";

    if (!filtered.length) {
      const empty = document.createElement("div");
      empty.className = "empty-state";
      empty.textContent = selectedProjectPath
        ? "No sessions match in this project."
        : "No sessions match your search.";
      sessionsEl.appendChild(empty);
      return;
    }

    for (const session of filtered) {
      const row = document.createElement("div");
      row.className = "session-row";

      const body = document.createElement("button");
      body.type = "button";
      body.className = "session-body";

      const badge = document.createElement("span");
      badge.className = "provider-badge";
      badge.textContent = session.provider;

      const main = document.createElement("div");
      main.className = "session-main";

      const title = document.createElement("div");
      title.className = "session-title";
      title.textContent = session.title;

      const meta = document.createElement("div");
      meta.className = "session-meta";
      const metaParts = [];
      if (!selectedProjectPath) {
        metaParts.push(session.projectName);
      }
      if (session.branch) {
        metaParts.push(session.branch);
      }
      meta.textContent = metaParts.join(" · ");

      main.appendChild(title);
      if (metaParts.length) {
        main.appendChild(meta);
      }

      const time = document.createElement("span");
      time.className = "session-time";
      time.textContent = session.updatedAtLabel;

      body.appendChild(badge);
      body.appendChild(main);
      body.appendChild(time);

      body.addEventListener("click", () => {
        vscode.postMessage({
          type: "resume",
          provider: session.provider,
          id: session.id
        });
      });

      const actions = document.createElement("div");
      actions.className = "session-actions";

      const previewBtn = document.createElement("button");
      previewBtn.type = "button";
      previewBtn.className = "session-action";
      previewBtn.title = "Preview Chat";
      previewBtn.setAttribute("aria-label", "Preview Chat");
      const isLoading = previewLoadingKey === sessionKey(session.provider, session.id);
      previewBtn.textContent = isLoading ? "..." : "Preview";
      previewBtn.disabled = isLoading;
      previewBtn.addEventListener("click", (event) => {
        event.stopPropagation();
        vscode.postMessage({
          type: "preview",
          provider: session.provider,
          id: session.id
        });
      });

      const renameBtn = document.createElement("button");
      renameBtn.type = "button";
      renameBtn.className = "session-action";
      renameBtn.title = "Rename Session";
      renameBtn.setAttribute("aria-label", "Rename Session");
      renameBtn.textContent = "Rename";
      renameBtn.addEventListener("click", (event) => {
        event.stopPropagation();
        vscode.postMessage({
          type: "rename",
          provider: session.provider,
          id: session.id
        });
      });

      const removeBtn = document.createElement("button");
      removeBtn.type = "button";
      removeBtn.className = "session-action session-action-warn";
      removeBtn.title = "Remove from panel only (native agent unchanged)";
      removeBtn.setAttribute("aria-label", "Remove from panel");
      removeBtn.textContent = "Remove";
      removeBtn.disabled = session.provider === "chat";
      removeBtn.addEventListener("click", (event) => {
        event.stopPropagation();
        vscode.postMessage({
          type: "remove",
          provider: session.provider,
          id: session.id
        });
      });

      actions.appendChild(previewBtn);
      actions.appendChild(renameBtn);
      actions.appendChild(removeBtn);
      row.appendChild(body);
      row.appendChild(actions);
      sessionsEl.appendChild(row);
    }
  }

  function showPreview(message) {
    activePreviewSession = { provider: message.provider, id: message.id };
    previewRename.disabled = false;
    applyResumeActions(message.showResumeWith !== false);
    applyLlmActions(message.llmConfigured === true);
    previewTitle.textContent = message.title || "Session Preview";
    previewMessages.innerHTML = "";

    if (message.cachedSummary) {
      renderSummary(message.cachedSummary);
    } else {
      previewSummary.classList.add("hidden");
      previewSummary.textContent = "";
    }

    const notices = [];
    if (message.truncated) {
      notices.push("Showing the most recent 100 messages.");
    }
    if (message.warning) {
      notices.push(message.warning);
    }

    if (notices.length) {
      previewNotice.textContent = notices.join(" ");
      previewNotice.classList.remove("hidden");
    } else {
      previewNotice.textContent = "";
      previewNotice.classList.add("hidden");
    }

    for (const entry of message.messages || []) {
      const block = document.createElement("div");
      block.className = `preview-message ${entry.role}`;

      const role = document.createElement("div");
      role.className = "preview-role";
      role.textContent = entry.role === "assistant" ? "Assistant" : "User";

      const text = document.createElement("div");
      text.className = "preview-text";
      text.textContent = entry.text;

      block.appendChild(role);
      block.appendChild(text);
      previewMessages.appendChild(block);
    }

    previewOverlay.classList.remove("hidden");
    previewOverlay.setAttribute("aria-hidden", "false");
  }

  function closePreview() {
    activePreviewSession = null;
    previewRename.disabled = false;
    setAiButtonsDisabled(false);
    applyResumeActions(true);
    applyLlmActions(false);
    previewSummary.classList.add("hidden");
    previewOverlay.classList.add("hidden");
    previewOverlay.setAttribute("aria-hidden", "true");
  }

  function renderSummary(text, isError) {
    previewSummary.textContent = text;
    previewSummary.classList.remove("hidden");
    previewSummary.classList.toggle("preview-summary-error", Boolean(isError));
  }

  function applyResumeActions(showResumeWith) {
    previewResumeWith.classList.toggle("hidden", !showResumeWith);
  }

  function applyLlmActions(show) {
    previewSummarize.classList.toggle("hidden", !show);
    previewAutoRename.classList.toggle("hidden", !show);
  }

  function setAiButtonsDisabled(disabled) {
    previewSummarize.disabled = disabled;
    previewAutoRename.disabled = disabled;
  }

  function syncPreviewTitle() {
    if (!activePreviewSession || previewOverlay.classList.contains("hidden")) {
      return;
    }

    const session = state.sessions.find(
      (entry) =>
        entry.provider === activePreviewSession.provider && entry.id === activePreviewSession.id
    );
    if (session) {
      previewTitle.textContent = session.title || "Session Preview";
    }
  }

  function sessionKey(provider, id) {
    return `${provider}:${id}`;
  }

  function matchesSession(session) {
    if (selectedProjectPath && normalizePath(session.projectPath) !== selectedProjectPath) {
      return false;
    }

    const trimmed = query.trim().toLowerCase();
    if (!trimmed) {
      return true;
    }

    return (
      session.title.toLowerCase().includes(trimmed) ||
      session.provider.toLowerCase().includes(trimmed) ||
      (session.branch && session.branch.toLowerCase().includes(trimmed)) ||
      (!selectedProjectPath &&
        (session.projectName.toLowerCase().includes(trimmed) ||
          session.projectPath.toLowerCase().includes(trimmed)))
    );
  }

  function normalizePath(projectPath) {
    return projectPath;
  }

  function escapeHtml(value) {
    return value
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;");
  }

  vscode.postMessage({ type: "ready" });
})();