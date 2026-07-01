(function () {
  const vscode = acquireVsCodeApi();
  const headerTitle = document.getElementById("header-title");
  const headerMeta = document.getElementById("header-meta");
  const statusDot = document.getElementById("status-dot");
  const messagesEl = document.getElementById("messages");
  const input = document.getElementById("input");
  const modeSelect = document.getElementById("mode");
  const sendBtn = document.getElementById("send");
  const stopBtn = document.getElementById("stop");
  const reconnectBtn = document.getElementById("reconnect");

  let streamingRow = null;
  let streamingMessageId = null;
  let lastInit = null;

  if (typeof marked !== "undefined") {
    marked.setOptions({ breaks: true, gfm: true });
  }

  function renderHeader(init) {
    if (!init) {
      return;
    }
    lastInit = init;
    headerTitle.textContent = init.title || "ACP Chat";
    const parts = [init.provider, init.projectPath].filter(Boolean);
    if (init.modeId) {
      parts.push(init.modeId);
    }
    headerMeta.textContent = parts.join(" · ");
    updateStatusDot(init);
  }

  function updateStatusDot(state) {
    if (!statusDot) {
      return;
    }
    statusDot.className = "status-dot";
    if (state.isConnecting) {
      statusDot.classList.add("connecting");
      return;
    }
    if (state.isRunning) {
      statusDot.classList.add("running");
      return;
    }
    if (state.status === "error") {
      statusDot.classList.add("error");
      return;
    }
    statusDot.classList.add("ready");
  }

  function bubbleRowClass(role) {
    if (role === "user") {
      return "outgoing";
    }
    if (role === "assistant") {
      return "incoming";
    }
    return "system";
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

  function getBubble(row) {
    return row?.querySelector(".bubble") ?? null;
  }

  function setMessageText(bubble, message) {
    if (!bubble) {
      return;
    }
    const textEl = bubble.querySelector(".text");
    const useMarkdown = message.role === "assistant" || message.role === "plan";
    const html = useMarkdown ? renderMarkdown(message.text) : null;

    if (html != null) {
      textEl.innerHTML = html;
      textEl.classList.add("markdown-body");
    } else {
      textEl.textContent = message.text;
      textEl.classList.remove("markdown-body");
    }
  }

  function renderToolCalls(bubble, toolCalls) {
    const calls = toolCalls ?? [];
    let group = bubble.querySelector(".tool-calls-group");

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
      const textEl = bubble.querySelector(".text");
      bubble.insertBefore(group, textEl);
    }

    const completed = calls.filter((entry) => entry.status === "completed" || entry.status === "failed").length;
    const summary = document.createElement("summary");
    summary.className = "tool-calls-summary";
    summary.textContent = `Tool calls (${calls.length}${completed ? `, ${completed} done` : ""})`;
    group.replaceChildren(summary);
    group.open = groupWasOpen;

    const list = document.createElement("div");
    list.className = "tool-calls-list";

    for (const toolCall of calls) {
      const item = document.createElement("details");
      item.className = `tool-call-item tool-status-${toolCall.status || "pending"}`;
      item.dataset.toolCallId = toolCall.toolCallId;

      const location = toolCall.locations?.[0];
      const locationHint = location
        ? ` · ${location.path}${location.line != null ? `:${location.line}` : ""}`
        : "";

      const itemSummary = document.createElement("summary");
      itemSummary.className = "tool-call-summary";
      itemSummary.innerHTML =
        `<span class="tool-call-title">${escapeHtml(toolCall.title || toolCall.kind || "Tool")}</span>` +
        `<span class="tool-call-meta">${escapeHtml(`${toolCall.kind || ""}${locationHint}`)}</span>` +
        `<span class="tool-call-status">${escapeHtml(toolCall.status || "pending")}</span>`;
      item.appendChild(itemSummary);

      const detail = document.createElement("div");
      detail.className = "tool-call-detail";

      const sections = [];
      if (toolCall.rawInput != null) {
        sections.push({ label: "Input", value: formatJson(toolCall.rawInput) });
      }
      if (toolCall.rawOutput != null) {
        sections.push({ label: "Output", value: formatJson(toolCall.rawOutput) });
      }
      const contentText = renderToolCallContent(toolCall.content);
      if (contentText) {
        sections.push({ label: "Content", value: contentText });
      }
      if (toolCall.locations?.length) {
        sections.push({
          label: "Locations",
          value: toolCall.locations
            .map((loc) => `${loc.path}${loc.line != null ? `:${loc.line}` : ""}`)
            .join("\n")
        });
      }

      if (!sections.length) {
        const empty = document.createElement("div");
        empty.className = "tool-call-empty";
        empty.textContent = "No details yet.";
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
      }

      item.appendChild(detail);
      item.open = itemOpenState.get(toolCall.toolCallId) ?? false;
      list.appendChild(item);
    }

    group.appendChild(list);
  }

  function findMessageRow(id) {
    return messagesEl.querySelector(`.bubble-row[data-id="${id}"]`);
  }

  function createMessageRow(message) {
    const row = document.createElement("div");
    row.className = `bubble-row ${bubbleRowClass(message.role)}`;
    row.dataset.id = message.id;

    const bubble = document.createElement("div");
    bubble.className = `bubble ${message.role}`;
    bubble.innerHTML = '<div class="text"></div>';
    row.appendChild(bubble);
    return row;
  }

  function setStreamingState(row, active) {
    const bubble = getBubble(row);
    bubble?.classList.toggle("streaming", active);
  }

  function scrollToBottom() {
    messagesEl.scrollTop = messagesEl.scrollHeight;
  }

  function appendMessage(message) {
    if (message.role === "tool") {
      return null;
    }

    const row = createMessageRow(message);
    const bubble = getBubble(row);
    setMessageText(bubble, message);
    if (message.role === "assistant") {
      renderToolCalls(bubble, message.toolCalls);
    }
    messagesEl.appendChild(row);
    scrollToBottom();
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

    const bubble = getBubble(row);
    setMessageText(bubble, message);
    if (message.role === "assistant") {
      renderToolCalls(bubble, message.toolCalls);
    }
    if (options.streaming != null) {
      setStreamingState(row, options.streaming);
    }
    scrollToBottom();
    return row;
  }

  function ensureStreamingRow(id) {
    if (streamingRow && streamingMessageId === id) {
      return getBubble(streamingRow);
    }

    const existing = findMessageRow(id);
    if (existing) {
      streamingRow = existing;
      streamingMessageId = id;
      setStreamingState(streamingRow, true);
      return getBubble(streamingRow);
    }

    streamingRow = appendMessage({ id, role: "assistant", text: "", toolCalls: [] });
    streamingMessageId = id;
    setStreamingState(streamingRow, true);
    return getBubble(streamingRow);
  }

  function clearStreamingRow() {
    if (streamingRow) {
      setStreamingState(streamingRow, false);
    }
    streamingRow = null;
    streamingMessageId = null;
  }

  function appendSystemMessage(text, className = "") {
    const row = document.createElement("div");
    row.className = "bubble-row system";

    const bubble = document.createElement("div");
    bubble.className = `bubble system${className ? ` ${className}` : ""}`;
    bubble.innerHTML = `<div class="text"></div>`;
    bubble.querySelector(".text").textContent = text;

    row.appendChild(bubble);
    messagesEl.appendChild(row);
    scrollToBottom();
  }

  function renderModes(init) {
    const modes = init.modes ?? [];
    modeSelect.innerHTML = "";
    if (!modes.length) {
      modeSelect.hidden = true;
      return;
    }

    modeSelect.hidden = false;
    for (const mode of modes) {
      const option = document.createElement("option");
      option.value = mode.id;
      option.textContent = mode.name || mode.id;
      option.selected = mode.id === init.modeId;
      modeSelect.appendChild(option);
    }
  }

  function resizeInput() {
    input.style.height = "auto";
    input.style.height = `${Math.min(input.scrollHeight, 160)}px`;
  }

  function setComposerState(status) {
    const busy = Boolean(status.isRunning || status.isConnecting);
    stopBtn.disabled = !status.isRunning;
    sendBtn.disabled = busy;
    modeSelect.disabled = busy;
    reconnectBtn.disabled = status.isRunning;
    updateStatusDot({ ...lastInit, ...status });
    if (!status.isRunning) {
      clearStreamingRow();
    }
  }

  messagesEl.addEventListener("click", (event) => {
    const link = event.target.closest("a[href]");
    if (!link) {
      return;
    }
    event.preventDefault();
    vscode.postMessage({ type: "openLink", href: link.getAttribute("href") });
  });

  window.addEventListener("message", (event) => {
    const message = event.data;
    switch (message.type) {
      case "init":
        renderHeader(message.init);
        renderModes(message.init);
        setComposerState(message.init);
        break;
      case "history":
        messagesEl.innerHTML = "";
        clearStreamingRow();
        for (const entry of message.messages) {
          appendMessage(entry);
        }
        break;
      case "message":
        appendMessage(message.message);
        break;
      case "messageUpdate":
        updateMessage(message.message);
        break;
      case "assistantDelta": {
        const bubble = ensureStreamingRow(message.id);
        setMessageText(bubble, { role: "assistant", text: message.text });
        renderToolCalls(bubble, message.toolCalls);
        if (streamingRow) {
          setStreamingState(streamingRow, message.streaming !== false);
        }
        scrollToBottom();
        break;
      }
      case "assistantDone":
        updateMessage(message.message, { streaming: false });
        clearStreamingRow();
        break;
      case "status":
        setComposerState(message);
        break;
      case "error": {
        clearStreamingRow();
        appendSystemMessage(message.message, "error");
        break;
      }
    }
  });

  function sendCurrentMessage() {
    const text = input.value.trim();
    if (!text) {
      return;
    }
    vscode.postMessage({ type: "send", text });
    input.value = "";
    resizeInput();
  }

  sendBtn.addEventListener("click", sendCurrentMessage);

  stopBtn.addEventListener("click", () => {
    vscode.postMessage({ type: "stop" });
  });

  reconnectBtn.addEventListener("click", () => {
    vscode.postMessage({ type: "reconnect" });
  });

  modeSelect.addEventListener("change", () => {
    vscode.postMessage({ type: "setMode", modeId: modeSelect.value });
  });

  input.addEventListener("input", resizeInput);

  input.addEventListener("keydown", (event) => {
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      sendCurrentMessage();
    }
  });

  resizeInput();
  vscode.postMessage({ type: "ready" });
})();