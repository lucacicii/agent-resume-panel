import type { WebContents } from "electron";

export type SnapshotNode = {
  ref: string;
  role: string;
  name?: string;
  value?: string;
  states?: string[];
  children?: SnapshotNode[];
};

export type BrowserSnapshot = {
  url: string;
  title: string;
  mode: "a11y" | "dom-lite";
  nodes: SnapshotNode[];
  truncated: boolean;
};

type AxNode = {
  nodeId: string;
  role?: { value?: string } | string;
  name?: { value?: string } | string;
  value?: { value?: string } | string;
  description?: { value?: string } | string;
  ignored?: boolean;
  childIds?: string[];
  backendDOMNodeId?: number;
  properties?: Array<{ name: string; value?: { value?: unknown } | unknown }>;
};

const MAX_NODES = 400;
const INTERESTING_ROLES = new Set([
  "button",
  "link",
  "textbox",
  "searchbox",
  "combobox",
  "checkbox",
  "radio",
  "switch",
  "tab",
  "menuitem",
  "option",
  "listbox",
  "slider",
  "spinbutton",
  "heading",
  "img",
  "image",
  "text",
  "StaticText",
  "generic",
  "WebArea",
  "RootWebArea",
  "form",
  "navigation",
  "main",
  "dialog",
  "alertdialog",
  "menu",
  "menubar",
  "treeitem",
  "cell",
  "row",
  "columnheader",
  "rowheader"
]);

function axString(value: unknown): string | undefined {
  if (value == null) return undefined;
  if (typeof value === "string") return value;
  if (typeof value === "object" && value && "value" in value) {
    const inner = (value as { value?: unknown }).value;
    if (inner == null) return undefined;
    return String(inner);
  }
  return String(value);
}

function isPasswordRole(role: string, name?: string): boolean {
  const r = role.toLowerCase();
  const n = (name || "").toLowerCase();
  return r.includes("password") || n.includes("password") || n.includes("passwd");
}

function propMap(node: AxNode): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const prop of node.properties || []) {
    const val =
      prop.value && typeof prop.value === "object" && prop.value !== null && "value" in (prop.value as object)
        ? (prop.value as { value?: unknown }).value
        : prop.value;
    out[prop.name] = val;
  }
  return out;
}

/**
 * Build an accessibility snapshot with short ref ids (e1, e2, …).
 * Prefer Chrome DevTools Accessibility domain; fall back to DOM-lite.
 */
export async function captureSnapshot(wc: WebContents): Promise<{
  snapshot: BrowserSnapshot;
  refToBackendNodeId: Map<string, number>;
  refToSelector: Map<string, string>;
}> {
  const url = wc.getURL() || "about:blank";
  const title = wc.getTitle() || "";
  const refToBackendNodeId = new Map<string, number>();
  const refToSelector = new Map<string, string>();

  try {
    const a11y = await captureA11ySnapshot(wc, refToBackendNodeId);
    if (a11y.nodes.length > 0) {
      return {
        snapshot: { url, title, mode: "a11y", nodes: a11y.nodes, truncated: a11y.truncated },
        refToBackendNodeId,
        refToSelector
      };
    }
  } catch {
    // fall through to DOM-lite
  }

  const dom = await captureDomLiteSnapshot(wc, refToSelector);
  return {
    snapshot: { url, title, mode: "dom-lite", nodes: dom.nodes, truncated: dom.truncated },
    refToBackendNodeId,
    refToSelector
  };
}

async function captureA11ySnapshot(
  wc: WebContents,
  refToBackendNodeId: Map<string, number>
): Promise<{ nodes: SnapshotNode[]; truncated: boolean }> {
  const dbg = wc.debugger;
  let attachedHere = false;
  if (!dbg.isAttached()) {
    dbg.attach("1.3");
    attachedHere = true;
  }
  try {
    await dbg.sendCommand("Accessibility.enable").catch(() => undefined);
    const result = (await dbg.sendCommand("Accessibility.getFullAXTree")) as {
      nodes?: AxNode[];
    };
    const nodes = result.nodes || [];
    const byId = new Map(nodes.map((n) => [n.nodeId, n]));
    const root = nodes.find((n) => {
      const role = axString(n.role) || "";
      return role === "RootWebArea" || role === "WebArea" || !nodes.some((p) => p.childIds?.includes(n.nodeId));
    });
    let counter = 0;
    let truncated = false;

    const visit = (nodeId: string, depth: number): SnapshotNode | null => {
      if (counter >= MAX_NODES) {
        truncated = true;
        return null;
      }
      const node = byId.get(nodeId);
      if (!node || node.ignored) return null;
      const role = axString(node.role) || "unknown";
      const name = axString(node.name);
      const rawValue = axString(node.value);
      const props = propMap(node);
      const states: string[] = [];
      for (const key of ["focused", "disabled", "checked", "selected", "expanded", "pressed", "readonly", "required"]) {
        if (props[key] === true || props[key] === "true") states.push(key);
      }
      const interesting =
        INTERESTING_ROLES.has(role) ||
        Boolean(name && name.trim()) ||
        role.toLowerCase().includes("button") ||
        role.toLowerCase().includes("link") ||
        role.toLowerCase().includes("text");
      const children: SnapshotNode[] = [];
      for (const childId of node.childIds || []) {
        const child = visit(childId, depth + 1);
        if (child) children.push(child);
      }
      if (!interesting && children.length === 0) return null;
      if (!interesting && children.length === 1 && depth > 0) return children[0];

      counter += 1;
      const ref = `e${counter}`;
      const backendFromProps = Number(props.backendDOMNodeId);
      const backendFromNode = Number(node.backendDOMNodeId);
      const backend =
        Number.isFinite(backendFromNode) && backendFromNode > 0
          ? backendFromNode
          : Number.isFinite(backendFromProps) && backendFromProps > 0
            ? backendFromProps
            : undefined;
      if (backend) refToBackendNodeId.set(ref, backend);

      const value = isPasswordRole(role, name) ? "••••" : rawValue;
      const out: SnapshotNode = { ref, role };
      if (name) out.name = name.slice(0, 200);
      if (value) out.value = value.slice(0, 200);
      if (states.length) out.states = states;
      if (children.length) out.children = children;
      return out;
    };

    if (!root) return { nodes: [], truncated: false };
    const tree = visit(root.nodeId, 0);
    return { nodes: tree ? [tree] : [], truncated };
  } finally {
    if (attachedHere) {
      try {
        dbg.detach();
      } catch {
        // ignore
      }
    }
  }
}

async function captureDomLiteSnapshot(
  wc: WebContents,
  refToSelector: Map<string, string>
): Promise<{ nodes: SnapshotNode[]; truncated: boolean }> {
  const result = (await wc.executeJavaScript(`(() => {
    const MAX = ${MAX_NODES};
    const selectorOf = (el) => {
      if (el.id) return '#' + CSS.escape(el.id);
      const parts = [];
      let cur = el;
      while (cur && cur.nodeType === 1 && parts.length < 5) {
        let part = cur.tagName.toLowerCase();
        if (cur.classList && cur.classList.length) {
          part += '.' + Array.from(cur.classList).slice(0, 2).map((c) => CSS.escape(c)).join('.');
        }
        const parent = cur.parentElement;
        if (parent) {
          const siblings = Array.from(parent.children).filter((c) => c.tagName === cur.tagName);
          if (siblings.length > 1) part += ':nth-of-type(' + (siblings.indexOf(cur) + 1) + ')';
        }
        parts.unshift(part);
        cur = parent;
      }
      return parts.join(' > ');
    };
    const isVisible = (el) => {
      const s = window.getComputedStyle(el);
      if (s.display === 'none' || s.visibility === 'hidden' || s.opacity === '0') return false;
      const r = el.getBoundingClientRect();
      return r.width > 0 && r.height > 0;
    };
    const interactive = 'a[href], button, input, select, textarea, [role], [contenteditable="true"], summary';
    const all = Array.from(document.querySelectorAll(interactive)).filter(isVisible);
    const els = all.slice(0, MAX);
    let i = 0;
    const nodes = els.map((el) => {
      i += 1;
      const ref = 'e' + i;
      const role = el.getAttribute('role') || el.tagName.toLowerCase();
      const name = (el.getAttribute('aria-label') || el.innerText || el.getAttribute('placeholder') || el.getAttribute('name') || '').trim().slice(0, 200);
      let value = '';
      if ('value' in el && typeof el.value === 'string') value = el.value;
      const type = (el.getAttribute('type') || '').toLowerCase();
      if (type === 'password') value = '••••';
      const states = [];
      if (el.disabled) states.push('disabled');
      if (el === document.activeElement) states.push('focused');
      return { ref, role, name, value, states, selector: selectorOf(el) };
    });
    return { nodes, truncated: all.length > MAX };
  })()`)) as {
    nodes: Array<{ ref: string; role: string; name?: string; value?: string; states?: string[]; selector: string }>;
    truncated: boolean;
  };

  const nodes: SnapshotNode[] = [];
  for (const item of result.nodes || []) {
    refToSelector.set(item.ref, item.selector);
    const node: SnapshotNode = { ref: item.ref, role: item.role };
    if (item.name) node.name = item.name;
    if (item.value) node.value = item.value;
    if (item.states?.length) node.states = item.states;
    nodes.push(node);
  }
  return { nodes, truncated: Boolean(result.truncated) };
}

export async function clickByBackendNodeId(wc: WebContents, backendNodeId: number): Promise<void> {
  const dbg = wc.debugger;
  let attachedHere = false;
  if (!dbg.isAttached()) {
    dbg.attach("1.3");
    attachedHere = true;
  }
  try {
    const box = (await dbg.sendCommand("DOM.getBoxModel", { backendNodeId })) as {
      model?: { content?: number[] };
    };
    const content = box.model?.content;
    if (!content || content.length < 8) throw new Error("Element has no box model.");
    const xs = [content[0], content[2], content[4], content[6]];
    const ys = [content[1], content[3], content[5], content[7]];
    const x = (Math.min(...xs) + Math.max(...xs)) / 2;
    const y = (Math.min(...ys) + Math.max(...ys)) / 2;
    await dbg.sendCommand("Input.dispatchMouseEvent", {
      type: "mousePressed",
      x,
      y,
      button: "left",
      clickCount: 1
    });
    await dbg.sendCommand("Input.dispatchMouseEvent", {
      type: "mouseReleased",
      x,
      y,
      button: "left",
      clickCount: 1
    });
  } finally {
    if (attachedHere) {
      try {
        dbg.detach();
      } catch {
        // ignore
      }
    }
  }
}

export async function clickBySelector(wc: WebContents, selector: string): Promise<void> {
  const ok = await wc.executeJavaScript(`(() => {
    const el = document.querySelector(${JSON.stringify(selector)});
    if (!el) return false;
    el.scrollIntoView({ block: 'center', inline: 'center' });
    el.click();
    return true;
  })()`);
  if (!ok) throw new Error(`Element not found for selector: ${selector}`);
}

export async function typeBySelector(
  wc: WebContents,
  selector: string,
  text: string,
  opts?: { clear?: boolean; submit?: boolean }
): Promise<void> {
  const payload = {
    selector,
    text,
    clear: Boolean(opts?.clear),
    submit: Boolean(opts?.submit)
  };
  const ok = await wc.executeJavaScript(`(() => {
    const { selector, text, clear, submit } = ${JSON.stringify(payload)};
    const el = document.querySelector(selector);
    if (!el) return false;
    el.scrollIntoView({ block: 'center', inline: 'center' });
    el.focus();
    if (clear && 'value' in el) {
      el.value = '';
      el.dispatchEvent(new Event('input', { bubbles: true }));
    }
    if ('value' in el) {
      el.value = (el.value || '') + text;
      el.dispatchEvent(new Event('input', { bubbles: true }));
      el.dispatchEvent(new Event('change', { bubbles: true }));
    } else if (el.isContentEditable) {
      el.textContent = clear ? text : (el.textContent || '') + text;
      el.dispatchEvent(new Event('input', { bubbles: true }));
    }
    if (submit) {
      const form = el.form || el.closest('form');
      if (form) form.requestSubmit ? form.requestSubmit() : form.submit();
      else el.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    }
    return true;
  })()`);
  if (!ok) throw new Error(`Element not found for selector: ${selector}`);
}

export async function typeByBackendNodeId(
  wc: WebContents,
  backendNodeId: number,
  text: string,
  opts?: { clear?: boolean; submit?: boolean }
): Promise<void> {
  const dbg = wc.debugger;
  let attachedHere = false;
  if (!dbg.isAttached()) {
    dbg.attach("1.3");
    attachedHere = true;
  }
  try {
    await dbg.sendCommand("DOM.focus", { backendNodeId });
    if (opts?.clear) {
      try {
        const resolved = (await dbg.sendCommand("DOM.resolveNode", { backendNodeId })) as {
          object?: { objectId?: string };
        };
        if (resolved.object?.objectId) {
          await dbg.sendCommand("Runtime.callFunctionOn", {
            objectId: resolved.object.objectId,
            functionDeclaration: "function() { if ('value' in this) this.value = ''; }"
          });
        }
      } catch {
        // ignore
      }
    }
    await dbg.sendCommand("Input.insertText", { text });
    if (opts?.submit) {
      await dbg.sendCommand("Input.dispatchKeyEvent", {
        type: "keyDown",
        key: "Enter",
        code: "Enter",
        windowsVirtualKeyCode: 13
      });
      await dbg.sendCommand("Input.dispatchKeyEvent", {
        type: "keyUp",
        key: "Enter",
        code: "Enter",
        windowsVirtualKeyCode: 13
      });
    }
  } finally {
    if (attachedHere) {
      try {
        dbg.detach();
      } catch {
        // ignore
      }
    }
  }
}

export async function pressKey(wc: WebContents, key: string): Promise<void> {
  const map: Record<string, { key: string; code: string; windowsVirtualKeyCode: number }> = {
    Enter: { key: "Enter", code: "Enter", windowsVirtualKeyCode: 13 },
    Tab: { key: "Tab", code: "Tab", windowsVirtualKeyCode: 9 },
    Escape: { key: "Escape", code: "Escape", windowsVirtualKeyCode: 27 },
    Backspace: { key: "Backspace", code: "Backspace", windowsVirtualKeyCode: 8 },
    ArrowDown: { key: "ArrowDown", code: "ArrowDown", windowsVirtualKeyCode: 40 },
    ArrowUp: { key: "ArrowUp", code: "ArrowUp", windowsVirtualKeyCode: 38 },
    ArrowLeft: { key: "ArrowLeft", code: "ArrowLeft", windowsVirtualKeyCode: 37 },
    ArrowRight: { key: "ArrowRight", code: "ArrowRight", windowsVirtualKeyCode: 39 }
  };
  const spec = map[key] || { key, code: key, windowsVirtualKeyCode: 0 };
  const dbg = wc.debugger;
  let attachedHere = false;
  if (!dbg.isAttached()) {
    dbg.attach("1.3");
    attachedHere = true;
  }
  try {
    await dbg.sendCommand("Input.dispatchKeyEvent", { type: "keyDown", ...spec });
    await dbg.sendCommand("Input.dispatchKeyEvent", { type: "keyUp", ...spec });
  } finally {
    if (attachedHere) {
      try {
        dbg.detach();
      } catch {
        // ignore
      }
    }
  }
}
