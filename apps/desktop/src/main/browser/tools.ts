import { statSync } from "node:fs";
import type { WebContents } from "electron";
import type { BrowserController } from "./controller";
import type {
  BrowserSessionId,
  BrowserSessionState,
  BrowserSurfaceKind,
  BrowserTabId
} from "./types";
import {
  captureSnapshot,
  clickByBackendNodeId,
  clickBySelector,
  pressKey,
  setFileInputFilesByBackendNodeId,
  setFileInputFilesBySelector,
  typeByBackendNodeId,
  typeBySelector,
  type BrowserSnapshot
} from "./snapshot";

export type BrowserToolCaller = {
  kind: "acp" | "mcp-client";
  recordId: string;
};

export type BrowserToolContext = {
  controller: BrowserController;
  projectPath: string;
  recordId: string;
  /**
   * Ownership channel. ACP chats use `acp` + recordId; CLI/TUI proxies use
   * `mcp-client` with recordId like `mcp:claude` (and optional clientName).
   */
  ownerKind?: "acp" | "mcp-client";
  clientName?: string;
  /** When true, skip owner checks for human/debug callers. */
  elevated?: boolean;
};

type RefMaps = {
  backend: Map<string, number>;
  selector: Map<string, string>;
  browserId: string;
  tabId: string;
  capturedAt: number;
};

const REF_TTL_MS = 5 * 60_000;
const refCache = new Map<string, RefMaps>();

function cacheKey(browserId: string, tabId: string): string {
  return `${browserId}::${tabId}`;
}

function storeRefs(browserId: string, tabId: string, backend: Map<string, number>, selector: Map<string, string>): void {
  refCache.set(cacheKey(browserId, tabId), {
    backend,
    selector,
    browserId,
    tabId,
    capturedAt: Date.now()
  });
}

function loadRefs(browserId: string, tabId: string): RefMaps | null {
  const entry = refCache.get(cacheKey(browserId, tabId));
  if (!entry) return null;
  if (Date.now() - entry.capturedAt > REF_TTL_MS) {
    refCache.delete(cacheKey(browserId, tabId));
    return null;
  }
  return entry;
}

function textResult(data: unknown, isError = false): { content: Array<{ type: "text"; text: string }>; isError?: boolean } {
  return {
    content: [{ type: "text", text: typeof data === "string" ? data : JSON.stringify(data, null, 2) }],
    ...(isError ? { isError: true } : {})
  };
}

function ownerKindOf(ctx: BrowserToolContext): "acp" | "mcp-client" {
  if (ctx.ownerKind === "mcp-client" || ctx.ownerKind === "acp") return ctx.ownerKind;
  if (ctx.recordId.startsWith("mcp:")) return "mcp-client";
  return "acp";
}

function ownsSession(session: BrowserSessionState, ctx: BrowserToolContext): boolean {
  const kind = ownerKindOf(ctx);
  if (kind === "mcp-client") {
    const clientName = ctx.clientName || ctx.recordId.replace(/^mcp:/, "") || ctx.recordId;
    return session.owners.some((owner) => {
      if (owner.kind === "mcp-client") {
        return owner.clientName === clientName || owner.clientName === ctx.recordId;
      }
      // Also accept acp-shaped owners that used mcp: record ids (legacy bind).
      return owner.kind === "acp" && owner.recordId === ctx.recordId;
    });
  }
  return session.owners.some((owner) => owner.kind === "acp" && owner.recordId === ctx.recordId);
}

function ensureOwner(session: BrowserSessionState, ctx: BrowserToolContext): void {
  if (ctx.elevated) return;
  if (!ownsSession(session, ctx)) {
    throw new Error(
      `Browser session ${session.id} is not owned by ${ownerKindOf(ctx)} caller ${ctx.recordId}. Call browser_open first or bind the session.`
    );
  }
}

function resolveSession(
  ctx: BrowserToolContext,
  browserId?: string
): BrowserSessionState {
  const c = ctx.controller;
  if (browserId) {
    const session = c.get(browserId);
    if (!session) throw new Error(`Unknown browser session: ${browserId}`);
    ensureOwner(session, ctx);
    return session;
  }
  const owned = c.list().filter(
    (session) => session.projectPath === ctx.projectPath && ownsSession(session, ctx)
  );
  if (owned.length === 1) return owned[0];
  if (owned.length > 1) {
    throw new Error(
      `Multiple browser sessions for this chat. Pass browserId. Candidates: ${owned.map((s) => s.id).join(", ")}`
    );
  }
  // Fall back to any project session only when elevated (human tools); agents must open.
  if (ctx.elevated) {
    const any = c.list().find((session) => session.projectPath === ctx.projectPath);
    if (any) return any;
  }
  throw new Error("No browser session for this chat. Call browser_open first.");
}

async function withActiveWebContents<T>(
  ctx: BrowserToolContext,
  browserId: string | undefined,
  tabId: string | undefined,
  fn: (wc: WebContents, session: BrowserSessionState, tabId: string) => Promise<T>
): Promise<T> {
  const session = resolveSession(ctx, browserId);
  const activeTabId = tabId || session.activeTabId;
  const wc = ctx.controller.getTabWebContents(session.id, activeTabId);
  if (!wc || wc.isDestroyed()) throw new Error("Active tab webContents is not available.");
  return fn(wc, session, activeTabId);
}

export const BROWSER_TOOL_NAMES = [
  "browser_status",
  "browser_open",
  "browser_set_surface",
  "browser_navigate",
  "browser_snapshot",
  "browser_screenshot",
  "browser_click",
  "browser_type",
  "browser_fill",
  "browser_select",
  "browser_press",
  "browser_upload",
  "browser_wait",
  "browser_tabs",
  "browser_clear_cookies"
] as const;

export type BrowserToolName = (typeof BROWSER_TOOL_NAMES)[number];

export const BROWSER_TOOL_INSTRUCTIONS = [
  "Use agent-resume-browser tools to drive the in-app BrowserPane (Workbench or pop-out window).",
  "1. Call browser_open (or browser_status) before acting.",
  "2. Call browser_snapshot before click/type; use returned ref ids (e1, e2, …).",
  "3. Re-snapshot after navigation or significant DOM changes.",
  "4. Prefer snapshot over screenshot.",
  "5. Never echo cookie values, Authorization headers, or password field contents into chat.",
  "6. browser_set_surface moves the live view between workbench and a standalone window without reloading.",
  "7. browser_upload injects local files into a <input type=file> ref (path or paths, upload order)."
].join(" ");

export async function invokeBrowserTool(
  name: string,
  args: Record<string, unknown>,
  ctx: BrowserToolContext
): Promise<{ content: Array<{ type: "text"; text: string }>; isError?: boolean }> {
  try {
    switch (name as BrowserToolName) {
      case "browser_status": {
        const browserId = typeof args.browserId === "string" ? args.browserId : undefined;
        try {
          const session = resolveSession(ctx, browserId);
          return textResult({
            browserId: session.id,
            projectPath: session.projectPath,
            surface: session.surface,
            activeTabId: session.activeTabId,
            tabs: session.tabs,
            partition: session.partition,
            owners: session.owners,
            policy: {
              allowHosts: session.policy.allowHosts,
              blockHosts: session.policy.blockHosts,
              maxTabs: session.policy.maxTabs,
              allowDownloads: session.policy.allowDownloads,
              allowPopups: session.policy.allowPopups
            }
          });
        } catch (error) {
          return textResult({
            open: false,
            projectPath: ctx.projectPath,
            recordId: ctx.recordId,
            message: error instanceof Error ? error.message : String(error)
          });
        }
      }
      case "browser_open": {
        const startUrl = typeof args.url === "string" ? args.url : typeof args.startUrl === "string" ? args.startUrl : undefined;
        const surface = args.surface === "window" || args.surface === "workbench" ? (args.surface as BrowserSurfaceKind) : undefined;
        const kind = ownerKindOf(ctx);
        const clientName =
          ctx.clientName || (kind === "mcp-client" ? ctx.recordId.replace(/^mcp:/, "") || ctx.recordId : undefined);
        const existing = ctx.controller.list().find(
          (session) => session.projectPath === ctx.projectPath && ownsSession(session, ctx)
        );
        if (existing) {
          if (kind === "mcp-client") {
            ctx.controller.bindOwner(existing.id, {
              kind: "mcp-client",
              clientName: clientName || ctx.recordId
            });
          } else {
            ctx.controller.bindOwner(existing.id, { kind: "acp", recordId: ctx.recordId });
          }
          if (startUrl) ctx.controller.navigate(existing.id, startUrl);
          if (surface) ctx.controller.setSurface(existing.id, surface);
          if (surface === "window" || existing.surface.kind === "window") {
            ctx.controller.focus(existing.id);
          }
          return textResult(ctx.controller.get(existing.id));
        }
        // create() only accepts ACP boundRecordId; bind mcp-client after create.
        const created = ctx.controller.create({
          projectPath: ctx.projectPath,
          startUrl,
          boundRecordId: kind === "acp" ? ctx.recordId : undefined,
          surface
        });
        if (kind === "mcp-client") {
          ctx.controller.bindOwner(created.id, {
            kind: "mcp-client",
            clientName: clientName || ctx.recordId
          });
        }
        if (created.surface.kind === "window") ctx.controller.focus(created.id);
        return textResult(ctx.controller.get(created.id) || created);
      }
      case "browser_set_surface": {
        const browserId = typeof args.browserId === "string" ? args.browserId : undefined;
        const surface = args.surface === "window" ? "window" : args.surface === "workbench" ? "workbench" : null;
        if (!surface) throw new Error('surface must be "workbench" or "window"');
        const session = resolveSession(ctx, browserId);
        const next = ctx.controller.setSurface(session.id, surface);
        if (surface === "window") ctx.controller.focus(session.id);
        return textResult(next);
      }
      case "browser_navigate": {
        const browserId = typeof args.browserId === "string" ? args.browserId : undefined;
        const url = typeof args.url === "string" ? args.url : "";
        if (!url.trim()) throw new Error("url is required");
        const tabId = typeof args.tabId === "string" ? args.tabId : undefined;
        const session = resolveSession(ctx, browserId);
        const next = ctx.controller.navigate(session.id, url, tabId);
        if (next.surface.kind === "window") ctx.controller.focus(session.id);
        return textResult(next);
      }
      case "browser_snapshot": {
        const browserId = typeof args.browserId === "string" ? args.browserId : undefined;
        const tabId = typeof args.tabId === "string" ? args.tabId : undefined;
        return withActiveWebContents(ctx, browserId, tabId, async (wc, session, activeTabId) => {
          const captured = await captureSnapshot(wc);
          storeRefs(session.id, activeTabId, captured.refToBackendNodeId, captured.refToSelector);
          return textResult({
            browserId: session.id,
            tabId: activeTabId,
            surface: session.surface,
            ...captured.snapshot
          } satisfies BrowserSnapshot & { browserId: string; tabId: string; surface: BrowserSessionState["surface"] });
        });
      }
      case "browser_screenshot": {
        const browserId = typeof args.browserId === "string" ? args.browserId : undefined;
        const tabId = typeof args.tabId === "string" ? args.tabId : undefined;
        return withActiveWebContents(ctx, browserId, tabId, async (wc, session, activeTabId) => {
          const image = await wc.capturePage();
          const size = image.getSize();
          const maxW = 1280;
          const resized =
            size.width > maxW
              ? image.resize({ width: maxW, height: Math.round((size.height * maxW) / size.width) })
              : image;
          const png = resized.toPNG();
          return {
            content: [
              {
                type: "text",
                text: JSON.stringify({
                  browserId: session.id,
                  tabId: activeTabId,
                  url: wc.getURL(),
                  title: wc.getTitle(),
                  width: resized.getSize().width,
                  height: resized.getSize().height,
                  note: "PNG follows as base64 in the next content part when clients support images; text fallback is metadata only."
                })
              },
              {
                type: "text",
                text: `data:image/png;base64,${png.toString("base64")}`
              }
            ]
          };
        });
      }
      case "browser_click": {
        const browserId = typeof args.browserId === "string" ? args.browserId : undefined;
        const tabId = typeof args.tabId === "string" ? args.tabId : undefined;
        const ref = typeof args.ref === "string" ? args.ref : "";
        if (!ref) throw new Error("ref is required (from browser_snapshot)");
        return withActiveWebContents(ctx, browserId, tabId, async (wc, session, activeTabId) => {
          const refs = loadRefs(session.id, activeTabId);
          if (!refs) throw new Error("No snapshot refs. Call browser_snapshot first.");
          const backend = refs.backend.get(ref);
          const selector = refs.selector.get(ref);
          if (backend) await clickByBackendNodeId(wc, backend);
          else if (selector) await clickBySelector(wc, selector);
          else throw new Error(`Unknown ref: ${ref}. Re-run browser_snapshot.`);
          return textResult({ ok: true, ref, browserId: session.id, tabId: activeTabId });
        });
      }
      case "browser_type":
      case "browser_fill": {
        const browserId = typeof args.browserId === "string" ? args.browserId : undefined;
        const tabId = typeof args.tabId === "string" ? args.tabId : undefined;
        const ref = typeof args.ref === "string" ? args.ref : "";
        const text = typeof args.text === "string" ? args.text : "";
        if (!ref) throw new Error("ref is required");
        if (typeof args.text !== "string") throw new Error("text is required");
        const clear = name === "browser_fill" ? true : Boolean(args.clear);
        const submit = Boolean(args.submit);
        return withActiveWebContents(ctx, browserId, tabId, async (wc, session, activeTabId) => {
          const refs = loadRefs(session.id, activeTabId);
          if (!refs) throw new Error("No snapshot refs. Call browser_snapshot first.");
          const backend = refs.backend.get(ref);
          const selector = refs.selector.get(ref);
          if (backend) await typeByBackendNodeId(wc, backend, text, { clear, submit });
          else if (selector) await typeBySelector(wc, selector, text, { clear, submit });
          else throw new Error(`Unknown ref: ${ref}. Re-run browser_snapshot.`);
          return textResult({ ok: true, ref, clear, submit, browserId: session.id, tabId: activeTabId });
        });
      }
      case "browser_select": {
        const browserId = typeof args.browserId === "string" ? args.browserId : undefined;
        const tabId = typeof args.tabId === "string" ? args.tabId : undefined;
        const ref = typeof args.ref === "string" ? args.ref : "";
        const value = typeof args.value === "string" ? args.value : "";
        if (!ref) throw new Error("ref is required");
        if (!value) throw new Error("value is required");
        return withActiveWebContents(ctx, browserId, tabId, async (wc, session, activeTabId) => {
          const refs = loadRefs(session.id, activeTabId);
          if (!refs) throw new Error("No snapshot refs. Call browser_snapshot first.");
          const selector = refs.selector.get(ref);
          if (!selector) throw new Error(`select requires DOM selector for ref ${ref}; re-snapshot (dom-lite) or use type.`);
          const ok = await wc.executeJavaScript(`(() => {
            const el = document.querySelector(${JSON.stringify(selector)});
            if (!el || el.tagName !== 'SELECT') return false;
            el.value = ${JSON.stringify(value)};
            el.dispatchEvent(new Event('input', { bubbles: true }));
            el.dispatchEvent(new Event('change', { bubbles: true }));
            return true;
          })()`);
          if (!ok) throw new Error("select element not found or not a <select>");
          return textResult({ ok: true, ref, value, browserId: session.id, tabId: activeTabId });
        });
      }
      case "browser_press": {
        const browserId = typeof args.browserId === "string" ? args.browserId : undefined;
        const tabId = typeof args.tabId === "string" ? args.tabId : undefined;
        const key = typeof args.key === "string" ? args.key : "";
        if (!key) throw new Error("key is required (e.g. Enter, Tab, Escape)");
        return withActiveWebContents(ctx, browserId, tabId, async (wc, session, activeTabId) => {
          await pressKey(wc, key);
          return textResult({ ok: true, key, browserId: session.id, tabId: activeTabId });
        });
      }
      case "browser_upload": {
        const browserId = typeof args.browserId === "string" ? args.browserId : undefined;
        const tabId = typeof args.tabId === "string" ? args.tabId : undefined;
        const ref = typeof args.ref === "string" ? args.ref : "";
        if (!ref) throw new Error("ref is required (file input from browser_snapshot)");
        const rawPaths = Array.isArray(args.paths)
          ? args.paths.map(String)
          : typeof args.path === "string"
            ? [args.path]
            : [];
        const paths = rawPaths.map((p) => p.trim()).filter((p) => p.length > 0);
        if (!paths.length) throw new Error("path or paths is required");
        if (paths.length > 20) throw new Error("Too many files (max 20 per upload).");
        for (const p of paths) {
          const st = statSync(p);
          if (!st.isFile()) throw new Error(`Not a regular file: ${p}`);
        }
        return withActiveWebContents(ctx, browserId, tabId, async (wc, session, activeTabId) => {
          const refs = loadRefs(session.id, activeTabId);
          if (!refs) throw new Error("No snapshot refs. Call browser_snapshot first.");
          const backend = refs.backend.get(ref);
          const selector = refs.selector.get(ref);
          if (backend) await setFileInputFilesByBackendNodeId(wc, backend, paths);
          else if (selector) await setFileInputFilesBySelector(wc, selector, paths);
          else throw new Error(`Unknown ref: ${ref}. Re-run browser_snapshot.`);
          return textResult({ ok: true, ref, count: paths.length, browserId: session.id, tabId: activeTabId });
        });
      }
      case "browser_wait": {
        const browserId = typeof args.browserId === "string" ? args.browserId : undefined;
        const tabId = typeof args.tabId === "string" ? args.tabId : undefined;
        const text = typeof args.text === "string" ? args.text : undefined;
        const urlIncludes = typeof args.urlIncludes === "string" ? args.urlIncludes : undefined;
        const timeoutMs = Math.min(Math.max(Number(args.timeoutMs) || 10_000, 100), 60_000);
        const load = args.load === true;
        return withActiveWebContents(ctx, browserId, tabId, async (wc, session, activeTabId) => {
          const started = Date.now();
          while (Date.now() - started < timeoutMs) {
            if (load && !wc.isLoading()) {
              return textResult({ ok: true, reason: "load", browserId: session.id, tabId: activeTabId, url: wc.getURL() });
            }
            if (urlIncludes && (wc.getURL() || "").includes(urlIncludes)) {
              return textResult({ ok: true, reason: "url", browserId: session.id, tabId: activeTabId, url: wc.getURL() });
            }
            if (text) {
              const found = await wc.executeJavaScript(
                `document.body && document.body.innerText && document.body.innerText.includes(${JSON.stringify(text)})`
              );
              if (found) {
                return textResult({ ok: true, reason: "text", browserId: session.id, tabId: activeTabId, url: wc.getURL() });
              }
            }
            if (!text && !urlIncludes && !load && !wc.isLoading()) {
              return textResult({ ok: true, reason: "idle", browserId: session.id, tabId: activeTabId, url: wc.getURL() });
            }
            await new Promise((r) => setTimeout(r, 200));
          }
          throw new Error(`browser_wait timed out after ${timeoutMs}ms`);
        });
      }
      case "browser_tabs": {
        const browserId = typeof args.browserId === "string" ? args.browserId : undefined;
        const action = typeof args.action === "string" ? args.action : "list";
        const session = resolveSession(ctx, browserId);
        if (action === "list") return textResult({ browserId: session.id, tabs: session.tabs, activeTabId: session.activeTabId });
        if (action === "new") {
          const url = typeof args.url === "string" ? args.url : undefined;
          return textResult(ctx.controller.newTab(session.id, url));
        }
        if (action === "close") {
          const tabId = typeof args.tabId === "string" ? args.tabId : "";
          if (!tabId) throw new Error("tabId required for close");
          try {
            return textResult({ session: ctx.controller.closeTab(session.id, tabId as BrowserTabId), destroyed: false });
          } catch (error) {
            if (error instanceof Error && error.message === "SESSION_DESTROYED") {
              return textResult({ session: null, destroyed: true });
            }
            throw error;
          }
        }
        if (action === "select" || action === "activate") {
          const tabId = typeof args.tabId === "string" ? args.tabId : "";
          if (!tabId) throw new Error("tabId required for select");
          return textResult(ctx.controller.activateTab(session.id, tabId as BrowserTabId));
        }
        throw new Error(`Unknown tabs action: ${action}`);
      }
      case "browser_clear_cookies": {
        const browserId = typeof args.browserId === "string" ? args.browserId : undefined;
        const hosts = Array.isArray(args.hosts) ? args.hosts.map(String) : undefined;
        const session = resolveSession(ctx, browserId);
        // Broad clear always allowed only when hosts specified or elevated; agents may clear.
        const next = await ctx.controller.clearCookies(session.id, hosts);
        return textResult({ ok: true, browserId: next.id, hosts: hosts || "all" });
      }
      default:
        throw new Error(`Unknown browser tool: ${name}`);
    }
  } catch (error) {
    return textResult(error instanceof Error ? error.message : String(error), true);
  }
}

export type BrowserToolDescriptor = {
  name: BrowserToolName;
  description: string;
  inputSchema: {
    type: "object";
    properties: Record<string, unknown>;
    required?: string[];
  };
};

export function listBrowserToolDescriptors(): BrowserToolDescriptor[] {
  const browserId = { type: "string", description: "Optional browser session id" };
  const tabId = { type: "string", description: "Optional tab id" };
  const ref = { type: "string", description: "Element ref from browser_snapshot (e.g. e3)" };
  return [
    {
      name: "browser_status",
      description: "Return browser session status: tabs, url, title, loading, surface (workbench|window).",
      inputSchema: { type: "object", properties: { browserId } }
    },
    {
      name: "browser_open",
      description: "Ensure a browser session for this chat/project; optionally open a URL and choose surface.",
      inputSchema: {
        type: "object",
        properties: {
          url: { type: "string" },
          startUrl: { type: "string" },
          surface: { type: "string", enum: ["workbench", "window"] }
        }
      }
    },
    {
      name: "browser_set_surface",
      description: "Move the live browser view between Workbench and a standalone window (no reload).",
      inputSchema: {
        type: "object",
        properties: { browserId, surface: { type: "string", enum: ["workbench", "window"] } },
        required: ["surface"]
      }
    },
    {
      name: "browser_navigate",
      description: "Navigate the active (or specified) tab to a URL. Host policy applies.",
      inputSchema: {
        type: "object",
        properties: { browserId, tabId, url: { type: "string" } },
        required: ["url"]
      }
    },
    {
      name: "browser_snapshot",
      description: "Primary observation: accessibility/DOM snapshot with short ref ids for click/type.",
      inputSchema: { type: "object", properties: { browserId, tabId } }
    },
    {
      name: "browser_screenshot",
      description: "Secondary observation: screenshot of the active tab (prefer snapshot).",
      inputSchema: { type: "object", properties: { browserId, tabId } }
    },
    {
      name: "browser_click",
      description: "Click an element by snapshot ref.",
      inputSchema: { type: "object", properties: { browserId, tabId, ref }, required: ["ref"] }
    },
    {
      name: "browser_type",
      description: "Type text into an element by ref. Optional clear/submit.",
      inputSchema: {
        type: "object",
        properties: {
          browserId,
          tabId,
          ref,
          text: { type: "string" },
          clear: { type: "boolean" },
          submit: { type: "boolean" }
        },
        required: ["ref", "text"]
      }
    },
    {
      name: "browser_fill",
      description: "Clear and type text into an element by ref.",
      inputSchema: {
        type: "object",
        properties: {
          browserId,
          tabId,
          ref,
          text: { type: "string" },
          submit: { type: "boolean" }
        },
        required: ["ref", "text"]
      }
    },
    {
      name: "browser_select",
      description: "Select an option in a <select> by ref and value.",
      inputSchema: {
        type: "object",
        properties: { browserId, tabId, ref, value: { type: "string" } },
        required: ["ref", "value"]
      }
    },
    {
      name: "browser_press",
      description: "Press a key (Enter, Tab, Escape, ArrowDown, …).",
      inputSchema: {
        type: "object",
        properties: { browserId, tabId, key: { type: "string" } },
        required: ["key"]
      }
    },
    {
      name: "browser_upload",
      description: "Upload local file(s) into a <input type=file> element by snapshot ref (first path = first image).",
      inputSchema: {
        type: "object",
        properties: {
          browserId,
          tabId,
          ref,
          path: { type: "string", description: "Single absolute local file path" },
          paths: {
            type: "array",
            items: { type: "string" },
            description: "Multiple absolute local file paths, in upload order"
          }
        },
        required: ["ref"]
      }
    },
    {
      name: "browser_wait",
      description: "Wait for text, urlIncludes, or load idle.",
      inputSchema: {
        type: "object",
        properties: {
          browserId,
          tabId,
          text: { type: "string" },
          urlIncludes: { type: "string" },
          load: { type: "boolean" },
          timeoutMs: { type: "number" }
        }
      }
    },
    {
      name: "browser_tabs",
      description: "List/new/close/select browser tabs.",
      inputSchema: {
        type: "object",
        properties: {
          browserId,
          action: { type: "string", enum: ["list", "new", "close", "select", "activate"] },
          tabId,
          url: { type: "string" }
        }
      }
    },
    {
      name: "browser_clear_cookies",
      description: "Clear cookies in the agent browser partition (optional hosts filter). Does not touch Chrome profile.",
      inputSchema: {
        type: "object",
        properties: {
          browserId,
          hosts: { type: "array", items: { type: "string" } }
        }
      }
    }
  ];
}

export type { BrowserSessionId };
