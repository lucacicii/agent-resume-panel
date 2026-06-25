(function () {
  const vscode = acquireVsCodeApi();

  /** @type {{ projects: Array<{projectPath: string, name: string, sessionCount: number, favorited: boolean, compactPath: string}>, sessions: Array<{provider: string, id: string, title: string, projectPath: string, projectName: string, branch?: string, updatedAtLabel: string}> }} */
  let state = { projects: [], sessions: [] };
  let selectedProjectPath = null;
  let query = "";

  const searchInput = document.getElementById("search");
  const chipsEl = document.getElementById("chips");
  const sessionsEl = document.getElementById("sessions");

  searchInput.addEventListener("input", () => {
    query = searchInput.value;
    renderSessions();
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
      const row = document.createElement("button");
      row.type = "button";
      row.className = "session-row";

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

      row.appendChild(badge);
      row.appendChild(main);
      row.appendChild(time);

      row.addEventListener("click", () => {
        vscode.postMessage({
          type: "resume",
          provider: session.provider,
          id: session.id
        });
      });

      sessionsEl.appendChild(row);
    }
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