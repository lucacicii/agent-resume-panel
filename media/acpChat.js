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
    const node = document.createElement("div");
    node.className = `message ${message.role}`;
    node.dataset.id = message.id;
    node.innerHTML = `<div class="role">${roleLabel(message.role)}</div><div class="text"></div>`;
    setMessageText(node, message);
    messagesEl.appendChild(node);
    messagesEl.scrollTop = messagesEl.scrollHeight;
    return node;
  }

  function updateMessage(message, options = {}) {
    const node = findMessageNode(message.id) ?? appendMessage(message);
    setMessageText(node, message);
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

    streamingNode = appendMessage({ id, role: "assistant", text: "" });
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