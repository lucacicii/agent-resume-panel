(function () {
  const vscode = acquireVsCodeApi();

  let uiStrings = {};
  let previewUiStrings = {};
  /** @type {Record<string, string | { light: string, dark: string }>} */
  let providerIcons = {};

  const PAGE_SIZE = 35;
  const MAX_SHORTCUT_CHIPS = 7;

  let state = {
    projects: [],
    sessions: { items: [], total: 0, hasMore: false },
    acp: { items: [], total: 0, hasMore: false },
    notes: { items: [], total: 0, hasMore: false },
    gtdStatuses: [],
    totalSessions: 0,
    untaggedCount: 0,
    indexedCounts: { sessions: 0, acp: 0, notes: 0 },
    queryTimeMs: 0,
    usingFallback: false
  };

  let selectedProjectPath = null;
  let selectedGtdFilter = null;
  let query = "";
  let searchDebounceTimer = null;
  let loadingColumns = { session: false, acp: false, note: false };
  let previewLoadingKey = null;
  let activePreviewSession = null;
  let previewRenderMode = "markdown";
  let previewMessagesData = [];
  let previewSummaryState = { text: "", isError: false, visible: false };
  let projectDropdownOpen = false;
  let projectDropdownQuery = "";
  let projectDropdownHighlight = 0;
  let filteredDropdownProjects = [];
  let isSyncingIndex = false;

  const markdownHelper = window.AgentResumePreviewMarkdown;
  const previewFindHelper = window.AgentResumePreviewFind;
  const searchInput = document.getElementById("search");
  const searchClearBtn = document.getElementById("search-clear");
  const indexStatusEl = document.getElementById("index-status");
  const syncIndexBtn = document.getElementById("sync-index-btn");

  const chipsEl = document.getElementById("chips");
  const gtdChipsEl = document.getElementById("gtd-chips");
  const gtdSectionLabel = document.getElementById("gtd-section-label");
  const projectsSectionLabel = document.querySelector(".projects-section .section-label");

  const projectDropdown = document.getElementById("project-dropdown");
  const projectDropdownTrigger = document.getElementById("project-dropdown-trigger");
  const projectDropdownLabel = document.getElementById("project-dropdown-label");
  const projectDropdownMenu = document.getElementById("project-dropdown-menu");
  const projectDropdownSearch = document.getElementById("project-dropdown-search");
  const projectDropdownList = document.getElementById("project-dropdown-list");
  const projectClearBtn = document.getElementById("project-clear-btn");

  const colLabelSessions = document.getElementById("col-label-sessions");
  const colLabelAcp = document.getElementById("col-label-acp");
  const colLabelNotes = document.getElementById("col-label-notes");
  const colCountSessions = document.getElementById("col-count-sessions");
  const colCountAcp = document.getElementById("col-count-acp");
  const colCountNotes = document.getElementById("col-count-notes");
  const colListSessions = document.getElementById("col-list-sessions");
  const colListAcp = document.getElementById("col-list-acp");
  const colListNotes = document.getElementById("col-list-notes");

  const previewOverlay = document.getElementById("preview-overlay");
  const previewTitle = document.getElementById("preview-title");
  const previewNotice = document.getElementById("preview-notice");
  const previewSummary = document.getElementById("preview-summary");
  const previewMessages = document.getElementById("preview-messages");
  const previewBody = document.getElementById("preview-body") || previewMessages;
  const previewFindToggle = document.getElementById("preview-find-toggle");
  const previewFindBar = document.getElementById("preview-find-bar");
  const previewFindInput = document.getElementById("preview-find-input");
  const previewFindCount = document.getElementById("preview-find-count");
  const previewFindPrev = document.getElementById("preview-find-prev");
  const previewFindNext = document.getElementById("preview-find-next");
  const previewFindClose = document.getElementById("preview-find-close");
  const previewModeToggle = document.getElementById("preview-mode-toggle");
  const previewModeMarkdown = document.getElementById("preview-mode-markdown");
  const previewModeRaw = document.getElementById("preview-mode-raw");
  const previewResume = document.getElementById("preview-resume");
  const previewResumeWith = document.getElementById("preview-resume-with");
  const previewSummarize = document.getElementById("preview-summarize");
  const previewAutoRename = document.getElementById("preview-auto-rename");
  const previewHandoff = document.getElementById("preview-handoff");
  const previewRename = document.getElementById("preview-rename");
  const previewClose = document.getElementById("preview-close");

  function applyPreviewStaticUi() {
    if (previewResume) {
      previewResume.textContent = previewUiStrings.buttonResume || "Resume";
      previewResume.setAttribute("aria-label", previewUiStrings.ariaResume || "Resume session");
    }
    if (previewResumeWith) {
      previewResumeWith.textContent = previewUiStrings.buttonResumeWith || "Resume with…";
      previewResumeWith.setAttribute("aria-label", previewUiStrings.ariaResumeWith || "Resume session with");
    }
    if (previewSummarize) {
      previewSummarize.textContent = previewUiStrings.buttonSummarize || "Summarize";
      previewSummarize.setAttribute("aria-label", previewUiStrings.ariaSummarize || "Summarize session");
    }
    if (previewAutoRename) {
      previewAutoRename.textContent = previewUiStrings.buttonAutoRename || "Auto Rename";
      previewAutoRename.setAttribute("aria-label", previewUiStrings.ariaAutoRename || "Auto rename session");
    }
    if (previewHandoff) {
      previewHandoff.textContent = previewUiStrings.buttonHandoff || "Hand Off to…";
      previewHandoff.setAttribute("aria-label", previewUiStrings.ariaHandoff || "Hand off to another agent");
    }
    if (previewRename) {
      previewRename.textContent = previewUiStrings.buttonRename || "Rename";
      previewRename.setAttribute("aria-label", previewUiStrings.ariaRename || "Rename session");
    }
    if (previewClose) {
      previewClose.textContent = previewUiStrings.buttonClose || "Close";
      previewClose.setAttribute("aria-label", previewUiStrings.ariaClose || "Close preview");
    }
    if (previewModeToggle) {
      previewModeToggle.setAttribute("aria-label", previewUiStrings.ariaRenderMode || "Preview display format");
    }
    if (previewModeMarkdown) {
      previewModeMarkdown.textContent = previewUiStrings.modeMarkdown || "Markdown";
      previewModeMarkdown.setAttribute("aria-label", previewUiStrings.ariaModeMarkdown || "Switch to Markdown preview");
    }
    if (previewModeRaw) {
      previewModeRaw.textContent = previewUiStrings.modeRaw || "Raw";
      previewModeRaw.setAttribute("aria-label", previewUiStrings.ariaModeRaw || "Switch to raw text");
    }
    if (previewFindToggle) {
      const tip = previewUiStrings.findToggleTooltip || "Find in preview (Ctrl+F)";
      previewFindToggle.title = tip;
      previewFindToggle.setAttribute("aria-label", tip);
    }
    if (previewFindInput) {
      previewFindInput.placeholder = previewUiStrings.findPlaceholder || "Find in preview...";
    }
    if (previewFindPrev) {
      const tip = previewUiStrings.findPrevTooltip || "Previous match (Shift+Enter)";
      previewFindPrev.title = tip;
      previewFindPrev.setAttribute("aria-label", tip);
    }
    if (previewFindNext) {
      const tip = previewUiStrings.findNextTooltip || "Next match (Enter)";
      previewFindNext.title = tip;
      previewFindNext.setAttribute("aria-label", tip);
    }
    if (previewFindClose) {
      const tip = previewUiStrings.findCloseTooltip || "Close find bar (Esc)";
      previewFindClose.title = tip;
      previewFindClose.setAttribute("aria-label", tip);
    }
  }

  function applyStaticUi() {
    if (searchInput) {
      searchInput.placeholder = uiStrings.placeholder || searchInput.placeholder;
    }
    if (projectsSectionLabel) {
      projectsSectionLabel.textContent = uiStrings.sectionProjects || projectsSectionLabel.textContent;
    }
    if (colLabelSessions) {
      colLabelSessions.textContent = uiStrings.sectionSessions || "Sessions";
    }
    if (colLabelAcp) {
      colLabelAcp.textContent = uiStrings.sectionAcp || "ACP";
    }
    if (colLabelNotes) {
      colLabelNotes.textContent = uiStrings.sectionNotes || "Notes";
    }
    if (gtdSectionLabel) {
      gtdSectionLabel.textContent = uiStrings.sectionGtd || gtdSectionLabel.textContent;
    }
    if (projectDropdownSearch) {
      projectDropdownSearch.placeholder =
        uiStrings.projectFilterPlaceholder || "Filter projects by name or path...";
    }
    if (syncIndexBtn) {
      const tip = uiStrings.syncIndexTooltip || "Refresh full-text search index";
      syncIndexBtn.title = tip;
      syncIndexBtn.setAttribute("aria-label", tip);
    }
    applyPreviewStaticUi();
  }

  searchInput.addEventListener("input", () => {
    query = searchInput.value;
    updateSearchClearVisibility();
    clearTimeout(searchDebounceTimer);
    searchDebounceTimer = setTimeout(() => {
      requestAllColumns();
    }, 120);
  });

  searchClearBtn.addEventListener("click", () => {
    searchInput.value = "";
    query = "";
    updateSearchClearVisibility();
    requestAllColumns();
    searchInput.focus();
  });

  syncIndexBtn.addEventListener("click", () => {
    vscode.postMessage({ type: "syncIndex" });
  });

  function updateSearchClearVisibility() {
    searchClearBtn.classList.toggle("hidden", !searchInput.value);
  }

  // Project dropdown interactions
  projectDropdownTrigger.addEventListener("click", (event) => {
    event.stopPropagation();
    toggleProjectDropdown(!projectDropdownOpen);
  });

  projectClearBtn.addEventListener("click", (event) => {
    event.stopPropagation();
    selectProject(null);
  });

  projectDropdownSearch.addEventListener("input", () => {
    projectDropdownQuery = projectDropdownSearch.value;
    projectDropdownHighlight = 0;
    renderProjectDropdownList();
  });

  projectDropdownSearch.addEventListener("keydown", (event) => {
    if (event.key === "ArrowDown") {
      event.preventDefault();
      if (filteredDropdownProjects.length > 0) {
        projectDropdownHighlight = (projectDropdownHighlight + 1) % filteredDropdownProjects.length;
        renderProjectDropdownList();
      }
      return;
    }
    if (event.key === "ArrowUp") {
      event.preventDefault();
      if (filteredDropdownProjects.length > 0) {
        projectDropdownHighlight =
          (projectDropdownHighlight - 1 + filteredDropdownProjects.length) % filteredDropdownProjects.length;
        renderProjectDropdownList();
      }
      return;
    }
    if (event.key === "Enter") {
      event.preventDefault();
      const chosen = filteredDropdownProjects[projectDropdownHighlight];
      if (chosen) {
        selectProject(chosen.projectPath);
        toggleProjectDropdown(false);
      }
      return;
    }
    if (event.key === "Escape") {
      event.preventDefault();
      toggleProjectDropdown(false);
      projectDropdownTrigger.focus();
    }
  });

  document.addEventListener("click", (event) => {
    if (projectDropdownOpen && !projectDropdown.contains(event.target)) {
      toggleProjectDropdown(false);
    }
  });

  function toggleProjectDropdown(open) {
    projectDropdownOpen = open;
    projectDropdownMenu.classList.toggle("hidden", !open);
    projectDropdownTrigger.setAttribute("aria-expanded", String(open));
    if (open) {
      projectDropdownQuery = "";
      projectDropdownSearch.value = "";
      projectDropdownHighlight = 0;
      renderProjectDropdownList();
      setTimeout(() => projectDropdownSearch.focus(), 0);
    }
  }

  function selectProject(projectPath) {
    selectedProjectPath = projectPath;
    renderProjectControls();
    requestAllColumns();
  }

  function fuzzySubsequenceMatch(needle, haystack) {
    const n = needle.toLowerCase();
    const h = haystack.toLowerCase();
    if (!n) return 1;
    if (h.includes(n)) return 100;
    let ni = 0;
    let score = 0;
    let prev = -2;
    for (let hi = 0; hi < h.length && ni < n.length; hi++) {
      if (h[hi] === n[ni]) {
        score += hi === prev + 1 ? 4 : 1;
        prev = hi;
        ni++;
      }
    }
    return ni === n.length ? score : 0;
  }

  function renderProjectDropdownList() {
    projectDropdownList.innerHTML = "";
    const kw = projectDropdownQuery.trim();
    const allEntry = {
      projectPath: null,
      name: uiStrings.chipAllProjects || "All Projects",
      compactPath: uiStrings.chipAllProjectsTooltip || "Show all projects",
      sessionCount: state.totalSessions,
      favorited: false
    };

    let entries = [];
    if (!kw) {
      entries = [allEntry, ...state.projects];
    } else {
      const scored = [];
      for (const p of state.projects) {
        const nameScore = fuzzySubsequenceMatch(kw, p.name);
        const pathScore = fuzzySubsequenceMatch(kw, p.compactPath || p.projectPath);
        const best = Math.max(nameScore * 2, pathScore);
        if (best > 0) {
          scored.push({ project: p, score: best + (p.favorited ? 10 : 0) });
        }
      }
      scored.sort((a, b) => b.score - a.score || b.project.sessionCount - a.project.sessionCount);
      entries = scored.map((s) => s.project);
    }

    filteredDropdownProjects = entries;
    if (projectDropdownHighlight >= entries.length) {
      projectDropdownHighlight = Math.max(0, entries.length - 1);
    }

    if (!entries.length) {
      const empty = document.createElement("div");
      empty.className = "project-dropdown-empty";
      empty.textContent = uiStrings.projectFilterEmpty || "No matching projects";
      projectDropdownList.appendChild(empty);
      return;
    }

    entries.forEach((entry, index) => {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "project-dropdown-item";
      if (entry.projectPath === selectedProjectPath) {
        btn.classList.add("selected");
      }
      if (index === projectDropdownHighlight) {
        btn.classList.add("highlighted");
      }

      const main = document.createElement("div");
      main.className = "project-dropdown-item-main";

      const nameEl = document.createElement("div");
      nameEl.className = "project-dropdown-item-name";
      const prefix = entry.favorited ? "★ " : "";
      appendHighlightedText(nameEl, prefix + entry.name, kw);

      const pathEl = document.createElement("div");
      pathEl.className = "project-dropdown-item-path";
      appendHighlightedText(pathEl, entry.compactPath || "", kw);

      main.appendChild(nameEl);
      main.appendChild(pathEl);

      const countEl = document.createElement("span");
      countEl.className = "project-dropdown-item-count";
      countEl.textContent = String(entry.sessionCount ?? 0);

      btn.appendChild(main);
      btn.appendChild(countEl);
      btn.addEventListener("click", () => {
        selectProject(entry.projectPath);
        toggleProjectDropdown(false);
      });
      projectDropdownList.appendChild(btn);
    });
  }

  function renderProjectControls() {
    // Update dropdown trigger label
    const activeProject = selectedProjectPath
      ? state.projects.find((p) => p.projectPath === selectedProjectPath)
      : null;

    if (activeProject) {
      projectDropdownLabel.textContent = (activeProject.favorited ? "★ " : "") + activeProject.name;
      projectDropdownTrigger.classList.add("active");
      projectClearBtn.classList.remove("hidden");
    } else {
      const allLabel = uiStrings.chipAllProjects || "All Projects";
      projectDropdownLabel.textContent = `${allLabel} (${state.projects.length})`;
      projectDropdownTrigger.classList.remove("active");
      projectClearBtn.classList.add("hidden");
    }

    // Shortcut chips: All + favorited + recent active + currently selected (if outside top list)
    chipsEl.innerHTML = "";
    chipsEl.appendChild(
      createProjectChip(
        uiStrings.chipAllProjects || "All Projects",
        state.totalSessions || state.sessions.total,
        null,
        !selectedProjectPath,
        uiStrings.chipAllProjectsTooltip || "Show sessions from all projects"
      )
    );

    const favs = state.projects.filter((p) => p.favorited);
    const nonFavs = state.projects.filter((p) => !p.favorited);
    const shortcuts = [...favs, ...nonFavs].slice(0, MAX_SHORTCUT_CHIPS);

    if (activeProject && !shortcuts.some((p) => p.projectPath === activeProject.projectPath)) {
      shortcuts.push(activeProject);
    }

    for (const project of shortcuts) {
      const label = (project.favorited ? "★ " : "") + project.name;
      chipsEl.appendChild(
        createProjectChip(
          label,
          project.sessionCount,
          project.projectPath,
          selectedProjectPath === project.projectPath,
          project.compactPath
        )
      );
    }
  }

  function createProjectChip(label, count, projectPath, active, tooltip) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "chip" + (active ? " active" : "");
    button.title = tooltip || label;
    button.textContent = label;
    const countSpan = document.createElement("span");
    countSpan.className = "count";
    countSpan.textContent = `(${count})`;
    button.appendChild(countSpan);
    button.addEventListener("click", () => {
      selectProject(projectPath);
    });
    return button;
  }

  function renderGtdChips() {
    if (!gtdChipsEl) return;
    gtdChipsEl.innerHTML = "";

    gtdChipsEl.appendChild(
      createGtdChip(
        uiStrings.chipAllGtd || "All GTD",
        state.totalSessions,
        null,
        selectedGtdFilter === null,
        uiStrings.chipAllGtdTooltip || "Show regardless of GTD status"
      )
    );
    gtdChipsEl.appendChild(
      createGtdChip(
        uiStrings.chipUntagged || "Untagged",
        state.untaggedCount,
        "untagged",
        selectedGtdFilter === "untagged",
        uiStrings.chipUntaggedTooltip || "Show items without a GTD status"
      )
    );

    for (const entry of state.gtdStatuses) {
      gtdChipsEl.appendChild(
        createGtdChip(
          entry.label,
          entry.count ?? 0,
          entry.status,
          selectedGtdFilter === entry.status,
          entry.label
        )
      );
    }
  }

  function createGtdChip(label, count, filterValue, active, tooltip) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "chip" + (active ? " active" : "");
    button.title = tooltip || label;
    button.textContent = label;
    const countSpan = document.createElement("span");
    countSpan.className = "count";
    countSpan.textContent = `(${count})`;
    button.appendChild(countSpan);
    button.addEventListener("click", () => {
      selectedGtdFilter = filterValue;
      renderGtdChips();
      requestAllColumns();
    });
    return button;
  }

  function renderIndexStatus() {
    if (isSyncingIndex) {
      indexStatusEl.textContent = uiStrings.indexSyncing || "Indexing…";
      syncIndexBtn.classList.add("syncing");
      return;
    }
    syncIndexBtn.classList.remove("syncing");
    if (state.usingFallback) {
      indexStatusEl.textContent = uiStrings.indexBuilding || "Building index…";
      return;
    }
    const totalDocs =
      (state.indexedCounts?.sessions || 0) +
      (state.indexedCounts?.acp || 0) +
      (state.indexedCounts?.notes || 0);
    if (totalDocs > 0) {
      const tpl = uiStrings.indexReadyCount || "{0} indexed · {1}ms";
      indexStatusEl.textContent = tpl
        .replace("{0}", String(totalDocs))
        .replace("{1}", String(state.queryTimeMs || 0));
    } else {
      indexStatusEl.textContent = "";
    }
  }

  function requestAllColumns() {
    loadingColumns = { session: true, acp: true, note: true };
    vscode.postMessage({
      type: "queryPage",
      column: "all",
      sessionsOffset: 0,
      acpOffset: 0,
      notesOffset: 0,
      limit: PAGE_SIZE,
      search: query,
      projectPath: selectedProjectPath,
      gtdFilter: selectedGtdFilter
    });
  }

  function requestMoreColumn(column) {
    if (loadingColumns[column]) return;
    loadingColumns[column] = true;
    const currentLen =
      column === "session"
        ? state.sessions.items.length
        : column === "acp"
          ? state.acp.items.length
          : state.notes.items.length;
    vscode.postMessage({
      type: "queryPage",
      column,
      offset: currentLen,
      limit: PAGE_SIZE,
      search: query,
      projectPath: selectedProjectPath,
      gtdFilter: selectedGtdFilter
    });
  }

  function renderColumns() {
    renderSingleColumn("session", state.sessions, colListSessions, colCountSessions);
    renderSingleColumn("acp", state.acp, colListAcp, colCountAcp);
    renderSingleColumn("note", state.notes, colListNotes, colCountNotes);
  }

  function renderSingleColumn(column, colData, listEl, countEl) {
    countEl.textContent = String(colData.total || 0);
    listEl.innerHTML = "";

    const items = colData.items || [];
    if (!items.length) {
      const empty = document.createElement("div");
      empty.className = "empty-state";
      empty.textContent = selectedProjectPath
        ? uiStrings.emptyNoMatchProject || "No matches in this project."
        : uiStrings.emptyNoMatchSearch || "No matches found.";
      listEl.appendChild(empty);
      return;
    }

    for (const item of items) {
      if (column === "session") {
        listEl.appendChild(buildSessionCard(item));
      } else if (column === "acp") {
        listEl.appendChild(buildAcpCard(item));
      } else {
        listEl.appendChild(buildNoteCard(item));
      }
    }

    if (colData.hasMore) {
      const remaining = Math.max(0, colData.total - items.length);
      const moreWrap = document.createElement("div");
      moreWrap.className = "load-more-row";
      const moreBtn = document.createElement("button");
      moreBtn.type = "button";
      moreBtn.className = "chip load-more-btn";
      moreBtn.disabled = Boolean(loadingColumns[column]);
      const baseLabel = uiStrings.showMore || "Show More";
      moreBtn.textContent = remaining > 0 ? `${baseLabel} (${remaining})` : baseLabel;
      moreBtn.addEventListener("click", () => requestMoreColumn(column));
      moreWrap.appendChild(moreBtn);
      listEl.appendChild(moreWrap);
    }
  }

  function buildSessionCard(item) {
    const card = document.createElement("div");
    card.className = "result-card";

    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "result-card-btn";

    const topRow = document.createElement("div");
    topRow.className = "card-top-row";

    const badge = document.createElement("span");
    badge.className = "provider-badge";
    appendProviderIcon(badge, item.provider);
    const badgeText = document.createElement("span");
    badgeText.className = "provider-badge-text";
    badgeText.textContent = item.provider;
    badge.appendChild(badgeText);

    const timeEl = document.createElement("span");
    timeEl.className = "card-time";
    timeEl.textContent = item.updatedAtLabel || "";

    topRow.appendChild(badge);
    topRow.appendChild(timeEl);

    const titleEl = document.createElement("div");
    titleEl.className = "card-title";
    appendHighlightedText(titleEl, item.title || item.id, query);

    btn.appendChild(topRow);
    btn.appendChild(titleEl);

    const snippetOrSummary = item.snippet || item.summary;
    if (snippetOrSummary) {
      const snipEl = document.createElement("div");
      snipEl.className = "card-snippet" + (item.matchSource === "body" ? " card-snippet-body" : "");
      appendHighlightedText(snipEl, snippetOrSummary, query);
      btn.appendChild(snipEl);
    }

    btn.addEventListener("click", () => {
      vscode.postMessage({ type: "resume", provider: item.provider, id: item.id });
    });

    const bottomRow = document.createElement("div");
    bottomRow.className = "card-bottom-row";

    const metaEl = document.createElement("div");
    metaEl.className = "card-meta";
    const metaParts = [];
    if (!selectedProjectPath && item.projectName) metaParts.push(item.projectName);
    if (item.gtdStatusLabel) metaParts.push(item.gtdStatusLabel);
    if (item.branch) metaParts.push(item.branch);
    appendHighlightedText(metaEl, metaParts.join(" · "), query);

    const actions = document.createElement("div");
    actions.className = "card-actions";

    const previewBtn = makeActionButton(
      previewLoadingKey === sessionKey(item.provider, item.id) ? "..." : uiStrings.actionPreview || "Preview",
      uiStrings.actionPreviewTooltip || "Preview Chat",
      false,
      () => {
        vscode.postMessage({ type: "preview", provider: item.provider, id: item.id });
      }
    );
    previewBtn.disabled = previewLoadingKey === sessionKey(item.provider, item.id);

    const renameBtn = makeActionButton(
      uiStrings.actionRename || "Rename",
      uiStrings.actionRenameTooltip || "Rename Session",
      false,
      () => {
        vscode.postMessage({ type: "rename", provider: item.provider, id: item.id });
      }
    );

    const removeBtn = makeActionButton(
      uiStrings.actionRemove || "Remove",
      uiStrings.actionRemoveTooltip || "Remove from panel",
      true,
      () => {
        vscode.postMessage({ type: "remove", provider: item.provider, id: item.id });
      }
    );
    removeBtn.setAttribute("aria-label", uiStrings.actionRemoveAria || "Remove from panel");

    actions.appendChild(previewBtn);
    actions.appendChild(renameBtn);
    actions.appendChild(removeBtn);

    bottomRow.appendChild(metaEl);
    bottomRow.appendChild(actions);

    card.appendChild(btn);
    card.appendChild(bottomRow);
    return card;
  }

  function buildAcpCard(item) {
    const card = document.createElement("div");
    card.className = "result-card";

    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "result-card-btn";

    const topRow = document.createElement("div");
    topRow.className = "card-top-row";

    const badge = document.createElement("span");
    badge.className = "provider-badge";
    appendProviderIcon(badge, item.acpProvider || "chat");
    const badgeText = document.createElement("span");
    badgeText.className = "provider-badge-text";
    badgeText.textContent = item.acpProvider ? `acp/${item.acpProvider}` : "acp";
    badge.appendChild(badgeText);

    const timeEl = document.createElement("span");
    timeEl.className = "card-time";
    timeEl.textContent = item.updatedAtLabel || "";

    topRow.appendChild(badge);
    topRow.appendChild(timeEl);

    const titleEl = document.createElement("div");
    titleEl.className = "card-title";
    appendHighlightedText(titleEl, item.title || item.id, query);

    btn.appendChild(topRow);
    btn.appendChild(titleEl);

    const snippetOrSummary = item.snippet || item.summary;
    if (snippetOrSummary) {
      const snipEl = document.createElement("div");
      snipEl.className = "card-snippet" + (item.matchSource === "body" ? " card-snippet-body" : "");
      appendHighlightedText(snipEl, snippetOrSummary, query);
      btn.appendChild(snipEl);
    }

    btn.addEventListener("click", () => {
      vscode.postMessage({ type: "openAcp", id: item.id });
    });

    const bottomRow = document.createElement("div");
    bottomRow.className = "card-bottom-row";

    const metaEl = document.createElement("div");
    metaEl.className = "card-meta";
    const metaParts = [];
    if (!selectedProjectPath && item.projectName) metaParts.push(item.projectName);
    if (item.gtdStatusLabel) metaParts.push(item.gtdStatusLabel);
    appendHighlightedText(metaEl, metaParts.join(" · "), query);

    const actions = document.createElement("div");
    actions.className = "card-actions";
    const previewBtn = makeActionButton(
      previewLoadingKey === sessionKey("chat", item.id) ? "..." : uiStrings.actionPreview || "Preview",
      uiStrings.actionPreviewTooltip || "Preview Chat",
      false,
      () => {
        vscode.postMessage({ type: "preview", provider: "chat", id: item.id });
      }
    );
    previewBtn.disabled = previewLoadingKey === sessionKey("chat", item.id);
    actions.appendChild(previewBtn);

    bottomRow.appendChild(metaEl);
    bottomRow.appendChild(actions);

    card.appendChild(btn);
    card.appendChild(bottomRow);
    return card;
  }

  function buildNoteCard(item) {
    const card = document.createElement("div");
    card.className = "result-card";

    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "result-card-btn";

    const topRow = document.createElement("div");
    topRow.className = "card-top-row";

    const badge = document.createElement("span");
    badge.className = "provider-badge note-scope-badge";
    const badgeText = document.createElement("span");
    badgeText.className = "provider-badge-text";
    badgeText.textContent = noteScopeLabel(item.scope);
    badge.appendChild(badgeText);

    const timeEl = document.createElement("span");
    timeEl.className = "card-time";
    timeEl.textContent = item.updatedAtLabel || "";

    topRow.appendChild(badge);
    topRow.appendChild(timeEl);

    const titleEl = document.createElement("div");
    titleEl.className = "card-title";
    appendHighlightedText(titleEl, item.title || item.filename || item.id, query);

    btn.appendChild(topRow);
    btn.appendChild(titleEl);

    const snippetOrSummary = item.snippet || item.summary;
    if (snippetOrSummary) {
      const snipEl = document.createElement("div");
      snipEl.className = "card-snippet" + (item.matchSource === "body" ? " card-snippet-body" : "");
      appendHighlightedText(snipEl, snippetOrSummary, query);
      btn.appendChild(snipEl);
    }

    const bottomRow = document.createElement("div");
    bottomRow.className = "card-bottom-row";

    const metaEl = document.createElement("div");
    metaEl.className = "card-meta";
    const metaParts = [];
    if (!selectedProjectPath && item.projectName) metaParts.push(item.projectName);
    if (item.filename && item.filename !== item.title) metaParts.push(item.filename);
    if (item.gtdStatusLabel) metaParts.push(item.gtdStatusLabel);
    appendHighlightedText(metaEl, metaParts.join(" · "), query);

    bottomRow.appendChild(metaEl);
    btn.appendChild(bottomRow);

    btn.addEventListener("click", () => {
      vscode.postMessage({ type: "openNote", id: item.id, relMdPath: item.relMdPath });
    });

    card.appendChild(btn);
    return card;
  }

  function noteScopeLabel(scope) {
    if (scope === "project") return uiStrings.noteScopeProject || "Project";
    if (scope === "session") return uiStrings.noteScopeSession || "Session";
    return uiStrings.noteScopeLibrary || "Library";
  }

  function makeActionButton(label, tooltip, isWarn, onClick) {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "session-action" + (isWarn ? " session-action-warn" : "");
    btn.title = tooltip;
    btn.setAttribute("aria-label", tooltip);
    btn.textContent = label;
    btn.addEventListener("click", (event) => {
      event.stopPropagation();
      onClick();
    });
    return btn;
  }

  function appendHighlightedText(container, text, rawQuery) {
    const value = typeof text === "string" ? text : "";
    const trimmed = (rawQuery || "").trim();
    if (!trimmed || !value) {
      container.textContent = value;
      return;
    }

    const terms = trimmed
      .split(/\s+/)
      .filter(Boolean)
      .sort((a, b) => b.length - a.length);
    if (!terms.length) {
      container.textContent = value;
      return;
    }

    const escaped = terms.map((t) => t.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
    const regex = new RegExp(`(${escaped.join("|")})`, "gi");
    let lastIndex = 0;
    let match;
    let count = 0;
    while ((match = regex.exec(value)) !== null && count < 20) {
      if (match.index > lastIndex) {
        container.appendChild(document.createTextNode(value.slice(lastIndex, match.index)));
      }
      const mark = document.createElement("mark");
      mark.className = "match-hl";
      mark.textContent = match[0];
      container.appendChild(mark);
      lastIndex = regex.lastIndex;
      count++;
      if (match.index === regex.lastIndex) regex.lastIndex++;
    }
    if (lastIndex < value.length) {
      container.appendChild(document.createTextNode(value.slice(lastIndex)));
    }
  }

  function appendProviderIcon(container, provider) {
    const entry = providerIcons[provider];
    if (!entry) return;
    if (typeof entry === "string") {
      const img = document.createElement("img");
      img.className = "provider-icon";
      img.src = entry;
      img.alt = "";
      img.setAttribute("aria-hidden", "true");
      container.appendChild(img);
      return;
    }
    if (entry.light) {
      const imgLight = document.createElement("img");
      imgLight.className = "provider-icon provider-icon-light";
      imgLight.src = entry.light;
      imgLight.alt = "";
      imgLight.setAttribute("aria-hidden", "true");
      container.appendChild(imgLight);
    }
    if (entry.dark) {
      const imgDark = document.createElement("img");
      imgDark.className = "provider-icon provider-icon-dark";
      imgDark.src = entry.dark;
      imgDark.alt = "";
      imgDark.setAttribute("aria-hidden", "true");
      container.appendChild(imgDark);
    }
  }

  // Preview Modal logic
  function normalizeMode(mode) {
    return markdownHelper ? markdownHelper.normalizeMode(mode) : mode === "raw" ? "raw" : "markdown";
  }

  function applyFormattedText(el, text) {
    if (markdownHelper) {
      markdownHelper.applyFormattedText(el, text, previewRenderMode);
      return;
    }
    el.classList.remove("markdown-body");
    el.textContent = typeof text === "string" ? text : "";
  }

  function updateRenderModeButtons() {
    const isMarkdown = previewRenderMode === "markdown";
    if (previewModeMarkdown) {
      previewModeMarkdown.classList.toggle("active", isMarkdown);
      previewModeMarkdown.setAttribute("aria-pressed", String(isMarkdown));
    }
    if (previewModeRaw) {
      previewModeRaw.classList.toggle("active", !isMarkdown);
      previewModeRaw.setAttribute("aria-pressed", String(!isMarkdown));
    }
  }

  function setPreviewRenderMode(nextMode, persist) {
    const normalized = normalizeMode(nextMode);
    if (normalized === previewRenderMode) {
      updateRenderModeButtons();
      return;
    }
    previewRenderMode = normalized;
    updateRenderModeButtons();
    renderPreviewMessages();
    if (previewSummaryState.visible) {
      renderSummary(previewSummaryState.text, previewSummaryState.isError);
    }
    if (previewFind?.isOpen()) {
      previewFind.refresh(false);
    }
    if (persist) {
      vscode.postMessage({ type: "setPreviewRenderMode", mode: previewRenderMode });
    }
  }

  previewModeMarkdown?.addEventListener("click", () => setPreviewRenderMode("markdown", true));
  previewModeRaw?.addEventListener("click", () => setPreviewRenderMode("raw", true));

  previewResume.addEventListener("click", () => {
    if (!activePreviewSession) return;
    vscode.postMessage({
      type: "previewResume",
      provider: activePreviewSession.provider,
      id: activePreviewSession.id
    });
  });

  previewResumeWith.addEventListener("click", () => {
    if (!activePreviewSession) return;
    vscode.postMessage({
      type: "previewResumeWith",
      provider: activePreviewSession.provider,
      id: activePreviewSession.id
    });
  });

  previewSummarize.addEventListener("click", () => {
    if (activePreviewSession) postLlmAction("summarize");
  });

  previewAutoRename.addEventListener("click", () => {
    if (activePreviewSession) postLlmAction("autoRename");
  });

  previewHandoff.addEventListener("click", () => {
    if (activePreviewSession) postLlmAction("continueWithAgent");
  });

  previewRename.addEventListener("click", () => {
    if (!activePreviewSession) return;
    previewRename.disabled = true;
    vscode.postMessage({
      type: "rename",
      provider: activePreviewSession.provider,
      id: activePreviewSession.id
    });
  });

  previewClose.addEventListener("click", closePreview);
  previewOverlay.addEventListener("click", (event) => {
    if (event.target === previewOverlay) closePreview();
  });

  function showPreview(message) {
    activePreviewSession = { provider: message.provider, id: message.id };
    previewRenderMode = normalizeMode(message.renderMode);
    updateRenderModeButtons();
    previewRename.disabled = false;
    previewRename.classList.toggle("hidden", message.provider === "chat");
    previewResumeWith.classList.toggle("hidden", message.showResumeWith === false);
    applyLlmActions(message.llmConfigured === true, message.showHandoff === true);
    renderNotices(message);
    previewTitle.textContent = message.title || previewUiStrings.defaultTitle || "Session Preview";
    previewMessagesData = Array.isArray(message.messages) ? message.messages : [];

    if (message.cachedSummary) {
      renderSummary(message.cachedSummary);
    } else {
      previewSummaryState = { text: "", isError: false, visible: false };
      previewSummary.classList.add("hidden");
      previewSummary.classList.remove("markdown-body");
      previewSummary.textContent = "";
    }

    renderPreviewMessages();
    previewOverlay.classList.remove("hidden");
    previewOverlay.setAttribute("aria-hidden", "false");
    previewBody.scrollTop = 0;
  }

  function renderPreviewMessages() {
    previewMessages.innerHTML = "";
    for (const entry of previewMessagesData) {
      const block = document.createElement("div");
      block.className = `preview-message ${entry.role}`;

      const role = document.createElement("div");
      role.className = "preview-role";
      role.textContent =
        entry.role === "assistant"
          ? previewUiStrings.roleAssistant || "Assistant"
          : previewUiStrings.roleUser || "User";

      const text = document.createElement("div");
      text.className = "preview-text";
      applyFormattedText(text, entry.text);

      block.appendChild(role);
      block.appendChild(text);
      previewMessages.appendChild(block);
    }
    if (previewFind?.isOpen()) {
      previewFind.refresh(false);
    }
  }

  function closePreview() {
    previewFind?.close();
    activePreviewSession = null;
    previewMessagesData = [];
    previewSummaryState = { text: "", isError: false, visible: false };
    previewRename.disabled = false;
    setAiButtonsDisabled(false);
    previewNotice.innerHTML = "";
    previewNotice.classList.add("hidden");
    previewSummary.classList.add("hidden");
    previewOverlay.classList.add("hidden");
    previewOverlay.setAttribute("aria-hidden", "true");
    vscode.postMessage({ type: "previewClosed" });
  }

  function renderSummary(text, isError) {
    previewSummaryState = { text: typeof text === "string" ? text : "", isError: Boolean(isError), visible: true };
    if (previewSummaryState.isError) {
      previewSummary.classList.remove("markdown-body");
      previewSummary.textContent = previewSummaryState.text;
    } else {
      applyFormattedText(previewSummary, previewSummaryState.text);
    }
    previewSummary.classList.remove("hidden");
    previewSummary.classList.toggle("preview-summary-error", previewSummaryState.isError);
    if (previewFind?.isOpen()) {
      previewFind.refresh(false);
    }
  }

  function renderNotices(message) {
    previewNotice.innerHTML = "";
    const parts = [];
    if (message.truncated) {
      parts.push({
        kind: "text",
        text: previewUiStrings.noticeTruncated || "Showing the most recent 100 messages."
      });
    }
    if (message.warning) {
      parts.push({ kind: "text", text: message.warning });
    }
    if (message.llmConfigured !== true) {
      parts.push({ kind: "llm" });
    }
    if (!parts.length) {
      previewNotice.classList.add("hidden");
      return;
    }
    previewNotice.classList.remove("hidden");
    for (const part of parts) {
      if (part.kind === "text") {
        const line = document.createElement("div");
        line.className = "preview-notice-line";
        line.textContent = part.text;
        previewNotice.appendChild(line);
        continue;
      }
      const row = document.createElement("div");
      row.className = "preview-notice-line preview-notice-llm";
      const text = document.createElement("span");
      text.textContent = (previewUiStrings.noticeLlmSetup || "") + " ";
      row.appendChild(text);
      const button = document.createElement("button");
      button.type = "button";
      button.className = "preview-notice-action";
      button.textContent = previewUiStrings.noticeOpenLlmSettings || "Open LLM Settings";
      button.addEventListener("click", () => vscode.postMessage({ type: "openLlmSettings" }));
      row.appendChild(button);
      previewNotice.appendChild(row);
    }
  }

  function applyLlmActions(llmConfigured, showHandoff) {
    const needsConfig = llmConfigured !== true;
    const isAcp = activePreviewSession?.provider === "chat";
    previewSummarize.classList.toggle("hidden", isAcp);
    previewAutoRename.classList.toggle("hidden", isAcp);
    previewSummarize.classList.toggle("preview-action-muted", needsConfig);
    previewAutoRename.classList.toggle("preview-action-muted", needsConfig);
    const llmHint = previewUiStrings.tooltipLlmRequired || "Configure LLM Assist in Agent Resume Settings";
    previewSummarize.title = needsConfig ? llmHint : "";
    previewAutoRename.title = needsConfig ? llmHint : "";
    previewHandoff.classList.toggle("hidden", showHandoff !== true);
    if (showHandoff === true) {
      previewHandoff.classList.toggle("preview-action-muted", needsConfig);
      previewHandoff.title = needsConfig ? llmHint : "";
    }
  }

  function postLlmAction(type) {
    if (!activePreviewSession) return;
    if (previewSummarize.classList.contains("preview-action-muted")) {
      vscode.postMessage({ type: "openLlmSettings" });
      return;
    }
    setAiButtonsDisabled(true);
    vscode.postMessage({ type, provider: activePreviewSession.provider, id: activePreviewSession.id });
  }

  function setAiButtonsDisabled(disabled) {
    previewSummarize.disabled = disabled;
    previewAutoRename.disabled = disabled;
    previewHandoff.disabled = disabled;
  }

  function sessionKey(provider, id) {
    return `${provider}:${id}`;
  }

  window.addEventListener("message", (event) => {
    const message = event.data;

    if (message.type === "init") {
      uiStrings = message.uiStrings || {};
      previewUiStrings = message.previewUiStrings || {};
      providerIcons = message.providerIcons || {};
      applyStaticUi();
      state = {
        projects: message.projects || [],
        sessions: message.sessions || { items: [], total: 0, hasMore: false },
        acp: message.acp || { items: [], total: 0, hasMore: false },
        notes: message.notes || { items: [], total: 0, hasMore: false },
        gtdStatuses: message.gtdStatuses || [],
        totalSessions: typeof message.totalSessions === "number" ? message.totalSessions : 0,
        untaggedCount: typeof message.untaggedCount === "number" ? message.untaggedCount : 0,
        indexedCounts: message.indexedCounts || { sessions: 0, acp: 0, notes: 0 },
        queryTimeMs: message.queryTimeMs || 0,
        usingFallback: Boolean(message.usingFallback)
      };
      loadingColumns = { session: false, acp: false, note: false };
      selectedProjectPath = null;
      selectedGtdFilter = null;
      query = searchInput.value;
      updateSearchClearVisibility();
      renderProjectControls();
      renderGtdChips();
      renderIndexStatus();
      renderColumns();
      previewRename.disabled = false;
      if (query.trim()) {
        requestAllColumns();
      }
      return;
    }

    if (message.type === "pageResult") {
      const col = message.column;
      if (col === "session" || col === "acp" || col === "note") {
        loadingColumns[col] = false;
        const incoming =
          col === "session" ? message.sessions : col === "acp" ? message.acp : message.notes;
        const prevItems =
          col === "session"
            ? state.sessions.items
            : col === "acp"
              ? state.acp.items
              : state.notes.items;
        const merged = {
          items: message.append ? prevItems.concat(incoming.items || []) : incoming.items || [],
          total: incoming.total ?? 0,
          hasMore: Boolean(incoming.hasMore)
        };
        if (col === "session") state.sessions = merged;
        else if (col === "acp") state.acp = merged;
        else state.notes = merged;
      } else {
        loadingColumns = { session: false, acp: false, note: false };
        state.sessions = message.sessions || { items: [], total: 0, hasMore: false };
        state.acp = message.acp || { items: [], total: 0, hasMore: false };
        state.notes = message.notes || { items: [], total: 0, hasMore: false };
      }
      if (message.indexedCounts) state.indexedCounts = message.indexedCounts;
      if (typeof message.queryTimeMs === "number") state.queryTimeMs = message.queryTimeMs;
      state.usingFallback = Boolean(message.usingFallback);
      renderIndexStatus();
      renderColumns();
      return;
    }

    if (message.type === "indexSyncing") {
      isSyncingIndex = true;
      renderIndexStatus();
      return;
    }

    if (message.type === "indexSynced") {
      isSyncingIndex = false;
      if (message.stats) {
        state.indexedCounts = {
          sessions: message.stats.indexedSessions ?? state.indexedCounts.sessions,
          acp: message.stats.indexedAcp ?? state.indexedCounts.acp,
          notes: message.stats.indexedNotes ?? state.indexedCounts.notes
        };
      }
      renderIndexStatus();
      if (message.shouldRefresh) {
        requestAllColumns();
      }
      return;
    }

    if (message.type === "indexSyncError") {
      isSyncingIndex = false;
      renderIndexStatus();
      return;
    }

    if (message.type === "previewLoading") {
      previewLoadingKey = sessionKey(message.provider, message.id);
      renderColumns();
      return;
    }

    if (message.type === "previewResult") {
      previewLoadingKey = null;
      renderColumns();
      if (!message.error) showPreview(message);
      return;
    }

    if (message.type === "renameDone") {
      previewRename.disabled = false;
      return;
    }

    if (message.type === "titleUpdated") {
      const nextTitle = typeof message.title === "string" ? message.title.trim() : "";
      if (nextTitle) {
        previewTitle.textContent = nextTitle;
      }
      previewRename.disabled = false;
      setAiButtonsDisabled(false);
      requestAllColumns();
      return;
    }

    if (message.type === "summaryLoading") {
      renderSummary(previewUiStrings.summarizing || "Summarizing session...");
      return;
    }

    if (message.type === "summaryResult") {
      renderSummary(message.summary || "");
      setAiButtonsDisabled(false);
      return;
    }

    if (message.type === "summaryError") {
      renderSummary(message.error || previewUiStrings.summarizeFailed || "Summarize failed.", true);
      setAiButtonsDisabled(false);
      return;
    }

    if (message.type === "autoRenameDone" || message.type === "handoffDone" || message.type === "handoffError") {
      setAiButtonsDisabled(false);
    }
  });

  const previewFind = previewFindHelper
    ? previewFindHelper.createController({
        containers: [previewSummary, previewMessages],
        barEl: previewFindBar,
        inputEl: previewFindInput,
        countEl: previewFindCount,
        prevBtn: previewFindPrev,
        nextBtn: previewFindNext,
        closeBtn: previewFindClose,
        toggleBtn: previewFindToggle
      })
    : null;

  document.addEventListener("keydown", (event) => {
    const isPreviewVisible = previewOverlay && !previewOverlay.classList.contains("hidden");
    if ((event.ctrlKey || event.metaKey) && !event.altKey && event.key.toLowerCase() === "f") {
      event.preventDefault();
      if (isPreviewVisible) {
        previewFind?.open();
      } else if (searchInput) {
        searchInput.focus();
        searchInput.select();
      }
      return;
    }
    if (event.key === "Escape" && isPreviewVisible) {
      if (previewFind?.isOpen()) {
        event.preventDefault();
        previewFind.close();
      } else {
        event.preventDefault();
        closePreview();
      }
    }
  });

  vscode.postMessage({ type: "ready" });
})();
