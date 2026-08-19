(function () {
  const vscode = acquireVsCodeApi();
  /** @type {Record<string, string>} */
  let uiStrings = {};
  let locale = "en";
  let view = { year: new Date().getFullYear(), month: new Date().getMonth() };
  let focus = { type: "day", key: "" };
  let monthData = null;
  let focusData = null;

  const els = {
    banner: document.getElementById("banner"),
    yearSelect: document.getElementById("year-select"),
    monthSelect: document.getElementById("month-select"),
    prevMonth: document.getElementById("prev-month"),
    nextMonth: document.getElementById("next-month"),
    todayBtn: document.getElementById("today-btn"),
    refreshBtn: document.getElementById("refresh-btn"),
    weekdays: document.getElementById("weekdays"),
    calGrid: document.getElementById("cal-grid"),
    monthBtn: document.getElementById("month-btn"),
    legend: document.getElementById("legend"),
    sessionsTitle: document.getElementById("sessions-title"),
    sessionsMeta: document.getElementById("sessions-meta"),
    sessionList: document.getElementById("session-list"),
    detailTitle: document.getElementById("detail-title"),
    detailBody: document.getElementById("detail-body"),
    status: document.getElementById("status")
  };

  if (typeof marked !== "undefined") {
    marked.setOptions({ breaks: true, gfm: true });
  }

  function formatUi(template, ...args) {
    let text = template || "";
    args.forEach((arg, index) => {
      text = text.replaceAll(`{${index}}`, String(arg));
    });
    return text;
  }

  function levelFor(type) {
    return type === "day" ? "daily" : type === "week" ? "weekly" : "monthly";
  }

  function digestLabel(type) {
    if (type === "day") return uiStrings.digestDaily || "Daily digest";
    if (type === "week") return uiStrings.digestWeekly || "Weekly digest";
    return uiStrings.digestMonthly || "Monthly digest";
  }

  function rangeLabel(type, key) {
    if (type === "day") return formatUi(uiStrings.rangeDay || "Day {0}", key);
    if (type === "week") return formatUi(uiStrings.rangeWeek || "Week {0}", key);
    return formatUi(uiStrings.rangeMonth || "Month {0}", key);
  }

  function renderMarkdown(text) {
    if (typeof marked === "undefined" || typeof DOMPurify === "undefined") {
      const pre = document.createElement("pre");
      pre.textContent = text || "";
      return pre.outerHTML;
    }
    const html = marked.parse(text || "");
    return DOMPurify.sanitize(html);
  }

  function applyUiStrings() {
    if (els.banner) {
      els.banner.textContent = uiStrings.readonlyBanner || els.banner.textContent;
    }
    if (els.todayBtn) {
      els.todayBtn.textContent = uiStrings.today || "Today";
    }
    if (els.refreshBtn) {
      els.refreshBtn.textContent = uiStrings.refresh || "Refresh";
    }
    if (els.prevMonth) {
      els.prevMonth.title = uiStrings.prevMonth || "Previous month";
    }
    if (els.nextMonth) {
      els.nextMonth.title = uiStrings.nextMonth || "Next month";
    }
    if (els.yearSelect) {
      els.yearSelect.setAttribute("aria-label", uiStrings.yearLabel || "Year");
    }
    if (els.monthSelect) {
      els.monthSelect.setAttribute("aria-label", uiStrings.monthLabel || "Month");
    }
    if (els.weekdays) {
      els.weekdays.innerHTML = [
        uiStrings.weekdayMon || "Mon",
        uiStrings.weekdayTue || "Tue",
        uiStrings.weekdayWed || "Wed",
        uiStrings.weekdayThu || "Thu",
        uiStrings.weekdayFri || "Fri",
        uiStrings.weekdaySat || "Sat",
        uiStrings.weekdaySun || "Sun",
        uiStrings.weekCol || "Wk"
      ]
        .map((label) => "<span>" + escapeHtml(label) + "</span>")
        .join("");
    }
    if (els.legend) {
      els.legend.textContent = uiStrings.legend || "";
    }
  }

  function fillSelectors() {
    const nowYear = new Date().getFullYear();
    if (!els.yearSelect || !els.monthSelect) return;
    els.yearSelect.innerHTML = "";
    for (let y = nowYear + 2; y >= nowYear - 15; y--) {
      const opt = document.createElement("option");
      opt.value = String(y);
      opt.textContent = String(y);
      els.yearSelect.appendChild(opt);
    }
    els.monthSelect.innerHTML = "";
    const monthNames = [
      uiStrings.month1,
      uiStrings.month2,
      uiStrings.month3,
      uiStrings.month4,
      uiStrings.month5,
      uiStrings.month6,
      uiStrings.month7,
      uiStrings.month8,
      uiStrings.month9,
      uiStrings.month10,
      uiStrings.month11,
      uiStrings.month12
    ];
    for (let m = 0; m < 12; m++) {
      const opt = document.createElement("option");
      opt.value = String(m);
      opt.textContent = monthNames[m] || String(m + 1);
      els.monthSelect.appendChild(opt);
    }
    els.yearSelect.value = String(view.year);
    els.monthSelect.value = String(view.month);
  }

  function escapeHtml(value) {
    return String(value)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  function setStatus(message) {
    if (!els.status) return;
    if (!message) {
      els.status.hidden = true;
      els.status.textContent = "";
      return;
    }
    els.status.hidden = false;
    els.status.textContent = message;
  }

  function renderCalendar() {
    if (!monthData || !els.calGrid || !els.monthBtn) return;
    const digestSet = new Set(monthData.digestKeys || []);
    const sessionDays = new Set(monthData.sessionDays || []);
    const cells = monthData.cells || [];
    const weeks = [];
    for (let i = 0; i < cells.length; i += 7) {
      weeks.push(cells.slice(i, i + 7));
    }

    const fragment = document.createDocumentFragment();
    weeks.forEach((weekCells) => {
      weekCells.forEach((cell) => {
        const hasDigest = digestSet.has("daily:" + cell.key);
        const hasSession = sessionDays.has(cell.key);
        const markClass = hasDigest ? "daily" : !cell.outside && hasSession ? "daily-missing" : "no-session";
        const markText = hasDigest ? "D" : !cell.outside && hasSession ? "+" : "-";
        const btn = document.createElement("button");
        btn.type = "button";
        btn.className =
          "cal-cell" +
          (cell.outside ? " outside" : "") +
          (focus.type === "day" && focus.key === cell.key ? " selected" : "");
        btn.innerHTML =
          '<span class="day-num">' +
          cell.day +
          '</span><span class="marks"><span class="mark ' +
          markClass +
          '" aria-hidden="true">' +
          markText +
          "</span></span>";
        btn.addEventListener("click", () => {
          vscode.postMessage({ type: "selectFocus", focusType: "day", focusKey: cell.key });
        });
        fragment.appendChild(btn);
      });

      const week = weekCells[0] && weekCells[0].week;
      const weekBtn = document.createElement("button");
      weekBtn.type = "button";
      weekBtn.className =
        "cal-week-btn" +
        (digestSet.has("weekly:" + week) ? " has-digest" : "") +
        (focus.type === "week" && focus.key === week ? " selected" : "");
      weekBtn.textContent = week ? week.slice(-3) : "";
      weekBtn.addEventListener("click", () => {
        vscode.postMessage({ type: "selectFocus", focusType: "week", focusKey: week });
      });
      fragment.appendChild(weekBtn);
    });

    els.calGrid.innerHTML = "";
    els.calGrid.appendChild(fragment);

    els.monthBtn.textContent = (uiStrings.monthBtn || "Month digest") + " · " + monthData.monthKey;
    els.monthBtn.className =
      "month-btn" +
      (monthData.hasMonthDigest ? " has-digest" : "") +
      (focus.type === "month" && focus.key === monthData.monthKey ? " selected" : "");
    els.monthBtn.onclick = () => {
      vscode.postMessage({
        type: "selectFocus",
        focusType: "month",
        focusKey: monthData.monthKey
      });
    };
  }

  function renderSessions() {
    if (!focusData || !els.sessionsTitle || !els.sessionsMeta || !els.sessionList) return;
    els.sessionsTitle.textContent =
      (uiStrings.sessionsTitle || "Sessions") + " · " + rangeLabel(focus.type, focus.key);
    const sessions = focusData.sessions || [];
    els.sessionsMeta.textContent = formatUi(uiStrings.sessionCountMeta || "{0} sessions", sessions.length);
    els.sessionList.innerHTML = "";

    if (!sessions.length) {
      const empty = document.createElement("p");
      empty.className = "empty-hint muted";
      empty.textContent = uiStrings.noSessionsInRange || "No sessions in this range.";
      els.sessionList.appendChild(empty);
      return;
    }

    sessions.forEach((session) => {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "session-row";
      btn.innerHTML =
        '<div class="s-title">' +
        escapeHtml(session.title || session.id) +
        '</div><div class="s-meta"><span class="provider-tag">' +
        escapeHtml(session.provider) +
        "</span> · " +
        escapeHtml(session.projectName || "") +
        " · " +
        escapeHtml(session.updatedAtLabel || "") +
        "</div>";
      btn.addEventListener("click", () => {
        vscode.postMessage({
          type: "openSession",
          provider: session.provider,
          id: session.id
        });
      });
      els.sessionList.appendChild(btn);
    });
  }

  function renderDetail() {
    if (!focusData || !els.detailTitle || !els.detailBody) return;
    const entry = focusData.entry;
    const label = digestLabel(focus.type);
    els.detailTitle.textContent = formatUi(
      uiStrings.digestDetailTitle || "{0} · {1}",
      label,
      focus.key
    );
    els.detailBody.innerHTML = "";

    if (focusData.isFuture) {
      const p = document.createElement("p");
      p.className = "empty-hint muted";
      p.textContent = formatUi(uiStrings.futureDateHint || "This {0} is in the future.", label);
      els.detailBody.appendChild(p);
      return;
    }

    if (!entry) {
      const wrap = document.createElement("div");
      wrap.className = "digest-card";
      const hasSessions = (focusData.sessions || []).length > 0;
      const p = document.createElement("p");
      p.className = "empty-hint muted";
      p.textContent = hasSessions
        ? formatUi(
            uiStrings.emptyHasSessions ||
              "No digest yet for {0}. Sessions exist, but digests are generated only in the desktop app.",
            rangeLabel(focus.type, focus.key),
            label
          )
        : formatUi(
            uiStrings.emptyNoSessions || "No digest and no sessions for {0}.",
            rangeLabel(focus.type, focus.key),
            label
          );
      const note = document.createElement("p");
      note.className = "empty-hint muted";
      note.textContent =
        uiStrings.generateInAppHint ||
        "Open Agent Resume desktop app to generate, regenerate, or delete digests.";
      wrap.appendChild(p);
      wrap.appendChild(note);
      els.detailBody.appendChild(wrap);
      return;
    }

    const article = document.createElement("article");
    article.className = "digest-card";
    const created = entry.createdAtMs ? new Date(entry.createdAtMs).toLocaleString(locale) : "";
    article.innerHTML =
      "<h3><span class=\"badge\">" +
      escapeHtml(entry.level || levelFor(focus.type)) +
      "</span>" +
      escapeHtml(entry.title || entry.id) +
      "</h3>" +
      '<div class="meta-line">' +
      escapeHtml(created) +
      (entry.embeddingJson ? " · embedding ✓" : "") +
      '</div><div class="markdown-body">' +
      renderMarkdown(entry.content || "") +
      "</div>";
    els.detailBody.appendChild(article);
  }

  function renderAll() {
    fillSelectors();
    renderCalendar();
    renderSessions();
    renderDetail();
  }

  if (els.prevMonth) {
    els.prevMonth.addEventListener("click", () => {
      const next = new Date(view.year, view.month - 1, 1);
      vscode.postMessage({ type: "setView", year: next.getFullYear(), month: next.getMonth() });
    });
  }
  if (els.nextMonth) {
    els.nextMonth.addEventListener("click", () => {
      const next = new Date(view.year, view.month + 1, 1);
      vscode.postMessage({ type: "setView", year: next.getFullYear(), month: next.getMonth() });
    });
  }
  if (els.yearSelect) {
    els.yearSelect.addEventListener("change", () => {
      vscode.postMessage({
        type: "setView",
        year: Number(els.yearSelect.value),
        month: Number(els.monthSelect.value)
      });
    });
  }
  if (els.monthSelect) {
    els.monthSelect.addEventListener("change", () => {
      vscode.postMessage({
        type: "setView",
        year: Number(els.yearSelect.value),
        month: Number(els.monthSelect.value)
      });
    });
  }
  if (els.todayBtn) {
    els.todayBtn.addEventListener("click", () => vscode.postMessage({ type: "goToday" }));
  }
  if (els.refreshBtn) {
    els.refreshBtn.addEventListener("click", () => vscode.postMessage({ type: "refresh" }));
  }

  window.addEventListener("message", (event) => {
    const message = event.data || {};
    if (message.type === "init") {
      uiStrings = message.uiStrings || {};
      locale = message.locale || "en";
      applyUiStrings();
      setStatus("");
      return;
    }
    if (message.type === "data") {
      view = message.view || view;
      focus = message.focus || focus;
      monthData = message.month || null;
      focusData = message.focusData || null;
      setStatus(monthData && monthData.dbAvailable === false ? uiStrings.noDesktopDb || "" : "");
      renderAll();
      return;
    }
    if (message.type === "error") {
      setStatus(message.message || uiStrings.loadFailed || "Failed to load report data.");
    }
  });

  vscode.postMessage({ type: "ready" });
})();
