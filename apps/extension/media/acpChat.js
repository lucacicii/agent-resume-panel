(function () {
  const vscode = acquireVsCodeApi();
  const headerIcon = document.getElementById("header-icon");
  const headerTitle = document.getElementById("header-title");
  const headerMeta = document.getElementById("header-meta");
  const headerUsage = document.getElementById("header-usage");
  const statusPill = document.getElementById("status-pill");
  const statusDot = document.getElementById("status-dot");
  const statusLabelEl = document.getElementById("status-label");
  const messagesEl = document.getElementById("messages");
  const messagesInner = document.getElementById("messages-inner");
  const emptyStateEl = document.getElementById("empty-state");
  const scrollBottomBtn = document.getElementById("scroll-bottom");
  const composerCard = document.getElementById("composer-card");
  const input = document.getElementById("input");
  const sendStopBtn = document.getElementById("send-stop");
  const reconnectBtn = document.getElementById("reconnect");
  const attachBtn = document.getElementById("attach");
  const slashTriggerBtn = document.getElementById("slash-trigger");
  const slashMenuEl = document.getElementById("slash-menu");
  const configControlsEl = document.getElementById("config-controls");
  const fileInput = document.getElementById("file-input");
  const pendingImagesEl = document.getElementById("pending-images");
  const lightboxEl = document.getElementById("image-lightbox");
  const lightboxImg = document.getElementById("image-lightbox-img");

  const MAX_IMAGES = 4;
  const MAX_IMAGE_BYTES = 5 * 1024 * 1024;
  const ALLOWED_MIME_TYPES = new Set(["image/png", "image/jpeg", "image/webp", "image/gif"]);

  let streamingRow = null;
  let streamingMessageId = null;
  let lastInit = null;
  let uiStrings = {};
  let imageUploadEnabled = false;
  let pendingImages = [];
  let availableCommands = [];
  let filteredCommands = [];
  let slashActiveIndex = 0;
  let slashMenuOpen = false;
  let autoScrollEnabled = true;
  let pendingDelta = null;
  let rafId = null;
  let draftRestored = false;
  let draftSaveTimer = null;
  let dragDepth = 0;

  if (typeof marked !== "undefined") {
    marked.setOptions({ breaks: true, gfm: true });
  }

  function isLightTheme() {
    return (
      document.body.classList.contains("vscode-light") ||
      document.body.classList.contains("vscode-high-contrast-light")
    );
  }

  function resolveAgentIcon(iconEntry) {
    if (!iconEntry) {
      return "";
    }
    if (typeof iconEntry === "string") {
      return iconEntry;
    }
    return isLightTheme() ? iconEntry.light || iconEntry.dark || "" : iconEntry.dark || iconEntry.light || "";
  }

  function formatUi(template, ...args) {
    let text = template || "";
    args.forEach((arg, index) => {
      text = text.replaceAll(`{${index}}`, String(arg));
    });
    return text;
  }

  function newId() {
    return typeof crypto !== "undefined" && crypto.randomUUID
      ? crypto.randomUUID()
      : `img-${Date.now()}-${Math.random().toString(16).slice(2)}`;
  }

  function statusLabel(state) {
    if (state?.isConnecting) {
      return uiStrings.statusConnecting || "connecting";
    }
    if (state?.isRunning) {
      return uiStrings.statusRunning || "running";
    }
    if (state?.status === "error") {
      return uiStrings.statusError || "error";
    }
    return uiStrings.statusReady || "ready";
  }

  function updateStatusBadge(state) {
    if (!statusPill) {
      return;
    }
    let kind = "ready";
    if (state?.isConnecting) {
      kind = "connecting";
    } else if (state?.isRunning) {
      kind = "running";
    } else if (state?.status === "error") {
      kind = "error";
    }
    statusPill.className = `status-pill ${kind}`;
    if (statusDot) {
      statusDot.className = `status-dot ${kind}`;
    }
    if (statusLabelEl) {
      statusLabelEl.textContent = statusLabel(state);
    }
  }

  function renderHeader(init) {
    if (!init) {
      return;
    }
    lastInit = init;
    if (init.uiStrings) {
      uiStrings = init.uiStrings;
    }

    const iconSrc = resolveAgentIcon(init.agentIcon);
    if (headerIcon) {
      if (iconSrc) {
        headerIcon.src = iconSrc;
        headerIcon.hidden = false;
      } else {
        headerIcon.hidden = true;
      }
    }

    headerTitle.textContent = init.title || uiStrings.defaultTitle || "ACP Chat";
    const metaParts = [init.providerLabel || init.provider, init.projectPath].filter(Boolean);
    headerMeta.textContent = metaParts.join(" · ");
    updateStatusBadge(init);
    renderUsage(init.usage);
    renderEmptyState();
  }

  function renderUsage(usage) {
    if (!headerUsage) {
      return;
    }
    if (!usage || (usage.used == null && usage.size == null && usage.costAmount == null)) {
      headerUsage.hidden = true;
      return;
    }

    const parts = [];
    if (usage.used != null && usage.size != null) {
      const pct = usage.size > 0 ? Math.round((usage.used / usage.size) * 100) : 0;
      parts.push(`${pct}%`);
      headerUsage.title = formatUi(
        uiStrings.contextUsageTooltip || "Context window: {0} / {1}",
        usage.used.toLocaleString(),
        usage.size.toLocaleString()
      );
    }
    if (usage.costAmount != null) {
      const currency = usage.costCurrency || "USD";
      const prefix = currency === "USD" ? "$" : `${currency} `;
      parts.push(`${prefix}${usage.costAmount.toFixed(4)}`);
    }

    if (!parts.length) {
      headerUsage.hidden = true;
      return;
    }
    headerUsage.textContent = parts.join(" · ");
    headerUsage.hidden = false;
  }

  function renderEmptyState() {
    if (!emptyStateEl) {
      return;
    }
    const hasMessages = Boolean(messagesInner && messagesInner.children.length > 0);
    if (hasMessages || !lastInit) {
      emptyStateEl.hidden = true;
      return;
    }

    emptyStateEl.hidden = false;
    emptyStateEl.replaceChildren();

    const iconSrc = resolveAgentIcon(lastInit.agentIcon);
    if (iconSrc) {
      const icon = document.createElement("img");
      icon.className = "empty-state-icon";
      icon.src = iconSrc;
      icon.alt = "";
      emptyStateEl.appendChild(icon);
    }

    const title = document.createElement("div");
    title.className = "empty-state-title";
    title.textContent = lastInit.providerLabel || lastInit.provider || uiStrings.defaultTitle || "ACP Chat";
    emptyStateEl.appendChild(title);

    if (lastInit.projectPath) {
      const pathEl = document.createElement("div");
      pathEl.className = "empty-state-path";
      pathEl.textContent = lastInit.projectPath;
      emptyStateEl.appendChild(pathEl);
    }

    const hint = document.createElement("div");
    hint.className = "empty-state-hint";
    hint.textContent =
      uiStrings.emptyHint ||
      "Start a conversation in this workspace. Ask questions, inspect files, or run tasks.";
    emptyStateEl.appendChild(hint);

    const shortcuts = document.createElement("div");
    shortcuts.className = "empty-state-shortcuts";
    const items = [
      uiStrings.emptyShortcutSend || "Enter to send",
      uiStrings.emptyShortcutNewline || "Shift+Enter for new line"
    ];
    if (availableCommands.length) {
      items.push(uiStrings.emptyShortcutSlash || "/ for commands");
    }
    if (imageUploadEnabled) {
      items.push(uiStrings.emptyShortcutImages || "Paste or drop images");
    }
    for (const label of items) {
      const chip = document.createElement("span");
      chip.className = "empty-shortcut";
      chip.textContent = label;
      shortcuts.appendChild(chip);
    }
    emptyStateEl.appendChild(shortcuts);
  }

  function applyStaticUi() {
    if (reconnectBtn) {
      const label = uiStrings.reconnect || "Reconnect";
      reconnectBtn.title = label;
      reconnectBtn.setAttribute("aria-label", label);
    }
    if (attachBtn) {
      const label = uiStrings.attachImage || "Attach image";
      attachBtn.title = label;
      attachBtn.setAttribute("aria-label", label);
    }
    if (slashTriggerBtn) {
      const label = uiStrings.slashCommands || "Slash commands";
      slashTriggerBtn.title = label;
      slashTriggerBtn.setAttribute("aria-label", label);
    }
    if (scrollBottomBtn) {
      const label = uiStrings.scrollToBottom || "Scroll to bottom";
      scrollBottomBtn.title = label;
      scrollBottomBtn.setAttribute("aria-label", label);
    }
    updateComposerChrome(lastInit);
    updateSendStopButton();
  }

  function escapeHtml(value) {
    return String(value)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  function formatJson(value) {
    if (value == null) {
      return "";
    }
    if (typeof value === "string") {
      return value;
    }
    try {
      return JSON.stringify(value, null, 2);
    } catch {
      return String(value);
    }
  }

  function renderToolCallContent(content) {
    if (!Array.isArray(content) || !content.length) {
      return "";
    }

    return content
      .map((item) => {
        if (item && typeof item === "object") {
          if (item.type === "text" && typeof item.text === "string") {
            return item.text;
          }
          return formatJson(item);
        }
        return String(item);
      })
      .filter(Boolean)
      .join("\n");
  }

  function renderMarkdown(text) {
    if (typeof marked === "undefined" || typeof DOMPurify === "undefined") {
      return null;
    }
    const html = marked.parse(text || "");
    return DOMPurify.sanitize(html, { USE_PROFILES: { html: true } });
  }

  function copyWithFeedback(text, button) {
    if (!text) {
      return;
    }
    const done = () => {
      if (!button) {
        return;
      }
      const original = button.textContent;
      button.classList.add("copied");
      button.textContent = uiStrings.copied || "Copied";
      setTimeout(() => {
        button.classList.remove("copied");
        button.textContent = uiStrings.copy || original || "Copy";
      }, 1500);
    };

    if (navigator.clipboard && typeof navigator.clipboard.writeText === "function") {
      navigator.clipboard.writeText(text).then(done).catch(() => {
        vscode.postMessage({ type: "copyText", text });
        done();
      });
    } else {
      vscode.postMessage({ type: "copyText", text });
      done();
    }
  }

  function enhanceCodeBlocks(container) {
    const pres = container.querySelectorAll("pre");
    for (const pre of pres) {
      if (pre.parentElement?.classList.contains("code-block-wrap")) {
        continue;
      }
      const codeEl = pre.querySelector("code");
      const langClass = [...(codeEl?.classList ?? [])].find((c) => c.startsWith("language-"));
      const lang = langClass ? langClass.slice("language-".length) : "code";

      const wrap = document.createElement("div");
      wrap.className = "code-block-wrap";

      const header = document.createElement("div");
      header.className = "code-block-header";

      const langLabel = document.createElement("span");
      langLabel.className = "code-block-lang";
      langLabel.textContent = lang;

      const copyBtn = document.createElement("button");
      copyBtn.type = "button";
      copyBtn.className = "code-copy-btn";
      copyBtn.textContent = uiStrings.copy || "Copy";
      copyBtn.addEventListener("click", () => {
        copyWithFeedback(codeEl ? codeEl.textContent || "" : pre.textContent || "", copyBtn);
      });

      header.append(langLabel, copyBtn);
      pre.parentNode?.insertBefore(wrap, pre);
      wrap.append(header, pre);
    }
  }

  function getTurnCard(row) {
    return row?.querySelector(".turn-card") ?? null;
  }

  function turnRowClass(role) {
    if (role === "user") {
      return "outgoing";
    }
    if (role === "assistant" || role === "plan") {
      return "incoming";
    }
    return "system";
  }

  function renderTurnHeader(card, message) {
    if (message.role !== "user" && message.role !== "assistant") {
      return;
    }

    let header = card.querySelector(".turn-header");
    if (!header) {
      header = document.createElement("div");
      header.className = "turn-header";
      card.prepend(header);
    }
    header.replaceChildren();

    const author = document.createElement("span");
    author.className = "turn-author";

    if (message.role === "assistant") {
      const iconSrc = resolveAgentIcon(lastInit?.agentIcon);
      if (iconSrc) {
        const img = document.createElement("img");
        img.className = "turn-author-icon";
        img.src = iconSrc;
        img.alt = "";
        author.appendChild(img);
      }
      const label = document.createElement("span");
      label.textContent = lastInit?.providerLabel || lastInit?.provider || "Agent";
      author.appendChild(label);
    } else {
      const label = document.createElement("span");
      label.textContent = uiStrings.roleYou || "You";
      author.appendChild(label);
    }

    const copyBtn = document.createElement("button");
    copyBtn.type = "button";
    copyBtn.className = "turn-copy-btn";
    copyBtn.textContent = uiStrings.copy || "Copy";
    copyBtn.hidden = !message.text;
    copyBtn.addEventListener("click", () => {
      copyWithFeedback(card.dataset.rawText || "", copyBtn);
    });

    header.append(author, copyBtn);
  }

  function renderThinking(card, thinkingText, isStreaming) {
    const trimmed = (thinkingText || "").trim();
    let block = card.querySelector(".thinking-block");

    if (!trimmed) {
      block?.remove();
      return;
    }

    const isActivelyThinking = Boolean(isStreaming && !card.dataset.hasAnswerText);
    if (!block) {
      block = document.createElement("details");
      block.className = "thinking-block";
      block.open = isActivelyThinking;
      block.addEventListener("toggle", () => {
        if (block.dataset.programmatic === "1") {
          return;
        }
        block.dataset.userToggled = "1";
      });
      const anchor = card.querySelector(".tool-calls-group") || card.querySelector(".text");
      card.insertBefore(block, anchor);
    }

    block.classList.toggle("is-thinking", isActivelyThinking);
    if (block.dataset.userToggled !== "1") {
      block.dataset.programmatic = "1";
      block.open = isActivelyThinking;
      delete block.dataset.programmatic;
    }

    let summary = block.querySelector(".thinking-summary");
    if (!summary) {
      summary = document.createElement("summary");
      summary.className = "thinking-summary";
      summary.innerHTML =
        '<span class="thinking-dot" aria-hidden="true"></span>' +
        '<span class="thinking-label"></span>' +
        '<span class="thinking-chevron" aria-hidden="true">▸</span>';
      block.appendChild(summary);
    }

    const labelEl = summary.querySelector(".thinking-label");
    if (labelEl) {
      labelEl.textContent = isActivelyThinking
        ? uiStrings.thinkingActive || "Thinking…"
        : uiStrings.thinkingTitle || "Thinking";
    }

    let body = block.querySelector(".thinking-body");
    if (!body) {
      body = document.createElement("div");
      body.className = "thinking-body";
      block.appendChild(body);
    }
    body.textContent = thinkingText;
  }

  function setMessageText(card, message) {
    if (!card) {
      return;
    }

    const textEl = card.querySelector(".text");
    const text = message.text || "";
    card.dataset.rawText = text;
    card.dataset.hasAnswerText = text.trim() ? "1" : "";

    const copyBtn = card.querySelector(".turn-copy-btn");
    if (copyBtn) {
      copyBtn.hidden = !text.trim();
    }

    if (message.role === "plan" && Array.isArray(message.planEntries) && message.planEntries.length) {
      textEl.innerHTML = "";
      textEl.classList.remove("markdown-body");
      textEl.hidden = true;
      renderPlanCard(card, message.planEntries);
      return;
    }

    card.querySelector(".plan-card")?.remove();

    const useMarkdown = message.role === "assistant" || message.role === "plan";
    const html = useMarkdown ? renderMarkdown(text) : null;

    if (!text) {
      textEl.innerHTML = "";
      textEl.classList.remove("markdown-body");
      textEl.hidden = Boolean(message.images?.length || message.toolCalls?.length || message.thinking);
      return;
    }

    textEl.hidden = false;
    if (html != null) {
      textEl.innerHTML = html;
      textEl.classList.add("markdown-body");
      enhanceCodeBlocks(textEl);
    } else {
      textEl.textContent = text;
      textEl.classList.remove("markdown-body");
    }
  }

  function renderPlanCard(card, entries) {
    let planCard = card.querySelector(".plan-card");
    if (!planCard) {
      planCard = document.createElement("div");
      planCard.className = "plan-card";
      card.appendChild(planCard);
    }

    const doneCount = entries.filter((entry) => entry.status === "completed").length;
    planCard.replaceChildren();

    const header = document.createElement("div");
    header.className = "plan-card-header";

    const title = document.createElement("span");
    title.className = "plan-card-title";
    title.textContent = uiStrings.planTitle || "Plan";

    const progress = document.createElement("span");
    progress.className = "plan-card-progress";
    progress.textContent = formatUi(uiStrings.planProgress || "{0}/{1} done", doneCount, entries.length);

    header.append(title, progress);
    planCard.appendChild(header);

    const list = document.createElement("ul");
    list.className = "plan-entries";

    for (const entry of entries) {
      const li = document.createElement("li");
      li.className = `plan-entry ${entry.status || "pending"}`;

      const icon = document.createElement("span");
      icon.className = "plan-entry-icon";
      icon.textContent =
        entry.status === "completed" ? "✓" : entry.status === "in_progress" ? "◐" : "○";

      const content = document.createElement("span");
      content.className = "plan-entry-text";
      content.textContent = entry.content;

      li.append(icon, content);
      list.appendChild(li);
    }

    planCard.appendChild(list);
  }

  function renderMessageImages(card, images) {
    let container = card.querySelector(".message-images");
    if (!images?.length) {
      container?.remove();
      return;
    }

    if (!container) {
      container = document.createElement("div");
      container.className = "message-images";
      const textEl = card.querySelector(".text");
      card.insertBefore(container, textEl);
    }

    container.replaceChildren();
    for (const image of images) {
      const img = document.createElement("img");
      img.className = "message-image";
      img.src = image.previewUrl;
      img.alt = image.fileName || "Attached image";
      img.loading = "lazy";
      img.addEventListener("click", () => openLightbox(image.previewUrl, img.alt));
      container.appendChild(img);
    }
  }

  function toolStatusGlyph(status) {
    switch (status) {
      case "completed":
        return "✓";
      case "failed":
        return "✕";
      case "in_progress":
        return "◌";
      default:
        return "○";
    }
  }

  function createLocationButton(loc) {
    const label = `${loc.path}${loc.line != null ? `:${loc.line}` : ""}`;
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "tool-location-link";
    btn.textContent = label;
    btn.title = formatUi(uiStrings.openFileTooltip || "Open {0}", label);
    btn.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      vscode.postMessage({ type: "openFile", path: loc.path, line: loc.line });
    });
    return btn;
  }

  function renderToolCalls(card, toolCalls) {
    const calls = toolCalls ?? [];
    let group = card.querySelector(".tool-calls-group");

    if (!calls.length) {
      group?.remove();
      return;
    }

    const groupWasOpen = group?.open ?? false;
    const itemOpenState = new Map();
    if (group) {
      group.querySelectorAll(".tool-call-item").forEach((item) => {
        itemOpenState.set(item.dataset.toolCallId, item.open);
      });
    }

    if (!group) {
      group = document.createElement("details");
      group.className = "tool-calls-group";
      const textEl = card.querySelector(".text");
      card.insertBefore(group, textEl);
    }

    const completed = calls.filter((entry) => entry.status === "completed" || entry.status === "failed").length;
    const summary = document.createElement("summary");
    summary.className = "tool-calls-summary";
    const doneSuffix =
      completed > 0 ? formatUi(uiStrings.toolCallsDone || ", {0} done", completed) : "";
    const summaryText = document.createElement("span");
    summaryText.textContent = formatUi(
      uiStrings.toolCallsSummary || "Tool calls ({0}{1})",
      calls.length,
      doneSuffix
    );
    const chevron = document.createElement("span");
    chevron.className = "tool-calls-chevron";
    chevron.setAttribute("aria-hidden", "true");
    chevron.textContent = "▸";
    summary.append(summaryText, chevron);

    group.replaceChildren(summary);
    group.open = groupWasOpen;

    const list = document.createElement("div");
    list.className = "tool-calls-list";

    for (const toolCall of calls) {
      const item = document.createElement("details");
      const status = toolCall.status || "pending";
      item.className = `tool-call-item tool-status-${status}`;
      item.dataset.toolCallId = toolCall.toolCallId;

      const itemSummary = document.createElement("summary");
      itemSummary.className = "tool-call-summary";

      const icon = document.createElement("span");
      icon.className = "tool-call-icon";
      icon.textContent = toolStatusGlyph(status);

      const titleEl = document.createElement("span");
      titleEl.className = "tool-call-title";
      titleEl.textContent = toolCall.title || toolCall.kind || "Tool";

      itemSummary.append(icon, titleEl);

      if (toolCall.kind && toolCall.kind !== "other") {
        const kindBadge = document.createElement("span");
        kindBadge.className = "tool-call-kind";
        kindBadge.textContent = toolCall.kind;
        itemSummary.appendChild(kindBadge);
      }

      const firstLocation = toolCall.locations?.[0];
      if (firstLocation) {
        itemSummary.appendChild(createLocationButton(firstLocation));
      }

      const statusEl = document.createElement("span");
      statusEl.className = "tool-call-status";
      statusEl.textContent = status;
      itemSummary.appendChild(statusEl);

      item.appendChild(itemSummary);

      const detail = document.createElement("div");
      detail.className = "tool-call-detail";

      const sections = [];
      if (toolCall.rawInput != null) {
        sections.push({ label: uiStrings.toolInput || "Input", value: formatJson(toolCall.rawInput) });
      }
      if (toolCall.rawOutput != null) {
        sections.push({ label: uiStrings.toolOutput || "Output", value: formatJson(toolCall.rawOutput) });
      }
      const contentText = renderToolCallContent(toolCall.content);
      if (contentText) {
        sections.push({ label: uiStrings.toolContent || "Content", value: contentText });
      }

      if (!sections.length && !toolCall.locations?.length) {
        const empty = document.createElement("div");
        empty.className = "tool-call-empty";
        empty.textContent = uiStrings.noDetailsYet || "No details yet.";
        detail.appendChild(empty);
      } else {
        for (const section of sections) {
          const block = document.createElement("div");
          block.className = "tool-call-section";

          const label = document.createElement("div");
          label.className = "tool-call-section-label";
          label.textContent = section.label;

          const body = document.createElement("pre");
          body.className = "tool-call-section-body";
          body.textContent = section.value;

          block.append(label, body);
          detail.appendChild(block);
        }

        if (toolCall.locations?.length) {
          const block = document.createElement("div");
          block.className = "tool-call-section";

          const label = document.createElement("div");
          label.className = "tool-call-section-label";
          label.textContent = uiStrings.toolLocations || "Locations";

          const locsList = document.createElement("div");
          locsList.className = "tool-call-locations-list";
          for (const loc of toolCall.locations) {
            locsList.appendChild(createLocationButton(loc));
          }

          block.append(label, locsList);
          detail.appendChild(block);
        }
      }

      item.appendChild(detail);
      item.open = itemOpenState.get(toolCall.toolCallId) ?? false;
      list.appendChild(item);
    }

    group.appendChild(list);
  }

  function findMessageRow(id) {
    return messagesInner.querySelector(`.turn-row[data-id="${CSS.escape(id)}"]`);
  }

  function createMessageRow(message) {
    const row = document.createElement("div");
    row.className = `turn-row ${turnRowClass(message.role)}`;
    row.dataset.id = message.id;

    const card = document.createElement("div");
    card.className = `turn-card ${message.role}`;
    card.innerHTML = '<div class="message-images"></div><div class="text"></div>';
    row.appendChild(card);
    return row;
  }

  function setStreamingState(row, active) {
    const card = getTurnCard(row);
    card?.classList.toggle("streaming", active);
  }

  function isNearBottom() {
    const distance = messagesEl.scrollHeight - messagesEl.scrollTop - messagesEl.clientHeight;
    return distance < 80;
  }

  function updateScrollBottomButton() {
    if (!scrollBottomBtn) {
      return;
    }
    const show = !autoScrollEnabled && messagesEl.scrollHeight > messagesEl.clientHeight + 40;
    scrollBottomBtn.hidden = !show;
  }

  function scrollToBottom(force = false) {
    if (force) {
      autoScrollEnabled = true;
    }
    if (autoScrollEnabled) {
      messagesEl.scrollTop = messagesEl.scrollHeight;
    }
    updateScrollBottomButton();
  }

  function appendMessage(message) {
    if (message.role === "tool") {
      return null;
    }

    const row = createMessageRow(message);
    const card = getTurnCard(row);
    renderTurnHeader(card, message);
    renderMessageImages(card, message.images);
    setMessageText(card, message);
    if (message.role === "assistant") {
      renderThinking(card, message.thinking, false);
      renderToolCalls(card, message.toolCalls);
    }
    messagesInner.appendChild(row);
    renderEmptyState();
    scrollToBottom(message.role === "user");
    return row;
  }

  function updateMessage(message, options = {}) {
    if (message.role === "tool") {
      return null;
    }

    let row = findMessageRow(message.id);
    if (!row) {
      row = appendMessage(message);
    }
    if (!row) {
      return null;
    }

    const card = getTurnCard(row);
    renderTurnHeader(card, message);
    renderMessageImages(card, message.images);
    setMessageText(card, message);
    if (message.role === "assistant") {
      const streaming = Boolean(options.streaming);
      renderThinking(card, message.thinking, streaming);
      renderToolCalls(card, message.toolCalls);
    }
    if (options.streaming != null) {
      setStreamingState(row, options.streaming);
    }
    scrollToBottom(false);
    return row;
  }

  function ensureStreamingRow(id) {
    if (streamingRow && streamingMessageId === id) {
      return getTurnCard(streamingRow);
    }

    const existing = findMessageRow(id);
    if (existing) {
      streamingRow = existing;
      streamingMessageId = id;
      setStreamingState(streamingRow, true);
      return getTurnCard(streamingRow);
    }

    streamingRow = appendMessage({ id, role: "assistant", text: "", thinking: "", toolCalls: [] });
    streamingMessageId = id;
    setStreamingState(streamingRow, true);
    return getTurnCard(streamingRow);
  }

  function clearStreamingRow() {
    if (streamingRow) {
      setStreamingState(streamingRow, false);
    }
    streamingRow = null;
    streamingMessageId = null;
  }

  function flushPendingDelta() {
    if (rafId != null) {
      cancelAnimationFrame(rafId);
      rafId = null;
    }
    if (!pendingDelta) {
      return;
    }
    const delta = pendingDelta;
    pendingDelta = null;
    const card = ensureStreamingRow(delta.id);
    const streaming = delta.streaming !== false;
    setMessageText(card, { role: "assistant", text: delta.text, thinking: delta.thinking, toolCalls: delta.toolCalls });
    renderThinking(card, delta.thinking, streaming);
    renderToolCalls(card, delta.toolCalls);
    if (streamingRow) {
      setStreamingState(streamingRow, streaming);
    }
    scrollToBottom(false);
  }

  function scheduleDelta(delta) {
    pendingDelta = delta;
    if (rafId != null) {
      return;
    }
    rafId = requestAnimationFrame(() => {
      rafId = null;
      flushPendingDelta();
    });
  }

  function appendSystemMessage(text, className = "", options = {}) {
    const row = document.createElement("div");
    row.className = "turn-row system";

    const card = document.createElement("div");
    card.className = `turn-card system${className ? ` ${className}` : ""}`;

    const textEl = document.createElement("span");
    textEl.className = "text";
    textEl.textContent = text;
    card.appendChild(textEl);

    if (options.showReconnect) {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "system-action-btn";
      btn.textContent = uiStrings.reconnect || "Reconnect";
      btn.addEventListener("click", () => vscode.postMessage({ type: "reconnect" }));
      card.appendChild(btn);
    }

    row.appendChild(card);
    messagesInner.appendChild(row);
    renderEmptyState();
    scrollToBottom(false);
  }

  function getConfigOptionsFromInit(init) {
    if (Array.isArray(init?.configOptions) && init.configOptions.length) {
      return init.configOptions;
    }
    const modes = init?.modes ?? [];
    if (modes.length) {
      return [
        {
          id: "mode",
          name: "Mode",
          category: "mode",
          type: "select",
          currentValue: init.modeId || modes[0].id,
          options: modes.map((m) => ({ value: m.id, name: m.name || m.id })),
          source: "mode"
        }
      ];
    }
    return [];
  }

  function renderConfigControls(init) {
    if (!configControlsEl) {
      return;
    }
    configControlsEl.replaceChildren();
    const options = getConfigOptionsFromInit(init);
    const busy = Boolean(init?.isRunning || init?.isConnecting);

    for (const opt of options) {
      if (opt.type === "boolean") {
        const btn = document.createElement("button");
        btn.type = "button";
        btn.className = "config-toggle";
        btn.setAttribute("aria-pressed", String(Boolean(opt.currentValue)));
        btn.textContent = opt.name;
        btn.title = opt.description ? `${opt.name}: ${opt.description}` : opt.name;
        btn.disabled = busy;
        btn.addEventListener("click", () => {
          vscode.postMessage({
            type: "setConfigOption",
            configId: opt.id,
            value: !opt.currentValue,
            valueType: "boolean",
            source: opt.source || "configOption"
          });
        });
        configControlsEl.appendChild(btn);
        continue;
      }

      if (opt.type === "select" && Array.isArray(opt.options) && opt.options.length) {
        const select = document.createElement("select");
        select.className = "config-select";
        select.setAttribute("aria-label", opt.name);
        select.title = opt.description ? `${opt.name}: ${opt.description}` : opt.name;
        select.disabled = busy;

        if (Array.isArray(opt.groups) && opt.groups.length) {
          for (const group of opt.groups) {
            const optGroup = document.createElement("optgroup");
            optGroup.label = group.name || group.group;
            for (const choice of group.options) {
              const optionEl = document.createElement("option");
              optionEl.value = choice.value;
              optionEl.textContent = choice.name || choice.value;
              optionEl.selected = choice.value === opt.currentValue;
              optGroup.appendChild(optionEl);
            }
            select.appendChild(optGroup);
          }
        } else {
          for (const choice of opt.options) {
            const optionEl = document.createElement("option");
            optionEl.value = choice.value;
            optionEl.textContent = choice.name || choice.value;
            optionEl.selected = choice.value === opt.currentValue;
            select.appendChild(optionEl);
          }
        }

        select.addEventListener("change", () => {
          vscode.postMessage({
            type: "setConfigOption",
            configId: opt.id,
            value: select.value,
            valueType: "select",
            source: opt.source || "configOption"
          });
        });
        configControlsEl.appendChild(select);
      }
    }
  }

  function resizeInput() {
    input.style.height = "auto";
    input.style.height = `${Math.min(input.scrollHeight, 180)}px`;
  }

  function updateComposerChrome(init) {
    imageUploadEnabled = Boolean(init?.imageUpload);
    if (attachBtn) {
      attachBtn.hidden = !imageUploadEnabled;
    }
    if (slashTriggerBtn) {
      slashTriggerBtn.hidden = availableCommands.length === 0;
    }
    if (input) {
      input.placeholder = imageUploadEnabled
        ? uiStrings.inputPlaceholderWithImages || "Message the agent… (paste or drop images)"
        : uiStrings.inputPlaceholder || "Message the agent…";
    }
  }

  function updateSendStopButton() {
    if (!sendStopBtn) {
      return;
    }
    const isRunning = Boolean(lastInit?.isRunning);
    const isConnecting = Boolean(lastInit?.isConnecting);
    const hasContent = Boolean(input.value.trim() || pendingImages.length);

    sendStopBtn.classList.toggle("is-stop", isRunning);
    if (isRunning) {
      const stopLabel = uiStrings.stop || "Stop";
      sendStopBtn.disabled = false;
      sendStopBtn.title = stopLabel;
      sendStopBtn.setAttribute("aria-label", stopLabel);
    } else {
      const sendLabel = uiStrings.send || "Send";
      sendStopBtn.disabled = isConnecting || !hasContent;
      sendStopBtn.title = sendLabel;
      sendStopBtn.setAttribute("aria-label", sendLabel);
    }
  }

  function setComposerState(status) {
    const merged = { ...(lastInit || {}), ...status };
    lastInit = merged;
    const busy = Boolean(merged.isRunning || merged.isConnecting);
    if (reconnectBtn) {
      reconnectBtn.disabled = Boolean(merged.isRunning);
    }
    if (attachBtn) {
      attachBtn.disabled = busy || !imageUploadEnabled;
    }
    if (configControlsEl) {
      for (const el of configControlsEl.querySelectorAll("select, button")) {
        el.disabled = busy;
      }
    }
    updateStatusBadge(merged);
    updateSendStopButton();
    if (!merged.isRunning) {
      flushPendingDelta();
      clearStreamingRow();
    }
  }

  function saveDraft() {
    if (!lastInit?.chatId) {
      return;
    }
    clearTimeout(draftSaveTimer);
    draftSaveTimer = setTimeout(() => {
      vscode.setState({ chatId: lastInit.chatId, draft: input.value });
    }, 150);
  }

  function restoreDraftIfMatching(chatId) {
    if (draftRestored || !chatId) {
      return;
    }
    draftRestored = true;
    const saved = vscode.getState();
    if (saved && saved.chatId === chatId && typeof saved.draft === "string" && !input.value) {
      input.value = saved.draft;
      resizeInput();
      updateSendStopButton();
    }
  }

  function renderSlashMenu() {
    if (!slashMenuEl) {
      return;
    }
    if (!slashMenuOpen || !filteredCommands.length) {
      slashMenuEl.hidden = true;
      slashMenuEl.replaceChildren();
      return;
    }

    slashMenuEl.hidden = false;
    slashMenuEl.replaceChildren();

    filteredCommands.forEach((cmd, index) => {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = `slash-item${index === slashActiveIndex ? " active" : ""}`;
      btn.setAttribute("role", "option");
      btn.setAttribute("aria-selected", String(index === slashActiveIndex));

      const nameEl = document.createElement("span");
      nameEl.className = "slash-item-name";
      nameEl.textContent = `/${cmd.name}`;

      const descEl = document.createElement("span");
      descEl.className = "slash-item-desc";
      descEl.textContent = cmd.description || cmd.inputHint || "";

      btn.append(nameEl, descEl);
      btn.addEventListener("mousedown", (event) => {
        event.preventDefault();
        applySlashCommand(cmd);
      });
      slashMenuEl.appendChild(btn);
    });
  }

  function updateSlashAutocomplete() {
    if (!availableCommands.length) {
      slashMenuOpen = false;
      renderSlashMenu();
      return;
    }
    const match = input.value.match(/^\/([^\s]*)$/);
    if (!match) {
      slashMenuOpen = false;
      renderSlashMenu();
      return;
    }
    const query = match[1].toLowerCase();
    filteredCommands = availableCommands.filter(
      (cmd) =>
        cmd.name.toLowerCase().includes(query) ||
        (cmd.description && cmd.description.toLowerCase().includes(query))
    );
    slashActiveIndex = 0;
    slashMenuOpen = filteredCommands.length > 0;
    renderSlashMenu();
  }

  function applySlashCommand(cmd) {
    input.value = `/${cmd.name} `;
    slashMenuOpen = false;
    renderSlashMenu();
    resizeInput();
    updateSendStopButton();
    saveDraft();
    input.focus();
  }

  function openLightbox(src, alt) {
    if (!lightboxEl || !lightboxImg || !src) {
      return;
    }
    lightboxImg.src = src;
    lightboxImg.alt = alt || "";
    lightboxEl.hidden = false;
  }

  function closeLightbox() {
    if (!lightboxEl || lightboxEl.hidden) {
      return;
    }
    lightboxEl.hidden = true;
    if (lightboxImg) {
      lightboxImg.src = "";
    }
  }

  function renderPendingImages() {
    if (!pendingImagesEl) {
      return;
    }

    pendingImagesEl.replaceChildren();
    if (!pendingImages.length) {
      pendingImagesEl.hidden = true;
      updateSendStopButton();
      return;
    }

    pendingImagesEl.hidden = false;
    for (const image of pendingImages) {
      const item = document.createElement("div");
      item.className = "pending-image";
      item.dataset.id = image.id;

      const thumb = document.createElement("img");
      thumb.src = image.previewUrl;
      thumb.alt = image.fileName;

      const remove = document.createElement("button");
      remove.type = "button";
      remove.className = "pending-image-remove";
      remove.title = uiStrings.removeImage || "Remove image";
      remove.textContent = "×";
      remove.addEventListener("click", () => {
        pendingImages = pendingImages.filter((entry) => entry.id !== image.id);
        renderPendingImages();
      });

      item.append(thumb, remove);
      pendingImagesEl.appendChild(item);
    }
    updateSendStopButton();
  }

  function readFileAsDataUrl(file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result);
      reader.onerror = () => reject(reader.error ?? new Error("Failed to read image."));
      reader.readAsDataURL(file);
    });
  }

  function dataUrlToBase64(dataUrl) {
    const comma = dataUrl.indexOf(",");
    return comma >= 0 ? dataUrl.slice(comma + 1) : dataUrl;
  }

  function showImageError(message) {
    appendSystemMessage(message, "error");
  }

  async function stageImageFile(file) {
    if (!imageUploadEnabled) {
      showImageError(uiStrings.imageUnsupportedAgent || "This agent does not support image uploads.");
      return;
    }
    if (!file || !ALLOWED_MIME_TYPES.has(file.type)) {
      showImageError(
        uiStrings.imageUnsupportedType || "Unsupported image type. Use PNG, JPEG, WebP, or GIF."
      );
      return;
    }
    if (file.size > MAX_IMAGE_BYTES) {
      showImageError(
        formatUi(uiStrings.imageTooLarge || "\"{0}\" exceeds the 5 MB limit.", file.name)
      );
      return;
    }
    if (pendingImages.length >= MAX_IMAGES) {
      showImageError(
        formatUi(uiStrings.imageTooMany || "At most {0} images per message.", MAX_IMAGES)
      );
      return;
    }

    const dataUrl = await readFileAsDataUrl(file);
    pendingImages.push({
      id: newId(),
      mimeType: file.type,
      fileName: file.name,
      data: dataUrlToBase64(dataUrl),
      previewUrl: dataUrl
    });
    renderPendingImages();
  }

  async function stageFiles(files) {
    for (const file of files) {
      try {
        await stageImageFile(file);
      } catch (error) {
        showImageError(error instanceof Error ? error.message : String(error));
      }
    }
  }

  messagesEl.addEventListener("scroll", () => {
    autoScrollEnabled = isNearBottom();
    updateScrollBottomButton();
  });

  scrollBottomBtn?.addEventListener("click", () => {
    scrollToBottom(true);
  });

  messagesInner.addEventListener("click", (event) => {
    const link = event.target.closest("a[href]");
    if (!link) {
      return;
    }
    event.preventDefault();
    vscode.postMessage({ type: "openLink", href: link.getAttribute("href") });
  });

  lightboxEl?.addEventListener("click", closeLightbox);

  window.addEventListener("message", (event) => {
    const message = event.data;
    switch (message.type) {
      case "init":
        if (message.init?.uiStrings) {
          uiStrings = message.init.uiStrings;
        }
        if (Array.isArray(message.init?.commands)) {
          availableCommands = message.init.commands;
        }
        if (message.init?.chatId) {
          restoreDraftIfMatching(message.init.chatId);
          vscode.setState({ chatId: message.init.chatId, draft: input.value });
        }
        renderHeader(message.init);
        renderConfigControls(message.init);
        applyStaticUi();
        setComposerState(message.init);
        break;
      case "history":
        pendingDelta = null;
        if (rafId != null) {
          cancelAnimationFrame(rafId);
          rafId = null;
        }
        messagesInner.replaceChildren();
        clearStreamingRow();
        for (const entry of message.messages) {
          appendMessage(entry);
        }
        renderEmptyState();
        scrollToBottom(true);
        break;
      case "message":
        appendMessage(message.message);
        break;
      case "messageUpdate":
        updateMessage(message.message);
        break;
      case "assistantDelta":
        scheduleDelta(message);
        break;
      case "assistantDone":
        pendingDelta = null;
        if (rafId != null) {
          cancelAnimationFrame(rafId);
          rafId = null;
        }
        updateMessage(message.message, { streaming: false });
        clearStreamingRow();
        break;
      case "commands":
        availableCommands = Array.isArray(message.commands) ? message.commands : [];
        updateComposerChrome(lastInit);
        renderEmptyState();
        break;
      case "usage":
        if (lastInit) {
          lastInit.usage = message.usage;
        }
        renderUsage(message.usage);
        break;
      case "status":
        setComposerState(message);
        break;
      case "error":
        pendingDelta = null;
        if (rafId != null) {
          cancelAnimationFrame(rafId);
          rafId = null;
        }
        clearStreamingRow();
        appendSystemMessage(message.message, "error", { showReconnect: true });
        break;
    }
  });

  function sendCurrentMessage() {
    if (lastInit?.isRunning || lastInit?.isConnecting) {
      return;
    }
    const text = input.value.trim();
    if (!text && !pendingImages.length) {
      return;
    }
    vscode.postMessage({
      type: "send",
      text,
      images: pendingImages.map(({ mimeType, fileName, data }) => ({ mimeType, fileName, data }))
    });
    input.value = "";
    pendingImages = [];
    slashMenuOpen = false;
    renderSlashMenu();
    renderPendingImages();
    resizeInput();
    updateSendStopButton();
    if (lastInit?.chatId) {
      vscode.setState({ chatId: lastInit.chatId, draft: "" });
    }
  }

  sendStopBtn?.addEventListener("click", () => {
    if (lastInit?.isRunning) {
      vscode.postMessage({ type: "stop" });
    } else {
      sendCurrentMessage();
    }
  });

  attachBtn?.addEventListener("click", () => {
    fileInput?.click();
  });

  slashTriggerBtn?.addEventListener("click", () => {
    if (!availableCommands.length) {
      return;
    }
    if (!input.value.startsWith("/")) {
      input.value = `/${input.value}`;
    }
    updateSlashAutocomplete();
    if (!slashMenuOpen) {
      filteredCommands = [...availableCommands];
      slashActiveIndex = 0;
      slashMenuOpen = filteredCommands.length > 0;
      renderSlashMenu();
    }
    resizeInput();
    updateSendStopButton();
    input.focus();
  });

  fileInput?.addEventListener("change", async () => {
    const files = [...(fileInput.files ?? [])];
    fileInput.value = "";
    await stageFiles(files);
  });

  reconnectBtn.addEventListener("click", () => {
    vscode.postMessage({ type: "reconnect" });
  });

  input.addEventListener("input", () => {
    resizeInput();
    updateSendStopButton();
    updateSlashAutocomplete();
    saveDraft();
  });

  input.addEventListener("keydown", (event) => {
    if (event.isComposing || event.keyCode === 229) {
      return;
    }

    if (slashMenuOpen && filteredCommands.length) {
      if (event.key === "ArrowDown") {
        event.preventDefault();
        slashActiveIndex = (slashActiveIndex + 1) % filteredCommands.length;
        renderSlashMenu();
        return;
      }
      if (event.key === "ArrowUp") {
        event.preventDefault();
        slashActiveIndex = (slashActiveIndex - 1 + filteredCommands.length) % filteredCommands.length;
        renderSlashMenu();
        return;
      }
      if (event.key === "Tab" || (event.key === "Enter" && !event.shiftKey)) {
        event.preventDefault();
        applySlashCommand(filteredCommands[slashActiveIndex]);
        return;
      }
      if (event.key === "Escape") {
        event.preventDefault();
        slashMenuOpen = false;
        renderSlashMenu();
        return;
      }
    }

    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      sendCurrentMessage();
    }
  });

  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape") {
      if (lightboxEl && !lightboxEl.hidden) {
        closeLightbox();
      } else if (slashMenuOpen) {
        slashMenuOpen = false;
        renderSlashMenu();
      }
    }
  });

  document.addEventListener("paste", async (event) => {
    if (!imageUploadEnabled) {
      return;
    }
    const items = [...(event.clipboardData?.items ?? [])];
    const imageItems = items.filter((item) => item.type.startsWith("image/"));
    if (!imageItems.length) {
      return;
    }
    event.preventDefault();
    const files = imageItems.map((item) => item.getAsFile()).filter(Boolean);
    await stageFiles(files);
  });

  function hasImageFiles(dataTransfer) {
    if (!dataTransfer) {
      return false;
    }
    if (dataTransfer.items && dataTransfer.items.length) {
      return [...dataTransfer.items].some((item) => item.kind === "file");
    }
    return Boolean(dataTransfer.files && dataTransfer.files.length);
  }

  document.addEventListener("dragenter", (event) => {
    if (!imageUploadEnabled || !hasImageFiles(event.dataTransfer)) {
      return;
    }
    event.preventDefault();
    dragDepth += 1;
    composerCard?.classList.add("drop-target");
  });

  document.addEventListener("dragover", (event) => {
    if (!imageUploadEnabled || !hasImageFiles(event.dataTransfer)) {
      return;
    }
    event.preventDefault();
    if (event.dataTransfer) {
      event.dataTransfer.dropEffect = "copy";
    }
  });

  document.addEventListener("dragleave", () => {
    if (dragDepth > 0) {
      dragDepth -= 1;
    }
    if (dragDepth === 0) {
      composerCard?.classList.remove("drop-target");
    }
  });

  document.addEventListener("drop", async (event) => {
    if (!imageUploadEnabled || !hasImageFiles(event.dataTransfer)) {
      return;
    }
    event.preventDefault();
    dragDepth = 0;
    composerCard?.classList.remove("drop-target");
    const files = [...(event.dataTransfer?.files ?? [])].filter((file) =>
      file.type.startsWith("image/")
    );
    await stageFiles(files);
  });

  const themeObserver = new MutationObserver(() => {
    if (lastInit) {
      renderHeader(lastInit);
      renderEmptyState();
      messagesInner.querySelectorAll(".turn-row.incoming .turn-author-icon").forEach((img) => {
        const iconSrc = resolveAgentIcon(lastInit.agentIcon);
        if (iconSrc) {
          img.src = iconSrc;
        }
      });
    }
  });
  themeObserver.observe(document.body, { attributes: true, attributeFilter: ["class"] });

  resizeInput();
  updateSendStopButton();
  vscode.postMessage({ type: "ready" });
})();
