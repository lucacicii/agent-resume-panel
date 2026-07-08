(function () {
  const vscode = acquireVsCodeApi();

  let uiStrings = {};

  const previewTitle = document.getElementById("preview-title");
  const previewNotice = document.getElementById("preview-notice");
  const previewSummary = document.getElementById("preview-summary");
  const previewMessages = document.getElementById("preview-messages");
  const previewResume = document.getElementById("preview-resume");
  const previewResumeWith = document.getElementById("preview-resume-with");
  const previewSummarize = document.getElementById("preview-summarize");
  const previewAutoRename = document.getElementById("preview-auto-rename");
  const previewHandoff = document.getElementById("preview-handoff");
  const previewRename = document.getElementById("preview-rename");
  const previewClose = document.getElementById("preview-close");

  function applyStaticUi() {
    if (previewResume) {
      previewResume.textContent = uiStrings.buttonResume || "Resume";
      previewResume.setAttribute("aria-label", uiStrings.ariaResume || "Resume session");
    }
    if (previewResumeWith) {
      previewResumeWith.textContent = uiStrings.buttonResumeWith || "Resume with…";
      previewResumeWith.setAttribute("aria-label", uiStrings.ariaResumeWith || "Resume session with");
    }
    if (previewSummarize) {
      previewSummarize.textContent = uiStrings.buttonSummarize || "Summarize";
      previewSummarize.setAttribute("aria-label", uiStrings.ariaSummarize || "Summarize session");
    }
    if (previewAutoRename) {
      previewAutoRename.textContent = uiStrings.buttonAutoRename || "Auto Rename";
      previewAutoRename.setAttribute("aria-label", uiStrings.ariaAutoRename || "Auto rename session");
    }
    if (previewHandoff) {
      previewHandoff.textContent = uiStrings.buttonHandoff || "Hand Off to…";
      previewHandoff.setAttribute("aria-label", uiStrings.ariaHandoff || "Hand off to another agent");
    }
    if (previewRename) {
      previewRename.textContent = uiStrings.buttonRename || "Rename";
      previewRename.setAttribute("aria-label", uiStrings.ariaRename || "Rename session");
    }
    if (previewClose) {
      previewClose.textContent = uiStrings.buttonClose || "Close";
      previewClose.setAttribute("aria-label", uiStrings.ariaClose || "Close preview");
    }
    const loadingEl = document.querySelector(".preview-loading");
    if (loadingEl) {
      loadingEl.textContent = uiStrings.loadingConversation || loadingEl.textContent;
    }
    if (previewTitle && previewTitle.textContent.trim() === "Loading preview...") {
      previewTitle.textContent = uiStrings.loadingTitle || previewTitle.textContent;
    }
  }

  previewResume.addEventListener("click", () => {
    vscode.postMessage({ type: "resume" });
  });

  previewResumeWith.addEventListener("click", () => {
    vscode.postMessage({ type: "resumeWith" });
  });

  previewSummarize.addEventListener("click", () => {
    postLlmAction("summarize");
  });

  previewAutoRename.addEventListener("click", () => {
    postLlmAction("autoRename");
  });

  previewHandoff.addEventListener("click", () => {
    postLlmAction("continueWithAgent");
  });

  previewRename.addEventListener("click", () => {
    previewRename.disabled = true;
    vscode.postMessage({ type: "rename" });
  });

  previewClose.addEventListener("click", () => {
    vscode.postMessage({ type: "close" });
  });

  window.addEventListener("message", (event) => {
    const message = event.data;
    if (message.type === "init") {
      uiStrings = message.uiStrings || {};
      applyStaticUi();
      renderPreview(message);
      return;
    }

    if (message.type === "error") {
      previewTitle.textContent = uiStrings.failedTitle || "Preview failed";
      previewNotice.classList.add("hidden");
      previewSummary.classList.add("hidden");
      previewMessages.innerHTML = "";
      const error = document.createElement("div");
      error.className = "preview-error";
      error.textContent = message.error || uiStrings.failedLoad || "Failed to load session preview.";
      previewMessages.appendChild(error);
      setAiButtonsDisabled(false);
      previewRename.disabled = false;
      return;
    }

    if (message.type === "titleUpdated") {
      previewTitle.textContent = message.title || uiStrings.defaultTitle || "Session Preview";
      previewRename.disabled = false;
      setAiButtonsDisabled(false);
      return;
    }

    if (message.type === "renameDone") {
      previewRename.disabled = false;
      return;
    }

    if (message.type === "summaryLoading") {
      renderSummary(uiStrings.summarizing || "Summarizing session...");
      return;
    }

    if (message.type === "summaryResult") {
      renderSummary(message.summary || "");
      setAiButtonsDisabled(false);
      return;
    }

    if (message.type === "summaryError") {
      renderSummary(message.error || uiStrings.summarizeFailed || "Summarize failed.", true);
      setAiButtonsDisabled(false);
      return;
    }

    if (message.type === "autoRenameLoading") {
      return;
    }

    if (message.type === "autoRenameDone") {
      setAiButtonsDisabled(false);
    }

    if (message.type === "handoffLoading") {
      return;
    }

    if (message.type === "handoffDone" || message.type === "handoffError") {
      setAiButtonsDisabled(false);
    }
  });

  function renderPreview(message) {
    previewTitle.textContent = message.title || uiStrings.defaultTitle || "Session Preview";
    previewMessages.innerHTML = "";
    applyResumeActions(message.showResumeWith !== false);
    applyLlmActions(message.llmConfigured === true, message.showHandoff === true);
    renderNotices(message);

    if (message.cachedSummary) {
      renderSummary(message.cachedSummary);
    } else {
      previewSummary.classList.add("hidden");
      previewSummary.textContent = "";
    }

    for (const entry of message.messages || []) {
      const block = document.createElement("div");
      block.className = `preview-message ${entry.role}`;

      const role = document.createElement("div");
      role.className = "preview-role";
      role.textContent =
        entry.role === "assistant"
          ? uiStrings.roleAssistant || "Assistant"
          : uiStrings.roleUser || "User";

      const text = document.createElement("div");
      text.className = "preview-text";
      text.textContent = entry.text;

      block.appendChild(role);
      block.appendChild(text);
      previewMessages.appendChild(block);
    }
  }

  function renderNotices(message) {
    previewNotice.innerHTML = "";
    const parts = [];

    if (message.truncated) {
      parts.push({ kind: "text", text: uiStrings.noticeTruncated || "Showing the most recent 100 messages." });
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
      text.textContent = (uiStrings.noticeLlmSetup || "") + " ";
      row.appendChild(text);
      const button = document.createElement("button");
      button.type = "button";
      button.className = "preview-notice-action";
      button.textContent = uiStrings.noticeOpenLlmSettings || "Open LLM Settings";
      button.addEventListener("click", () => {
        vscode.postMessage({ type: "openLlmSettings" });
      });
      row.appendChild(button);
      previewNotice.appendChild(row);
    }
  }

  function renderSummary(text, isError) {
    previewSummary.textContent = text;
    previewSummary.classList.remove("hidden");
    previewSummary.classList.toggle("preview-summary-error", Boolean(isError));
  }

  function applyResumeActions(showResumeWith) {
    previewResumeWith.classList.toggle("hidden", !showResumeWith);
  }

  function applyLlmActions(llmConfigured, showHandoff) {
    const needsConfig = llmConfigured !== true;
    const llmHint = uiStrings.tooltipLlmRequired || "Configure LLM Assist in Agent Resume Settings";

    previewSummarize.classList.remove("hidden");
    previewAutoRename.classList.remove("hidden");
    previewSummarize.classList.toggle("preview-action-muted", needsConfig);
    previewAutoRename.classList.toggle("preview-action-muted", needsConfig);
    previewSummarize.title = needsConfig ? llmHint : "";
    previewAutoRename.title = needsConfig ? llmHint : "";

    previewHandoff.classList.toggle("hidden", showHandoff !== true);
    if (showHandoff === true) {
      previewHandoff.classList.toggle("preview-action-muted", needsConfig);
      previewHandoff.title = needsConfig ? llmHint : "";
    } else {
      previewHandoff.classList.remove("preview-action-muted");
      previewHandoff.title = "";
    }
  }

  function isLlmActionMuted() {
    return previewSummarize.classList.contains("preview-action-muted");
  }

  function postLlmAction(type) {
    if (isLlmActionMuted()) {
      vscode.postMessage({ type: "openLlmSettings" });
      return;
    }

    setAiButtonsDisabled(true);
    vscode.postMessage({ type });
  }

  function setAiButtonsDisabled(disabled) {
    previewSummarize.disabled = disabled;
    previewAutoRename.disabled = disabled;
    previewHandoff.disabled = disabled;
  }

  vscode.postMessage({ type: "ready" });
})();