(function () {
  const vscode = acquireVsCodeApi();
  const header = document.getElementById("header");
  const messagesEl = document.getElementById("messages");
  const input = document.getElementById("input");
  const modelSelect = document.getElementById("model");
  const sendBtn = document.getElementById("send");
  const stopBtn = document.getElementById("stop");
  const handoffBtn = document.getElementById("handoff");

  let streamingNode = null;

  function renderHeader(init) {
    if (!init) {
      return;
    }
    const link = init.sessionId ? `linked ${init.sessionId}` : "awaiting handoff";
    header.textContent = `${init.title} · ${init.projectPath} · → ${init.provider} (${link}) · handoffs ${init.handoffCount}`;
  }

  function roleLabel(message) {
    if (message.source === "agent-summary") {
      return "Agent Summary";
    }
    return message.role;
  }

  function appendMessage(message) {
    const node = document.createElement("div");
    const sourceClass = message.source ? ` ${message.source}` : "";
    node.className = `message ${message.role}${sourceClass}`;
    node.dataset.id = message.id;
    node.innerHTML = `<div class="role">${roleLabel(message)}</div><div class="text"></div>`;
    node.querySelector(".text").textContent = message.text;
    messagesEl.appendChild(node);
    messagesEl.scrollTop = messagesEl.scrollHeight;
    return node;
  }

  function ensureStreamingNode(id) {
    if (streamingNode && streamingNode.dataset.id === id) {
      return streamingNode;
    }
    streamingNode = appendMessage({ id, role: "assistant", text: "" });
    return streamingNode;
  }

  function insertAtCursor(text) {
    const start = input.selectionStart ?? input.value.length;
    const end = input.selectionEnd ?? input.value.length;
    const before = input.value.slice(0, start);
    const after = input.value.slice(end);
    const spacer = before && !before.endsWith(" ") && !before.endsWith("\n") ? " " : "";
    input.value = `${before}${spacer}${text}${after ? ` ${after}` : ""}`;
    const cursor = (before + spacer + text).length;
    input.setSelectionRange(cursor, cursor);
    input.focus();
  }

  function parseDroppedUris(event) {
    const transfer = event.dataTransfer;
    if (!transfer) {
      return [];
    }

    const candidates = [
      transfer.getData("application/vnd.code.uri-list"),
      transfer.getData("text/uri-list"),
      transfer.getData("text/plain"),
      transfer.getData("resourceUrls")
    ];

    const uris = [];
    for (const raw of candidates) {
      if (!raw) {
        continue;
      }

      if (raw.trim().startsWith("[")) {
        try {
          const parsed = JSON.parse(raw);
          if (Array.isArray(parsed)) {
            uris.push(...parsed.map((entry) => String(entry)));
          }
        } catch {
          // Ignore malformed resource URL payloads.
        }
        continue;
      }

      uris.push(
        ...raw
          .split(/\r?\n/)
          .map((line) => line.trim())
          .filter(Boolean)
      );
    }

    return [...new Set(uris)];
  }

  function setupDropTarget(element) {
    element.addEventListener("dragover", (event) => {
      event.preventDefault();
      element.classList.add("drop-target");
    });

    element.addEventListener("dragleave", () => {
      element.classList.remove("drop-target");
    });

    element.addEventListener("drop", (event) => {
      event.preventDefault();
      element.classList.remove("drop-target");
      const uris = parseDroppedUris(event);
      if (!uris.length) {
        return;
      }
      vscode.postMessage({ type: "dropFiles", uris });
    });
  }

  window.addEventListener("message", (event) => {
    const message = event.data;
    switch (message.type) {
      case "init":
        renderHeader(message.init);
        if (handoffBtn) {
          handoffBtn.disabled = message.init.isRunning || message.init.isHandingOff;
        }
        modelSelect.innerHTML = "";
        for (const model of message.init.models) {
          const option = document.createElement("option");
          option.value = model;
          option.textContent = model;
          option.selected = model === message.init.model;
          modelSelect.appendChild(option);
        }
        break;
      case "history":
        messagesEl.innerHTML = "";
        for (const entry of message.messages) {
          appendMessage(entry);
        }
        break;
      case "message":
        appendMessage(message.message);
        break;
      case "assistantDelta":
        ensureStreamingNode(message.id).querySelector(".text").textContent = message.text;
        messagesEl.scrollTop = messagesEl.scrollHeight;
        break;
      case "assistantDone":
        streamingNode = null;
        break;
      case "insertText":
        insertAtCursor(message.text);
        break;
      case "status":
        stopBtn.disabled = !message.isRunning;
        sendBtn.disabled = message.isRunning;
        if (handoffBtn) {
          handoffBtn.disabled = message.isRunning || Boolean(message.isHandingOff);
        }
        break;
      case "error": {
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

  if (handoffBtn) {
    handoffBtn.addEventListener("click", () => {
      handoffBtn.disabled = true;
      vscode.postMessage({ type: "handoff" });
    });
  }

  modelSelect.addEventListener("change", () => {
    vscode.postMessage({ type: "setModel", model: modelSelect.value });
  });

  input.addEventListener("keydown", (event) => {
    if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
      event.preventDefault();
      sendBtn.click();
    }
  });

  setupDropTarget(input);
  setupDropTarget(document.getElementById("composer"));

  vscode.postMessage({ type: "ready" });
})();