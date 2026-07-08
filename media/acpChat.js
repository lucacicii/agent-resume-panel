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
  const attachBtn = document.getElementById("attach");
  const fileInput = document.getElementById("file-input");
  const pendingImagesEl = document.getElementById("pending-images");

  const MAX_IMAGES = 4;
  const MAX_IMAGE_BYTES = 5 * 1024 * 1024;
  const ALLOWED_MIME_TYPES = new Set(["image/png", "image/jpeg", "image/webp", "image/gif"]);

  let streamingRow = null;
  let streamingMessageId = null;
  let lastInit = null;
  let uiStrings = {};
  let imageUploadEnabled = false;
  let pendingImages = [];

  function formatUi(template, ...args) {
    let text = template || "";
    args.forEach((arg, index) => {
      text = text.replaceAll(`{${index}}`, String(arg));
    });
    return text;
  }

  function applyStaticUi() {
    updateComposerChrome(lastInit);
  }

  if (typeof marked !== "undefined") {
    marked.setOptions({ breaks: true, gfm: true });
  }

  function newId() {
    return typeof crypto !== "undefined" && crypto.randomUUID
      ? crypto.randomUUID()
      : `img-${Date.now()}-${Math.random().toString(16).slice(2)}`;
  }

  function renderHeader(init) {
    if (!init) {
      return;
    }
    lastInit = init;
    if (init.uiStrings) {
      uiStrings = init.uiStrings;
    }
    headerTitle.textContent = init.title || uiStrings.defaultTitle || "ACP Chat";
    const parts = [init.provider, init.projectPath].filter(Boolean);
    if (init.modeId) {
      parts.push(init.modeId);
    }
    parts.push(statusLabel(init));
    headerMeta.textContent = parts.join(" · ");
    updateStatusDot(init);
  }

  function statusLabel(state) {
    if (state.isConnecting) {
      return uiStrings.statusConnecting || "connecting";
    }
    if (state.isRunning) {
      return uiStrings.statusRunning || "running";
    }
    if (state.status === "error") {
      return "error";
    }
    return uiStrings.statusReady || "ready";
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
    const text = message.text || "";
    const useMarkdown = message.role === "assistant" || message.role === "plan";
    const html = useMarkdown ? renderMarkdown(text) : null;

    if (!text) {
      textEl.innerHTML = "";
      textEl.classList.remove("markdown-body");
      textEl.hidden = Boolean(message.images?.length);
      return;
    }

    textEl.hidden = false;
    if (html != null) {
      textEl.innerHTML = html;
      textEl.classList.add("markdown-body");
    } else {
      textEl.textContent = text;
      textEl.classList.remove("markdown-body");
    }
  }

  function renderMessageImages(bubble, images) {
    let container = bubble.querySelector(".message-images");
    if (!images?.length) {
      container?.remove();
      return;
    }

    if (!container) {
      container = document.createElement("div");
      container.className = "message-images";
      const textEl = bubble.querySelector(".text");
      bubble.insertBefore(container, textEl);
    }

    container.replaceChildren();
    for (const image of images) {
      const img = document.createElement("img");
      img.className = "message-image";
      img.src = image.previewUrl;
      img.alt = image.fileName || "Attached image";
      img.loading = "lazy";
      container.appendChild(img);
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
    const doneSuffix =
      completed > 0
        ? formatUi(uiStrings.toolCallsDone || ", {0} done", completed)
        : "";
    summary.textContent = formatUi(
      uiStrings.toolCallsSummary || "Tool calls ({0}{1})",
      calls.length,
      doneSuffix
    );
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
    bubble.innerHTML = '<div class="message-images"></div><div class="text"></div>';
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
    renderMessageImages(bubble, message.images);
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
    renderMessageImages(bubble, message.images);
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

  function updateComposerChrome(init) {
    imageUploadEnabled = Boolean(init?.imageUpload);
    if (attachBtn) {
      attachBtn.hidden = !imageUploadEnabled;
    }
    if (input) {
      input.placeholder = imageUploadEnabled
        ? uiStrings.inputPlaceholderWithImages || "Message the agent… (paste or drop images)"
        : uiStrings.inputPlaceholder || "Message the agent…";
    }
  }

  function renderPendingImages() {
    if (!pendingImagesEl) {
      return;
    }

    pendingImagesEl.replaceChildren();
    if (!pendingImages.length) {
      pendingImagesEl.hidden = true;
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
      remove.title = "Remove image";
      remove.textContent = "×";
      remove.addEventListener("click", () => {
        pendingImages = pendingImages.filter((entry) => entry.id !== image.id);
        renderPendingImages();
      });

      item.append(thumb, remove);
      pendingImagesEl.appendChild(item);
    }
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
      showImageError("This agent does not support image uploads.");
      return;
    }
    if (!file || !ALLOWED_MIME_TYPES.has(file.type)) {
      showImageError("Unsupported image type. Use PNG, JPEG, WebP, or GIF.");
      return;
    }
    if (file.size > MAX_IMAGE_BYTES) {
      showImageError(`"${file.name}" exceeds the 5 MB limit.`);
      return;
    }
    if (pendingImages.length >= MAX_IMAGES) {
      showImageError(`At most ${MAX_IMAGES} images per message.`);
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

  function setComposerState(status) {
    const busy = Boolean(status.isRunning || status.isConnecting);
    stopBtn.disabled = !status.isRunning;
    sendBtn.disabled = busy;
    modeSelect.disabled = busy;
    reconnectBtn.disabled = status.isRunning;
    if (attachBtn) {
      attachBtn.disabled = busy || !imageUploadEnabled;
    }
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
        if (message.init?.uiStrings) {
          uiStrings = message.init.uiStrings;
        }
        renderHeader(message.init);
        renderModes(message.init);
        applyStaticUi();
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
    renderPendingImages();
    resizeInput();
  }

  sendBtn.addEventListener("click", sendCurrentMessage);

  attachBtn?.addEventListener("click", () => {
    fileInput?.click();
  });

  fileInput?.addEventListener("change", async () => {
    const files = [...(fileInput.files ?? [])];
    fileInput.value = "";
    for (const file of files) {
      try {
        await stageImageFile(file);
      } catch (error) {
        showImageError(error instanceof Error ? error.message : String(error));
      }
    }
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

  input.addEventListener("input", resizeInput);

  input.addEventListener("keydown", (event) => {
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      sendCurrentMessage();
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
    for (const item of imageItems) {
      const file = item.getAsFile();
      if (!file) {
        continue;
      }
      try {
        await stageImageFile(file);
      } catch (error) {
        showImageError(error instanceof Error ? error.message : String(error));
      }
    }
  });

  resizeInput();
  vscode.postMessage({ type: "ready" });
})();