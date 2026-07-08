(function () {
  const vscode = acquireVsCodeApi();

  const ROW_HEIGHT = 64;
  let uiStrings = {};
  /** @type {{ sessions: Array<{provider:string,id:string,title:string,projectPath:string,projectName:string,updatedAtMs:number,updatedAtLabel:string,subtitle:string}>, stats: {total:number, withSummary:number, byProvider: Record<string, number>} }} */
  let state = { sessions: [], stats: { total: 0, withSummary: 0, byProvider: {} } };

  const selected = new Set();
  const enabledProviders = new Set();
  let query = "";
  let ageDays = "all";

  const searchInput = document.getElementById("search");
  const ageFilter = document.getElementById("age-filter");
  const statsEl = document.getElementById("stats");
  const providerFiltersEl = document.getElementById("provider-filters");
  const viewport = document.getElementById("list-viewport");
  const spacer = document.getElementById("list-spacer");
  const rowsEl = document.getElementById("list-rows");
  const selectAllEl = document.getElementById("select-all");
  const refreshBtn = document.getElementById("refresh");
  const exportBtn = document.getElementById("export-selected");
  const removeBtn = document.getElementById("hide-selected");
  const selectFilteredLabel = document.querySelector(".select-all span");
  const colProvider = document.querySelector(".list-header .col-provider");
  const colTitle = document.querySelector(".list-header .col-title");
  const colProject = document.querySelector(".list-header .col-project");
  const colTime = document.querySelector(".list-header .col-time");

  function formatUi(template, ...args) {
    let text = template || "";
    args.forEach((arg, index) => {
      text = text.replaceAll(`{${index}}`, String(arg));
    });
    return text;
  }

  function applyStaticUi() {
    if (searchInput) {
      searchInput.placeholder = uiStrings.searchPlaceholder || searchInput.placeholder;
    }
    if (ageFilter) {
      ageFilter.setAttribute("aria-label", uiStrings.ageFilterLabel || "Age filter");
      const options = {
        all: uiStrings.ageFilterAll || "All ages",
        7: uiStrings.ageFilter7days || "Older than 7 days",
        30: uiStrings.ageFilter30days || "Older than 30 days",
        90: uiStrings.ageFilter90days || "Older than 90 days"
      };
      for (const option of ageFilter.options) {
        if (options[option.value]) {
          option.textContent = options[option.value];
        }
      }
    }
    if (refreshBtn) {
      refreshBtn.textContent = uiStrings.buttonResync || "Resync";
    }
    if (exportBtn) {
      exportBtn.textContent = uiStrings.buttonExport || "Export";
    }
    if (removeBtn) {
      removeBtn.textContent = uiStrings.buttonRemoveFromPanel || "Remove from panel";
      removeBtn.title = uiStrings.removeAction || removeBtn.title;
    }
    if (selectFilteredLabel) {
      selectFilteredLabel.textContent = uiStrings.selectFiltered || "Select filtered";
    }
    if (colProvider) {
      colProvider.textContent = uiStrings.columnProvider || "Provider";
    }
    if (colTitle) {
      colTitle.textContent = uiStrings.columnTitleSummary || "Title / Summary";
    }
    if (colProject) {
      colProject.textContent = uiStrings.columnProject || "Project";
    }
    if (colTime) {
      colTime.textContent = uiStrings.columnUpdated || "Updated";
    }
  }

  searchInput.addEventListener("input", () => {
    query = searchInput.value;
    render();
  });

  ageFilter.addEventListener("change", () => {
    ageDays = ageFilter.value;
    render();
  });

  document.getElementById("refresh").addEventListener("click", () => {
    vscode.postMessage({ type: "resync" });
  });

  document.getElementById("hide-selected").addEventListener("click", () => {
    postRemove();
  });

  document.getElementById("export-selected").addEventListener("click", () => {
    postExport();
  });

  selectAllEl.addEventListener("change", () => {
    const filtered = getFilteredSessions();
    if (selectAllEl.checked) {
      for (const session of filtered) {
        selected.add(sessionKey(session));
      }
    } else {
      for (const session of filtered) {
        selected.delete(sessionKey(session));
      }
    }
    renderRows();
  });

  viewport.addEventListener("scroll", () => {
    renderRows();
  });

  window.addEventListener("message", (event) => {
    const message = event.data;
    if (message.type === "init") {
      uiStrings = message.uiStrings || {};
      applyStaticUi();
      state.sessions = message.sessions || [];
      state.stats = message.stats || { total: 0, withSummary: 0, byProvider: {} };
      enabledProviders.clear();
      for (const provider of Object.keys(state.stats.byProvider || {})) {
        enabledProviders.add(provider);
      }
      selected.clear();
      selectAllEl.checked = false;
      renderProviderFilters();
      render();
      return;
    }

    if (message.type === "removeDone") {
      if (message.sessions) {
        state.sessions = message.sessions;
        state.stats = message.stats || state.stats;
      }
      selected.clear();
      selectAllEl.checked = false;
      render();
    }
  });

  vscode.postMessage({ type: "ready" });

  function postRemove() {
    const items = getSelectedSessions();
    if (!items.length) {
      return;
    }
    vscode.postMessage({
      type: "remove",
      items: items.map((session) => ({ provider: session.provider, id: session.id }))
    });
  }

  function postExport() {
    const selectedItems = getSelectedSessions();
    const items =
      selectedItems.length > 0
        ? selectedItems
        : getFilteredSessions();
    vscode.postMessage({
      type: "export",
      items: items.map((session) => ({ provider: session.provider, id: session.id }))
    });
  }

  function getSelectedSessions() {
    return state.sessions.filter((session) => selected.has(sessionKey(session)));
  }

  function sessionKey(session) {
    return `${session.provider}:${session.id}`;
  }

  function getFilteredSessions() {
    const now = Date.now();
    const trimmed = query.trim().toLowerCase();
    const minAgeMs =
      ageDays === "all" ? 0 : Number(ageDays) * 24 * 60 * 60 * 1000;

    return state.sessions.filter((session) => {
      if (!enabledProviders.has(session.provider)) {
        return false;
      }
      if (minAgeMs > 0 && now - session.updatedAtMs < minAgeMs) {
        return false;
      }
      if (!trimmed) {
        return true;
      }
      return (
        session.title.toLowerCase().includes(trimmed) ||
        session.subtitle.toLowerCase().includes(trimmed) ||
        session.provider.toLowerCase().includes(trimmed) ||
        session.projectName.toLowerCase().includes(trimmed) ||
        session.projectPath.toLowerCase().includes(trimmed)
      );
    });
  }

  function renderProviderFilters() {
    providerFiltersEl.innerHTML = "";
    const providers = Object.keys(state.stats.byProvider || {}).sort();
    for (const provider of providers) {
      const label = document.createElement("label");
      const input = document.createElement("input");
      input.type = "checkbox";
      input.checked = enabledProviders.has(provider);
      input.addEventListener("change", () => {
        if (input.checked) {
          enabledProviders.add(provider);
        } else {
          enabledProviders.delete(provider);
        }
        render();
      });
      label.appendChild(input);
      label.appendChild(document.createTextNode(`${provider} (${state.stats.byProvider[provider]})`));
      providerFiltersEl.appendChild(label);
    }
  }

  function render() {
    const filtered = getFilteredSessions();
    const summaryCount = state.stats.withSummary ?? 0;
    statsEl.textContent = formatUi(
      uiStrings.stats || "Showing {0} of {1} catalog sessions · {2} with LLM summary",
      filtered.length,
      state.stats.total,
      summaryCount
    );
    spacer.style.height = `${Math.max(filtered.length, 1) * ROW_HEIGHT}px`;
    renderRows();
  }

  function renderRows() {
    const filtered = getFilteredSessions();
    rowsEl.innerHTML = "";

    if (!filtered.length) {
      const empty = document.createElement("div");
      empty.className = "empty";
      empty.textContent = uiStrings.emptyNoMatch || "No sessions match the current filters.";
      rowsEl.appendChild(empty);
      return;
    }

    const scrollTop = viewport.scrollTop;
    const viewHeight = viewport.clientHeight;
    const start = Math.max(0, Math.floor(scrollTop / ROW_HEIGHT) - 5);
    const visibleCount = Math.ceil(viewHeight / ROW_HEIGHT) + 10;
    const end = Math.min(filtered.length, start + visibleCount);

    rowsEl.style.transform = `translateY(${start * ROW_HEIGHT}px)`;

    for (let index = start; index < end; index++) {
      const session = filtered[index];
      const row = document.createElement("div");
      row.className = "row";

      const top = document.createElement("div");
      top.className = "row-top";

      const check = document.createElement("input");
      check.type = "checkbox";
      check.checked = selected.has(sessionKey(session));
      check.addEventListener("change", () => {
        if (check.checked) {
          selected.add(sessionKey(session));
        } else {
          selected.delete(sessionKey(session));
        }
      });

      const badge = document.createElement("span");
      badge.className = "badge";
      badge.textContent = session.provider;

      const titleCol = document.createElement("div");
      titleCol.className = "title-col";

      const title = document.createElement("div");
      title.className = "title";
      title.textContent = session.title;
      title.title = session.title;
      titleCol.appendChild(title);

      const subtitle = document.createElement("div");
      subtitle.className = "subtitle";
      subtitle.textContent = session.subtitle;
      subtitle.title = session.subtitle;
      titleCol.appendChild(subtitle);

      const project = document.createElement("span");
      project.className = "project";
      project.textContent = session.projectName;
      project.title = session.projectPath;

      const time = document.createElement("span");
      time.className = "time";
      time.textContent = session.updatedAtLabel;

      top.appendChild(check);
      top.appendChild(badge);
      top.appendChild(titleCol);
      top.appendChild(project);
      top.appendChild(time);
      row.appendChild(top);

      rowsEl.appendChild(row);
    }
  }
})();