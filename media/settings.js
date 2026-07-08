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

  /** @type {string[]} */
  let sessionMenuOrder = [];
  /** @type {Set<string>} */
  let sessionMenuChecked = new Set();
  /** @type {Record<string, string>} */
  let sessionMenuLabels = {};
  /** @type {string[]} */
  let sessionMenuDefaultMainActions = [];
  /** @type {number | null} */
  let draggedSessionMenuIndex = null;
  let sessionMenuDirty = false;

  const navList = document.getElementById("settings-nav-list");
  const sectionTitle = document.getElementById("section-title");
  const sectionDescription = document.getElementById("section-description");
  const fieldsEl = document.getElementById("settings-fields");
  const llmActions = document.getElementById("llm-actions");
  const projectMenuActions = document.getElementById("project-menu-actions");
  const projectMenuList = document.getElementById("project-menu-list");
  const sessionMenuActions = document.getElementById("session-menu-actions");
  const sessionMenuList = document.getElementById("session-menu-list");
  const resetProjectMenuBtn = document.getElementById("reset-project-menu");
  const resetSessionMenuBtn = document.getElementById("reset-session-menu");
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
    if (sessionMenuDirty) {
      patch["sessionMenu.mainActions"] = {
        order: [...sessionMenuOrder],
        checked: [...sessionMenuChecked]
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

  resetSessionMenuBtn.addEventListener("click", () => {
    applySessionMenuDefaults();
    sessionMenuDirty = true;
    renderSessionMenuList();
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
      loadSessionMenuState(message.sessionMenu);
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
      sessionMenuDirty = false;
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

  function loadSessionMenuState(sessionMenu) {
    sessionMenuDirty = false;

    if (!sessionMenu) {
      sessionMenuOrder = [];
      sessionMenuChecked = new Set();
      sessionMenuLabels = {};
      sessionMenuDefaultMainActions = [];
      return;
    }

    sessionMenuOrder = Array.isArray(sessionMenu.order) ? [...sessionMenu.order] : [];
    sessionMenuChecked = new Set(Array.isArray(sessionMenu.mainActions) ? sessionMenu.mainActions : []);
    sessionMenuLabels = sessionMenu.labels || {};
    sessionMenuDefaultMainActions = Array.isArray(sessionMenu.defaultMainActions)
      ? [...sessionMenu.defaultMainActions]
      : [];
  }

  function applySessionMenuDefaults() {
    const defaultSet = new Set(sessionMenuDefaultMainActions);
    const order = [];

    for (const action of sessionMenuDefaultMainActions) {
      order.push(action);
    }

    for (const action of sessionMenuOrder.length ? sessionMenuOrder : Object.keys(sessionMenuLabels)) {
      if (!defaultSet.has(action)) {
        order.push(action);
      }
    }

    sessionMenuOrder = order;
    sessionMenuChecked = new Set(sessionMenuDefaultMainActions);
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

    const sessionButton = document.createElement("button");
    sessionButton.type = "button";
    sessionButton.className = `settings-nav-item${activeSectionId === "sessionMenu" ? " active" : ""}`;
    sessionButton.textContent = "Session Menu";
    sessionButton.addEventListener("click", () => {
      activeSectionId = "sessionMenu";
      renderNav();
      renderSection("sessionMenu");
    });
    navList.appendChild(sessionButton);
  }

  function renderSection(sectionId) {
    fieldsEl.innerHTML = "";
    llmActions.classList.add("hidden");
    projectMenuActions.classList.add("hidden");
    sessionMenuActions.classList.add("hidden");
    testResult.classList.add("hidden");

    if (sectionId === "projectMenu") {
      sectionTitle.textContent = "Project Menu";
      sectionDescription.textContent = "Configure and drag to reorder project context menu actions.";
      projectMenuActions.classList.remove("hidden");
      renderProjectMenuList();
      return;
    }

    if (sectionId === "sessionMenu") {
      sectionTitle.textContent = "Session Menu";
      sectionDescription.textContent = "Configure and drag to reorder session context menu actions.";
      sessionMenuActions.classList.remove("hidden");
      renderSessionMenuList();
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

    if (section.groups?.length) {
      for (const group of section.groups) {
        fieldsEl.appendChild(renderFieldGroup(group));
      }
    } else {
      for (const field of section.fields ?? []) {
        fieldsEl.appendChild(renderField(field));
        if (sectionId === "llm" && field.key === "llm.baseUrl") {
          fieldsEl.appendChild(renderApiKeyField());
        }
      }
    }

    if (sectionId === "llm") {
      llmActions.classList.remove("hidden");
    }
  }

  function renderFieldGroup(group) {
    const wrapper = document.createElement("section");
    wrapper.className = "settings-group";

    const title = document.createElement("h3");
    title.className = "settings-group-title";
    title.textContent = group.title;
    wrapper.appendChild(title);

    if (group.description) {
      const description = document.createElement("div");
      description.className = "settings-group-description";
      description.textContent = group.description;
      wrapper.appendChild(description);
    }

    const body = document.createElement("div");
    body.className = "settings-group-body";
    for (const field of group.fields) {
      body.appendChild(renderField(field));
    }
    wrapper.appendChild(body);
    return wrapper;
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

  function renderSessionMenuList() {
    if (!sessionMenuList) {
      return;
    }

    sessionMenuList.innerHTML = "";

    sessionMenuOrder.forEach((actionId, index) => {
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
        draggedSessionMenuIndex = index;
        row.classList.add("is-dragging");
        if (event.dataTransfer) {
          event.dataTransfer.effectAllowed = "move";
          event.dataTransfer.setData("text/plain", String(index));
        }
      });

      handle.addEventListener("dragend", () => {
        draggedSessionMenuIndex = null;
        clearSessionMenuDragState();
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
          draggedSessionMenuIndex ?? Number(event.dataTransfer?.getData("text/plain") ?? Number.NaN);
        reorderSessionMenuItem(fromIndex, index);
        clearSessionMenuDragState();
      });

      const checkbox = document.createElement("input");
      checkbox.type = "checkbox";
      checkbox.checked = sessionMenuChecked.has(actionId);
      checkbox.addEventListener("change", () => {
        if (checkbox.checked) {
          sessionMenuChecked.add(actionId);
        } else {
          sessionMenuChecked.delete(actionId);
        }
        sessionMenuDirty = true;
      });

      const label = document.createElement("span");
      label.className = "project-menu-label";
      label.textContent = sessionMenuLabels[actionId] || actionId;

      row.appendChild(handle);
      row.appendChild(checkbox);
      row.appendChild(label);
      sessionMenuList.appendChild(row);
    });
  }

  function clearSessionMenuDragState() {
    sessionMenuList.querySelectorAll(".project-menu-row").forEach((row) => {
      row.classList.remove("is-dragging", "drag-over");
    });
  }

  function reorderSessionMenuItem(fromIndex, toIndex) {
    if (
      !Number.isInteger(fromIndex) ||
      !Number.isInteger(toIndex) ||
      fromIndex === toIndex ||
      fromIndex < 0 ||
      toIndex < 0 ||
      fromIndex >= sessionMenuOrder.length ||
      toIndex >= sessionMenuOrder.length
    ) {
      return;
    }

    const next = [...sessionMenuOrder];
    const [item] = next.splice(fromIndex, 1);
    next.splice(toIndex, 0, item);
    sessionMenuOrder = next;
    sessionMenuDirty = true;
    renderSessionMenuList();
  }

  function renderLlmTip() {
    const tip = document.createElement("div");
    tip.className = "settings-tip";
    tip.textContent =
      "Tip: Use a fast, low-cost model when possible. Summarize and Auto Rename work well with lightweight models such as gpt-4o-mini or deepseek-chat — a large reasoning model is not required.";
    return tip;
  }

  const svgNs = "http://www.w3.org/2000/svg";
  const weuiEyeOnPath =
    "M12 17.8c4.034 0 7.686-2.25 9.648-5.8C19.686 8.45 16.034 6.2 12 6.2S4.314 8.45 2.352 12c1.962 3.55 5.614 5.8 9.648 5.8M12 5c4.808 0 8.972 2.848 11 7c-2.028 4.152-6.192 7-11 7s-8.972-2.848-11-7c2.028-4.152 6.192-7 11-7m0 9.8a2.8 2.8 0 1 0 0-5.6a2.8 2.8 0 0 0 0 5.6m0 1.2a4 4 0 1 1 0-8a4 4 0 0 1 0 8";
  const weuiEyeOffPath =
    "m18.67 16.973l2.755 2.755l-.849.848L3.85 3.85L4.697 3l2.855 2.855C8.932 5.303 10.432 5 12 5c4.808 0 8.972 2.848 11 7a12.65 12.65 0 0 1-4.33 4.973M8.486 6.79l1.664 1.664a4 4 0 0 1 5.398 5.398l2.255 2.255c1.574-1 2.904-2.403 3.845-4.106C19.686 8.45 16.034 6.2 12 6.2a10.8 10.8 0 0 0-3.514.59m6.152 6.152a2.8 2.8 0 0 0-3.579-3.579zm1.81 5.204c-1.38.552-2.88.855-4.448.855c-4.808 0-8.972-2.848-11-7a12.65 12.65 0 0 1 4.33-4.973l.867.867A11.36 11.36 0 0 0 2.352 12c1.962 3.55 5.614 5.8 9.648 5.8a10.8 10.8 0 0 0 3.514-.59l.934.935zM8.453 10.15l.909.91a2.8 2.8 0 0 0 3.579 3.579l.91.908a4 4 0 0 1-5.398-5.398z";

  function createWeuiPasswordIcon(pathD) {
    const svg = document.createElementNS(svgNs, "svg");
    svg.setAttribute("class", "settings-password-icon");
    svg.setAttribute("viewBox", "0 0 24 24");
    svg.setAttribute("aria-hidden", "true");

    const path = document.createElementNS(svgNs, "path");
    path.setAttribute("fill", "currentColor");
    path.setAttribute("fill-rule", "evenodd");
    path.setAttribute("d", pathD);
    svg.appendChild(path);

    return svg;
  }

  function setPasswordToggleIcon(button, passwordVisible) {
    button.replaceChildren(
      createWeuiPasswordIcon(passwordVisible ? weuiEyeOffPath : weuiEyeOnPath)
    );
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

    const row = document.createElement("div");
    row.className = "settings-password-row";

    const input = document.createElement("input");
    input.className = "settings-input settings-password-input";
    input.type = "password";
    input.autocomplete = "off";
    input.placeholder = llmApiKeyConfigured ? "••••••••" : "sk-...";
    input.value = apiKeyInput;
    input.addEventListener("input", () => {
      apiKeyInput = input.value;
    });

    const toggle = document.createElement("button");
    toggle.type = "button";
    toggle.className = "settings-password-toggle";
    setPasswordToggleIcon(toggle, false);
    toggle.setAttribute("aria-label", "Show password");
    toggle.title = "Show password";
    toggle.addEventListener("click", () => {
      const revealing = input.type === "password";
      input.type = revealing ? "text" : "password";
      setPasswordToggleIcon(toggle, revealing);
      toggle.setAttribute("aria-label", revealing ? "Hide password" : "Show password");
      toggle.title = revealing ? "Hide password" : "Show password";
      toggle.classList.toggle("is-visible", revealing);
    });

    row.appendChild(input);
    row.appendChild(toggle);
    wrapper.appendChild(row);

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

    if (field.type === "stringArray") {
      const textarea = document.createElement("textarea");
      textarea.className = "settings-textarea";
      textarea.rows = 3;
      const current = values[field.key] ?? field.default;
      textarea.value = Array.isArray(current) ? current.join("\n") : String(current ?? "");
      textarea.addEventListener("input", () => {
        values[field.key] = textarea.value
          .split("\n")
          .map((entry) => entry.trim())
          .filter(Boolean);
      });
      wrapper.appendChild(textarea);
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