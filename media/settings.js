(function () {
  const vscode = acquireVsCodeApi();

  /** @type {Array<{id: string, title: string, description?: string, fields: Array<{key: string, label: string, description: string, type: string, default: unknown, enum?: string[], minimum?: number, maximum?: number}>}>} */
  let sections = [];
  /** @type {Record<string, unknown>} */
  let values = {};
  let activeSectionId = "general";
  let llmApiKeyConfigured = false;
  let apiKeyInput = "";

  /** @type {string[]} */
  let projectMenuOrder = [];
  /** @type {Set<string>} */
  let projectMenuChecked = new Set();
  /** @type {Record<string, string>} */
  let projectMenuLabels = {};
  /** @type {string[]} */
  let projectMenuDefaultMainActions = [];
  /** @type {number | null} */
  let draggedProjectMenuIndex = null;
  let projectMenuDirty = false;

  const navList = document.getElementById("settings-nav-list");
  const sectionTitle = document.getElementById("section-title");
  const sectionDescription = document.getElementById("section-description");
  const fieldsEl = document.getElementById("settings-fields");
  const llmActions = document.getElementById("llm-actions");
  const projectMenuActions = document.getElementById("project-menu-actions");
  const projectMenuList = document.getElementById("project-menu-list");
  const resetProjectMenuBtn = document.getElementById("reset-project-menu");
  const testResult = document.getElementById("test-result");
  const statusBanner = document.getElementById("status-banner");
  const saveBtn = document.getElementById("save-settings");
  const testLlmBtn = document.getElementById("test-llm");

  saveBtn.addEventListener("click", () => {
    saveBtn.disabled = true;
    const patch = { ...values };
    if (apiKeyInput.trim()) {
      patch["llm.apiKey"] = apiKeyInput.trim();
    }
    if (projectMenuDirty) {
      patch["projectMenu.mainActions"] = {
        order: [...projectMenuOrder],
        checked: [...projectMenuChecked]
      };
    }
    vscode.postMessage({ type: "save", patch });
  });

  testLlmBtn.addEventListener("click", () => {
    testLlmBtn.disabled = true;
    testResult.classList.add("hidden");
    const draft = { ...values };
    if (apiKeyInput.trim()) {
      draft["llm.apiKey"] = apiKeyInput.trim();
    }
    vscode.postMessage({ type: "testLlm", draft });
  });

  resetProjectMenuBtn.addEventListener("click", () => {
    applyProjectMenuDefaults();
    projectMenuDirty = true;
    renderProjectMenuList();
  });

  window.addEventListener("message", (event) => {
    const message = event.data;

    if (message.type === "init") {
      sections = message.sections || [];
      values = { ...(message.values || {}) };
      llmApiKeyConfigured = Boolean(message.llmApiKeyConfigured);
      apiKeyInput = "";
      saveBtn.disabled = false;
      loadProjectMenuState(message.projectMenu);
      if (message.activeSection) {
        activeSectionId = message.activeSection;
      }
      renderNav();
      renderSection(activeSectionId);
      return;
    }

    if (message.type === "saved") {
      apiKeyInput = "";
      projectMenuDirty = false;
      saveBtn.disabled = false;
      showStatus("Settings saved.", "success");
      renderSection(activeSectionId);
      return;
    }

    if (message.type === "saveError") {
      saveBtn.disabled = false;
      showStatus(message.error || "Save failed.", "error");
      return;
    }

    if (message.type === "testResult") {
      testLlmBtn.disabled = false;
      testResult.classList.remove("hidden");
      testResult.textContent = message.message || "";
      testResult.classList.toggle("error", !message.success);
    }
  });

  function loadProjectMenuState(projectMenu) {
    projectMenuDirty = false;

    if (!projectMenu) {
      projectMenuOrder = [];
      projectMenuChecked = new Set();
      projectMenuLabels = {};
      projectMenuDefaultMainActions = [];
      return;
    }

    projectMenuOrder = Array.isArray(projectMenu.order) ? [...projectMenu.order] : [];
    projectMenuChecked = new Set(Array.isArray(projectMenu.mainActions) ? projectMenu.mainActions : []);
    projectMenuLabels = projectMenu.labels || {};
    projectMenuDefaultMainActions = Array.isArray(projectMenu.defaultMainActions)
      ? [...projectMenu.defaultMainActions]
      : [];
  }

  function applyProjectMenuDefaults() {
    const defaultSet = new Set(projectMenuDefaultMainActions);
    const order = [];

    for (const action of projectMenuDefaultMainActions) {
      order.push(action);
    }

    for (const action of projectMenuOrder.length ? projectMenuOrder : Object.keys(projectMenuLabels)) {
      if (!defaultSet.has(action)) {
        order.push(action);
      }
    }

    projectMenuOrder = order;
    projectMenuChecked = new Set(projectMenuDefaultMainActions);
  }

  function renderNav() {
    navList.innerHTML = "";
    for (const section of sections) {
      const button = document.createElement("button");
      button.type = "button";
      button.className = `settings-nav-item${section.id === activeSectionId ? " active" : ""}`;
      button.textContent = section.title;
      button.addEventListener("click", () => {
        activeSectionId = section.id;
        renderNav();
        renderSection(section.id);
      });
      navList.appendChild(button);
    }

    const projectButton = document.createElement("button");
    projectButton.type = "button";
    projectButton.className = `settings-nav-item${activeSectionId === "projectMenu" ? " active" : ""}`;
    projectButton.textContent = "Project Menu";
    projectButton.addEventListener("click", () => {
      activeSectionId = "projectMenu";
      renderNav();
      renderSection("projectMenu");
    });
    navList.appendChild(projectButton);
  }

  function renderSection(sectionId) {
    fieldsEl.innerHTML = "";
    llmActions.classList.add("hidden");
    projectMenuActions.classList.add("hidden");
    testResult.classList.add("hidden");

    if (sectionId === "projectMenu") {
      sectionTitle.textContent = "Project Menu";
      sectionDescription.textContent = "Configure and drag to reorder project context menu actions.";
      projectMenuActions.classList.remove("hidden");
      renderProjectMenuList();
      return;
    }

    const section = sections.find((entry) => entry.id === sectionId);
    if (!section) {
      return;
    }

    sectionTitle.textContent = section.title;
    sectionDescription.textContent = section.description || "";

    if (sectionId === "llm") {
      fieldsEl.appendChild(renderLlmTip());
    }

    for (const field of section.fields) {
      fieldsEl.appendChild(renderField(field));
      if (sectionId === "llm" && field.key === "llm.baseUrl") {
        fieldsEl.appendChild(renderApiKeyField());
      }
    }

    if (sectionId === "llm") {
      llmActions.classList.remove("hidden");
    }
  }

  function renderProjectMenuList() {
    if (!projectMenuList) {
      return;
    }

    projectMenuList.innerHTML = "";

    projectMenuOrder.forEach((actionId, index) => {
      const row = document.createElement("div");
      row.className = "project-menu-row";
      row.dataset.index = String(index);

      const handle = document.createElement("button");
      handle.type = "button";
      handle.className = "project-menu-drag-handle";
      handle.title = "Drag to reorder";
      handle.setAttribute("aria-label", "Drag to reorder");
      handle.draggable = true;
      handle.textContent = "⋮⋮";

      handle.addEventListener("dragstart", (event) => {
        draggedProjectMenuIndex = index;
        row.classList.add("is-dragging");
        if (event.dataTransfer) {
          event.dataTransfer.effectAllowed = "move";
          event.dataTransfer.setData("text/plain", String(index));
        }
      });

      handle.addEventListener("dragend", () => {
        draggedProjectMenuIndex = null;
        clearProjectMenuDragState();
      });

      row.addEventListener("dragover", (event) => {
        event.preventDefault();
        if (event.dataTransfer) {
          event.dataTransfer.dropEffect = "move";
        }
        row.classList.add("drag-over");
      });

      row.addEventListener("dragleave", () => {
        row.classList.remove("drag-over");
      });

      row.addEventListener("drop", (event) => {
        event.preventDefault();
        const fromIndex =
          draggedProjectMenuIndex ?? Number(event.dataTransfer?.getData("text/plain") ?? Number.NaN);
        reorderProjectMenuItem(fromIndex, index);
        clearProjectMenuDragState();
      });

      const checkbox = document.createElement("input");
      checkbox.type = "checkbox";
      checkbox.checked = projectMenuChecked.has(actionId);
      checkbox.addEventListener("change", () => {
        if (checkbox.checked) {
          projectMenuChecked.add(actionId);
        } else {
          projectMenuChecked.delete(actionId);
        }
        projectMenuDirty = true;
      });

      const label = document.createElement("span");
      label.className = "project-menu-label";
      label.textContent = projectMenuLabels[actionId] || actionId;

      row.appendChild(handle);
      row.appendChild(checkbox);
      row.appendChild(label);
      projectMenuList.appendChild(row);
    });
  }

  function clearProjectMenuDragState() {
    projectMenuList.querySelectorAll(".project-menu-row").forEach((row) => {
      row.classList.remove("is-dragging", "drag-over");
    });
  }

  function reorderProjectMenuItem(fromIndex, toIndex) {
    if (
      !Number.isInteger(fromIndex) ||
      !Number.isInteger(toIndex) ||
      fromIndex === toIndex ||
      fromIndex < 0 ||
      toIndex < 0 ||
      fromIndex >= projectMenuOrder.length ||
      toIndex >= projectMenuOrder.length
    ) {
      return;
    }

    const next = [...projectMenuOrder];
    const [item] = next.splice(fromIndex, 1);
    next.splice(toIndex, 0, item);
    projectMenuOrder = next;
    projectMenuDirty = true;
    renderProjectMenuList();
  }

  function renderLlmTip() {
    const tip = document.createElement("div");
    tip.className = "settings-tip";
    tip.textContent =
      "Tip: Use a fast, low-cost model when possible. Summarize and Auto Rename work well with lightweight models such as gpt-4o-mini or deepseek-chat — a large reasoning model is not required.";
    return tip;
  }

  function renderApiKeyField() {
    const wrapper = document.createElement("div");
    wrapper.className = "settings-field";

    const label = document.createElement("label");
    label.className = "settings-label";
    label.textContent = "API Key";
    wrapper.appendChild(label);

    const description = document.createElement("div");
    description.className = "settings-description";
    description.textContent = llmApiKeyConfigured
      ? "Configured. Enter a new key to replace, or leave blank to keep the current key."
      : "OpenAI-compatible API key. Stored securely in VS Code Secret Storage.";
    wrapper.appendChild(description);

    const input = document.createElement("input");
    input.className = "settings-input";
    input.type = "password";
    input.autocomplete = "off";
    input.placeholder = llmApiKeyConfigured ? "••••••••" : "sk-...";
    input.value = apiKeyInput;
    input.addEventListener("input", () => {
      apiKeyInput = input.value;
    });
    wrapper.appendChild(input);

    return wrapper;
  }

  function renderField(field) {
    const wrapper = document.createElement("div");
    wrapper.className = "settings-field";

    const label = document.createElement("label");
    label.className = "settings-label";
    label.textContent = field.label;
    wrapper.appendChild(label);

    const description = document.createElement("div");
    description.className = "settings-description";
    description.textContent = field.description;
    wrapper.appendChild(description);

    if (field.type === "boolean") {
      const row = document.createElement("div");
      row.className = "settings-checkbox-row";
      const input = document.createElement("input");
      input.type = "checkbox";
      input.checked = Boolean(values[field.key]);
      input.addEventListener("change", () => {
        values[field.key] = input.checked;
      });
      row.appendChild(input);
      wrapper.appendChild(row);
      return wrapper;
    }

    if (field.type === "enum" && field.enum) {
      const select = document.createElement("select");
      select.className = "settings-select";
      for (const option of field.enum) {
        const el = document.createElement("option");
        el.value = option;
        el.textContent = option;
        select.appendChild(el);
      }
      select.value = String(values[field.key] ?? field.default);
      select.addEventListener("change", () => {
        values[field.key] = select.value;
      });
      wrapper.appendChild(select);
      return wrapper;
    }

    const input = document.createElement("input");
    input.className = "settings-input";
    input.type = field.type === "number" ? "number" : "text";
    if (field.minimum !== undefined) {
      input.min = String(field.minimum);
    }
    if (field.maximum !== undefined) {
      input.max = String(field.maximum);
    }
    input.value = String(values[field.key] ?? field.default);
    input.addEventListener("input", () => {
      values[field.key] = field.type === "number" ? Number(input.value) : input.value;
    });
    wrapper.appendChild(input);
    return wrapper;
  }

  function showStatus(text, kind) {
    statusBanner.textContent = text;
    statusBanner.className = `settings-status ${kind}`;
    statusBanner.classList.remove("hidden");
    window.setTimeout(() => {
      statusBanner.classList.add("hidden");
    }, 3000);
  }

  vscode.postMessage({ type: "ready" });
})();