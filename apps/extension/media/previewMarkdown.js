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

  function clearFindHighlights(containers) {
    for (const root of containers) {
      if (!root) continue;
      const marks = root.querySelectorAll("mark.preview-find-hit");
      if (!marks.length) continue;
      for (const mark of marks) {
        const parent = mark.parentNode;
        if (!parent) continue;
        parent.replaceChild(document.createTextNode(mark.textContent || ""), mark);
      }
      root.normalize();
    }
  }

  function highlightContainerText(root, lowerQuery, queryLen, hits) {
    if (!root || root.classList.contains("hidden")) return;
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    const textNodes = [];
    let current;
    while ((current = walker.nextNode())) {
      if (!current.nodeValue || !current.parentElement) continue;
      if (current.parentElement.closest("mark.preview-find-hit")) continue;
      textNodes.push(current);
    }

    for (const node of textNodes) {
      const value = node.nodeValue || "";
      const lower = value.toLowerCase();
      let index = lower.indexOf(lowerQuery);
      if (index < 0) continue;

      const fragment = document.createDocumentFragment();
      let cursor = 0;
      while (index >= 0) {
        if (index > cursor) {
          fragment.appendChild(document.createTextNode(value.slice(cursor, index)));
        }
        const mark = document.createElement("mark");
        mark.className = "preview-find-hit";
        mark.textContent = value.slice(index, index + queryLen);
        fragment.appendChild(mark);
        hits.push(mark);
        cursor = index + queryLen;
        index = lower.indexOf(lowerQuery, cursor);
      }
      if (cursor < value.length) {
        fragment.appendChild(document.createTextNode(value.slice(cursor)));
      }
      node.parentNode?.replaceChild(fragment, node);
    }
  }

  function createPreviewFindController(options) {
    const {
      containers,
      barEl,
      inputEl,
      countEl,
      prevBtn,
      nextBtn,
      closeBtn,
      toggleBtn
    } = options;

    let hits = [];
    let activeIndex = -1;

    function updateToggleState() {
      const open = Boolean(barEl && !barEl.classList.contains("hidden"));
      if (toggleBtn) {
        toggleBtn.classList.toggle("active", open);
        toggleBtn.setAttribute("aria-pressed", String(open));
      }
    }

    function updateActiveHit(scroll) {
      for (let i = 0; i < hits.length; i++) {
        hits[i].classList.toggle("active", i === activeIndex);
      }
      const query = inputEl ? inputEl.value.trim() : "";
      if (countEl) {
        if (!query) {
          countEl.textContent = "";
          countEl.classList.remove("no-match");
        } else {
          countEl.textContent = hits.length > 0 ? `${activeIndex + 1} / ${hits.length}` : "0 / 0";
          countEl.classList.toggle("no-match", hits.length === 0);
        }
      }
      if (prevBtn) prevBtn.disabled = hits.length === 0;
      if (nextBtn) nextBtn.disabled = hits.length === 0;

      if (scroll && activeIndex >= 0 && hits[activeIndex]) {
        hits[activeIndex].scrollIntoView({ block: "center", behavior: "smooth" });
      }
    }

    function refresh(scrollToFirst) {
      clearFindHighlights(containers);
      hits = [];
      activeIndex = -1;

      const query = inputEl ? inputEl.value.trim() : "";
      if (query) {
        const lower = query.toLowerCase();
        for (const root of containers) {
          highlightContainerText(root, lower, query.length, hits);
        }
        if (hits.length > 0) {
          activeIndex = 0;
        }
      }
      updateActiveHit(Boolean(scrollToFirst));
    }

    function step(delta) {
      if (!hits.length) return;
      activeIndex = (activeIndex + delta + hits.length) % hits.length;
      updateActiveHit(true);
    }

    function open() {
      if (!barEl) return;
      barEl.classList.remove("hidden");
      updateToggleState();
      if (inputEl) {
        inputEl.focus();
        inputEl.select();
        if (inputEl.value.trim()) {
          refresh(true);
        } else {
          updateActiveHit(false);
        }
      }
    }

    function close() {
      if (!barEl) return;
      barEl.classList.add("hidden");
      updateToggleState();
      clearFindHighlights(containers);
      hits = [];
      activeIndex = -1;
      if (countEl) {
        countEl.textContent = "";
        countEl.classList.remove("no-match");
      }
      if (prevBtn) prevBtn.disabled = true;
      if (nextBtn) nextBtn.disabled = true;
    }

    function toggle() {
      if (barEl && barEl.classList.contains("hidden")) {
        open();
      } else {
        close();
      }
    }

    function isOpen() {
      return Boolean(barEl && !barEl.classList.contains("hidden"));
    }

    toggleBtn?.addEventListener("click", toggle);
    closeBtn?.addEventListener("click", close);
    prevBtn?.addEventListener("click", () => step(-1));
    nextBtn?.addEventListener("click", () => step(1));

    inputEl?.addEventListener("input", () => refresh(true));
    inputEl?.addEventListener("keydown", (event) => {
      if (event.key === "Enter") {
        event.preventDefault();
        step(event.shiftKey ? -1 : 1);
      } else if (event.key === "Escape") {
        event.preventDefault();
        event.stopPropagation();
        close();
      }
    });

    updateToggleState();

    return {
      open,
      close,
      toggle,
      refresh,
      step,
      isOpen
    };
  }

  window.AgentResumePreviewFind = {
    createController: createPreviewFindController
  };
})();
