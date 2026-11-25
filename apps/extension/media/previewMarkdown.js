(function () {
  let hookRegistered = false;

  function ensureSanitizeHook() {
    if (hookRegistered || typeof DOMPurify === "undefined" || typeof DOMPurify.addHook !== "function") {
      return;
    }
    hookRegistered = true;
    DOMPurify.addHook("afterSanitizeAttributes", (node) => {
      if (node.tagName === "A" && node.hasAttribute("href")) {
        node.setAttribute("target", "_blank");
        node.setAttribute("rel", "noopener noreferrer");
      }
    });
  }

  function normalizeMode(mode) {
    return mode === "raw" ? "raw" : "markdown";
  }

  function renderMarkdown(text) {
    if (typeof marked === "undefined" || typeof DOMPurify === "undefined") {
      return null;
    }

    try {
      ensureSanitizeHook();
      const html = marked.parse(text || "", { gfm: true, breaks: true });
      return DOMPurify.sanitize(html, { USE_PROFILES: { html: true } });
    } catch {
      return null;
    }
  }

  function applyFormattedText(el, text, mode) {
    if (!el) {
      return;
    }

    const content = typeof text === "string" ? text : "";
    if (normalizeMode(mode) === "markdown") {
      const html = renderMarkdown(content);
      if (html !== null) {
        el.innerHTML = html;
        el.classList.add("markdown-body");
        return;
      }
    }

    el.classList.remove("markdown-body");
    el.textContent = content;
  }

  window.AgentResumePreviewMarkdown = {
    normalizeMode,
    renderMarkdown,
    applyFormattedText
  };
})();
