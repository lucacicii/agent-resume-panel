(function () {
  const vscode = acquireVsCodeApi();

  const ROW_HEIGHT = 64;
  const PAGE_SIZE = 200;
  let uiStrings = {};
  /** @type {{ sessions: Array<{provider:string,id:string,title:string,projectPath:string,projectName:string,updatedAtMs:number,updatedAtLabel:string,subtitle:string,gtdStatus?:string,gtdStatusLabel?:string}>, stats: {total:number, withSummary:number, byProvider: Record<string, number>}, gtdStatuses: Array<{status:string,label:string,count?:number}>, untaggedCount: number, filteredTotal: number, hasMore: boolean }} */
  let state = { sessions: [], stats: { total: 0, withSummary: 0, byProvider: {} }, gtdStatuses: [], untaggedCount: 0, filteredTotal: 0, hasMore: false };

  const selected = new Set();
  const enabledProviders = new Set();
  let query = "";
  let ageDays = "all";
  /** @type {null | "untagged" | string} */
  let selectedGtdFilter = null;
  let searchDebounceTimer = null;
  let loadingMore = false;
  const searchInput = document.getElementById("search");
  const ageFilter = document.getElementById("age-filter");
  const statsEl = document.getElementById("stats");
  const providerFiltersEl = document.getElementById("provider-filters");
  const gtdFiltersEl = document.getElementById("gtd-filters");
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
    clearTimeout(searchDebounceTimer);
    searchDebounceTimer = setTimeout(() => {
      requestPage(0);
    }, 150);
  });

  ageFilter.addEventListener("change", () => {
    ageDays = ageFilter.value;
    requestPage(0);
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
    const filtered = state.sessions;
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
    if (
      state.hasMore &&
      !loadingMore &&
      viewport.scrollTop + viewport.clientHeight >= viewport.scrollHeight - ROW_HEIGHT * 6
    ) {
      requestPage(state.sessions.length);
    }
  });

  function requestPage(offset) {
    loadingMore = true;
    vscode.postMessage({
      type: "queryPage",
      offset,
      limit: PAGE_SIZE,
      search: query,
      ageDays,
      providers: Array.from(enabledProviders),
      gtdFilter: selectedGtdFilter
    });
  }

  window.addEventListener("message", (event) => {
    const message = event.data;
    if (message.type === "init") {
      uiStrings = message.uiStrings || {};
      applyStaticUi();
      const incoming = message.sessions || [];
      const stats = message.stats || { total: 0, withSummary: 0, byProvider: {} };
      state.sessions = incoming;
      state.stats = stats;
      state.gtdStatuses = message.gtdStatuses || [];
      state.untaggedCount =
        typeof message.untaggedCount === "number"
          ? message.untaggedCount
          : incoming.filter((session) => !session.gtdStatus).length;
      state.filteredTotal = typeof message.filteredTotal === "number" ? message.filteredTotal : incoming.length;
      state.hasMore = Boolean(message.hasMore);
      loadingMore = false;
      enabledProviders.clear();
      for (const provider of Object.keys(state.stats.byProvider || {})) {
        enabledProviders.add(provider);
      }
      selectedGtdFilter = null;
      selected.clear();
      selectAllEl.checked = false;
      renderProviderFilters();
      renderGtdFilters();
      render();
      return;
    }

    if (message.type === "pageResult") {
      loadingMore = false;
      const next = message.sessions || [];
      state.sessions = message.append ? state.sessions.concat(next) : next;
      state.filteredTotal = typeof message.total === "number" ? message.total : state.sessions.length;
      state.hasMore = Boolean(message.hasMore);
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
        : state.sessions;
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


  function renderGtdFilters() {
    if (!gtdFiltersEl) {
      return;
    }

    gtdFiltersEl.innerHTML = "";
    gtdFiltersEl.setAttribute("aria-label", uiStrings.gtdFilterLabel || "GTD filter");

    gtdFiltersEl.appendChild(
      createGtdFilterButton(
        uiStrings.gtdFilterAll || "All GTD",
        state.stats.total || state.sessions.length,
        null,
        selectedGtdFilter === null
      )
    );
    gtdFiltersEl.appendChild(
      createGtdFilterButton(
        uiStrings.gtdFilterUntagged || "Untagged",
        state.untaggedCount,
        "untagged",
        selectedGtdFilter === "untagged"
      )
    );

    for (const entry of state.gtdStatuses) {
      const count =
        typeof entry.count === "number"
          ? entry.count
          : state.sessions.filter((session) => session.gtdStatus === entry.status).length;
      gtdFiltersEl.appendChild(
        createGtdFilterButton(entry.label, count, entry.status, selectedGtdFilter === entry.status)
      );
    }
  }

  function createGtdFilterButton(label, count, filterValue, active) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "gtd-filter" + (active ? " active" : "");
    button.textContent = `${label} (${count})`;
    button.addEventListener("click", () => {
      selectedGtdFilter = filterValue;
      renderGtdFilters();
      requestPage(0);
    });
    return button;
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
        requestPage(0);
      });
      label.appendChild(input);
      label.appendChild(document.createTextNode(`${provider} (${state.stats.byProvider[provider]})`));
      providerFiltersEl.appendChild(label);
    }
  }

  function render() {
    const filtered = state.sessions;
    const summaryCount = state.stats.withSummary ?? 0;
    const shownCount = state.filteredTotal || filtered.length;
    statsEl.textContent = formatUi(
      uiStrings.stats || "Showing {0} of {1} catalog sessions · {2} with LLM summary",
      shownCount,
      state.stats.total,
      summaryCount
    );
    spacer.style.height = `${Math.max(filtered.length, 1) * ROW_HEIGHT}px`;
    renderRows();
  }

  function renderRows() {
    const filtered = state.sessions;
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

      const badgeCol = document.createElement("div");
      badgeCol.className = "badge-col";

      const badge = document.createElement("span");
      badge.className = "badge";
      badge.textContent = session.provider;
      badgeCol.appendChild(badge);

      if (session.gtdStatusLabel) {
        const gtdBadge = document.createElement("span");
        gtdBadge.className = "gtd-badge";
        gtdBadge.textContent = session.gtdStatusLabel;
        gtdBadge.title = session.gtdStatusLabel;
        badgeCol.appendChild(gtdBadge);
      }

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
      top.appendChild(badgeCol);
      top.appendChild(titleCol);
      top.appendChild(project);
      top.appendChild(time);
      row.appendChild(top);

      rowsEl.appendChild(row);
    }
  }
})();