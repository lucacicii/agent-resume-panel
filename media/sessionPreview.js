(function () {
  const vscode = acquireVsCodeApi();

  const previewTitle = document.getElementById("preview-title");
  const previewNotice = document.getElementById("preview-notice");
  const previewMessages = document.getElementById("preview-messages");
  const previewResume = document.getElementById("preview-resume");
  const previewResumeWith = document.getElementById("preview-resume-with");
  const previewRename = document.getElementById("preview-rename");
  const previewClose = document.getElementById("preview-close");

  previewResume.addEventListener("click", () => {
    vscode.postMessage({ type: "resume" });
  });

  previewResumeWith.addEventListener("click", () => {
    vscode.postMessage({ type: "resumeWith" });
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
      renderPreview(message);
      return;
    }

    if (message.type === "error") {
      previewTitle.textContent = "Preview failed";
      previewNotice.classList.add("hidden");
      previewMessages.innerHTML = "";
      const error = document.createElement("div");
      error.className = "preview-error";
      error.textContent = message.error || "Failed to load session preview.";
      previewMessages.appendChild(error);
      previewRename.disabled = false;
      return;
    }

    if (message.type === "titleUpdated") {
      previewTitle.textContent = message.title || "Session Preview";
      previewRename.disabled = false;
      return;
    }

    if (message.type === "renameDone") {
      previewRename.disabled = false;
    }
  });

  function renderPreview(message) {
    previewTitle.textContent = message.title || "Session Preview";
    previewMessages.innerHTML = "";
    applyResumeActions(message.showResumeWith !== false);

    const notices = [];
    if (message.truncated) {
      notices.push("Showing the most recent 100 messages.");
    }
    if (message.warning) {
      notices.push(message.warning);
    }

    if (notices.length) {
      previewNotice.textContent = notices.join(" ");
      previewNotice.classList.remove("hidden");
    } else {
      previewNotice.textContent = "";
      previewNotice.classList.add("hidden");
    }

    for (const entry of message.messages || []) {
      const block = document.createElement("div");
      block.className = `preview-message ${entry.role}`;

      const role = document.createElement("div");
      role.className = "preview-role";
      role.textContent = entry.role === "assistant" ? "Assistant" : "User";

      const text = document.createElement("div");
      text.className = "preview-text";
      text.textContent = entry.text;

      block.appendChild(role);
      block.appendChild(text);
      previewMessages.appendChild(block);
    }
  }

  function applyResumeActions(showResumeWith) {
    previewResumeWith.classList.toggle("hidden", !showResumeWith);
  }

  vscode.postMessage({ type: "ready" });
})();