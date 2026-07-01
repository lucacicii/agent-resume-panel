(function () {
  const vscode = acquireVsCodeApi();
  const header = document.getElementById("header");
  const messagesEl = document.getElementById("messages");
  const input = document.getElementById("input");
  const modeSelect = document.getElementById("mode");
  const sendBtn = document.getElementById("send");
  const stopBtn = document.getElementById("stop");
  const reconnectBtn = document.getElementById("reconnect");

  let streamingNode = null;
  let streamingMessageId = null;

  if (typeof marked !== "undefined") {
    marked.setOptions({ breaks: true, gfm: true });
  }

  function renderHeader(init) {
    if (!init) {
      return;
    }
    const mode = init.modeId ? ` · mode ${init.modeId}` : "";
    const session = init.acpSessionId ? `session ${init.acpSessionId}` : "connecting";
    header.textContent = `${init.title} · ${init.projectPath} · ${init.provider}${mode} · ${session}`;
  }

  function roleLabel(role) {
    if (role === "plan") {
      return "Plan";
    }
    if (role === "tool") {
      return "Tool";
    }
    return role;
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

  function setMessageText(node, message) {
    const textEl = node.querySelector(".text");
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

  function renderToolCalls(node, toolCalls) {
    const calls = toolCalls ?? [];
    let group = node.querySelector(".tool-calls-group");

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
      const textEl = node.querySelector(".text");
      node.insertBefore(group, textEl);
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

  function findMessageNode(id) {
    return messagesEl.querySelector(`.message[data-id="${id}"]`);
  }

  function setStreamingState(node, active) {
    if (!node) {
      return;
    }
    node.classList.toggle("streaming", active);
  }

  function appendMessage(message) {
    if (message.role === "tool") {
      return null;
    }

    const node = document.createElement("div");
    node.className = `message ${message.role}`;
    node.dataset.id = message.id;
    node.innerHTML = `<div class="role">${roleLabel(message.role)}</div><div class="text"></div>`;
    setMessageText(node, message);
    if (message.role === "assistant") {
      renderToolCalls(node, message.toolCalls);
    }
    messagesEl.appendChild(node);
    messagesEl.scrollTop = messagesEl.scrollHeight;
    return node;
  }

  function updateMessage(message, options = {}) {
    if (message.role === "tool") {
      return null;
    }

    const node = findMessageNode(message.id) ?? appendMessage(message);
    if (!node) {
      return null;
    }

    setMessageText(node, message);
    if (message.role === "assistant") {
      renderToolCalls(node, message.toolCalls);
    }
    if (options.streaming != null) {
      setStreamingState(node, options.streaming);
    }
    messagesEl.scrollTop = messagesEl.scrollHeight;
    return node;
  }

  function ensureStreamingNode(id) {
    if (streamingNode && streamingMessageId === id) {
      return streamingNode;
    }

    const existing = findMessageNode(id);
    if (existing) {
      streamingNode = existing;
      streamingMessageId = id;
      setStreamingState(streamingNode, true);
      return streamingNode;
    }

    streamingNode = appendMessage({ id, role: "assistant", text: "", toolCalls: [] });
    streamingMessageId = id;
    setStreamingState(streamingNode, true);
    return streamingNode;
  }

  function clearStreamingNode() {
    if (streamingNode) {
      setStreamingState(streamingNode, false);
    }
    streamingNode = null;
    streamingMessageId = null;
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

  function setComposerState(status) {
    const busy = Boolean(status.isRunning || status.isConnecting);
    stopBtn.disabled = !status.isRunning;
    sendBtn.disabled = busy;
    modeSelect.disabled = busy;
    reconnectBtn.disabled = status.isRunning;
    if (!status.isRunning) {
      clearStreamingNode();
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
        clearStreamingNode();
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
        const node = ensureStreamingNode(message.id);
        setMessageText(node, { role: "assistant", text: message.text });
        renderToolCalls(node, message.toolCalls);
        setStreamingState(node, message.streaming !== false);
        messagesEl.scrollTop = messagesEl.scrollHeight;
        break;
      }
      case "assistantDone":
        updateMessage(message.message, { streaming: false });
        clearStreamingNode();
        break;
      case "status":
        setComposerState(message);
        break;
      case "error": {
        clearStreamingNode();
        const node = document.createElement("div");
        node.className = "error";
        node.textContent = message.message;
        messagesEl.appendChild(node);
        break;
      }
    }
  });

  sendBtn.addEventListener("click", () => {
    const text = input.value.trim();
    if (!text) {
      return;
    }
    vscode.postMessage({ type: "send", text });
    input.value = "";
  });

  stopBtn.addEventListener("click", () => {
    vscode.postMessage({ type: "stop" });
  });

  reconnectBtn.addEventListener("click", () => {
    vscode.postMessage({ type: "reconnect" });
  });

  modeSelect.addEventListener("change", () => {
    vscode.postMessage({ type: "setMode", modeId: modeSelect.value });
  });

  input.addEventListener("keydown", (event) => {
    if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
      event.preventDefault();
      sendBtn.click();
    }
  });

  vscode.postMessage({ type: "ready" });
})();