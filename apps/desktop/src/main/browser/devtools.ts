import type { WebContents } from "electron";
import type { BrowserDevtoolsLogEntry, BrowserProbeStrings } from "../../shared/browserTypes";
import { buildBrowserProbeScript, isProbeMessage, PROBE_SOURCE_URL } from "./probe";

type BrowserDevtoolsHooks = {
  onLog: (entry: BrowserDevtoolsLogEntry) => void;
  onLogsCleared: () => void;
  onStateChange: (attached: boolean, reason?: string) => void;
};

/**
 * Per-tab console bridge: CDP supplies the rich log feed (console, uncaught
 * exceptions, failed requests), the probe script supplies picking. They are
 * separate paths on purpose — opening DevTools detaches this debugger session,
 * which must not stop the probe from working.
 */
export class BrowserDevtoolsBridge {
  private attached = false;
  /** True only while this bridge is the one that called `debugger.attach` itself. */
  private ownsAttachment = false;
  private logSeq = 0;

  constructor(
    private readonly wc: WebContents,
    private readonly hooks: BrowserDevtoolsHooks,
    private readonly strings: BrowserProbeStrings
  ) {}

  /** Idempotent; a no-op while DevTools owns the debugger session. */
  attach(): void {
    if (this.wc.isDestroyed()) return;
    if (this.wc.isDevToolsOpened()) {
      this.hooks.onStateChange(false, "devtools-open");
      return;
    }
    if (this.attached) return;
    void this.attachDebugger();
  }

  isAttached(): boolean {
    return this.attached;
  }

  detach(): void {
    if (this.wc.isDestroyed()) return;
    try {
      this.wc.debugger.removeListener("message", this.handleMessage);
      this.wc.debugger.removeListener("detach", this.handleDetach);
      // Only release what we took: an agent tool call may be mid-session on it.
      if (this.ownsAttachment && this.wc.debugger.isAttached()) this.wc.debugger.detach();
    } catch {
      // window/contents torn down mid-detach
    }
    this.attached = false;
    this.ownsAttachment = false;
  }

  dispose(): void {
    this.detach();
  }

  clearLogs(): void {
    this.hooks.onLogsCleared();
  }

  setInspectMode(mode: "inspect" | "markup" | "off"): Promise<void> {
    return this.runInPage(
      `if (window.__AR_BROWSER_PROBE__) { window.__AR_BROWSER_PROBE__.setMode('${mode}'); }`
    );
  }

  clearMarkups(id?: string): Promise<void> {
    return this.runInPage(
      `if (window.__AR_BROWSER_PROBE__) { window.__AR_BROWSER_PROBE__.clearMarkups(${JSON.stringify(id ?? null)}); }`
    );
  }

  injectProbe(): Promise<void> {
    return this.runInPage(buildBrowserProbeScript(this.strings));
  }

  /**
   * Takes the probe's own overlay out of the hit-test path, for synthetic input
   * that Chromium hit-tests by coordinates (the agent's `browser_click`).
   */
  setInputPassthrough(passthrough: boolean): Promise<void> {
    return this.runInPage(
      `if (window.__AR_BROWSER_PROBE__) { window.__AR_BROWSER_PROBE__.setInputPassthrough(${passthrough ? "true" : "false"}); }`
    );
  }

  private async attachDebugger(): Promise<void> {
    try {
      // The agent's `browser_*` tools attach this same debugger for their own
      // calls and detach it when they are done. Sharing the session is fine and
      // observing it is the point: refusing to (or dropping our listeners when it
      // is already attached) would leave the console silently empty.
      if (!this.wc.debugger.isAttached()) {
        this.wc.debugger.attach("1.3");
        this.ownsAttachment = true;
      }
      this.attached = true;
      this.wc.debugger.on("message", this.handleMessage);
      this.wc.debugger.on("detach", this.handleDetach);
      await this.wc.debugger.sendCommand("Console.enable");
      await this.wc.debugger.sendCommand("Runtime.enable");
      await this.wc.debugger.sendCommand("Page.enable");
      await this.wc.debugger.sendCommand("Network.enable");
      this.hooks.onStateChange(true);
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      console.warn("[browser-devtools] attach failed:", reason);
      this.detach();
      this.hooks.onStateChange(false, reason);
    }
  }

  /**
   * Runs a snippet in the tab, or does nothing when there is no document yet.
   *
   * `executeJavaScript` on a never-navigated `WebContentsView` never settles —
   * not a rejection, a permanent pending (Electron 29 through 44, independent of
   * the debugger or of whether the view is parented). Only a navigation wakes the
   * renderer frame, so every probe call before the first one must be a no-op.
   */
  private async runInPage(script: string): Promise<void> {
    if (this.wc.isDestroyed() || !this.wc.getURL()) return;
    try {
      await this.wc.executeJavaScript(script);
    } catch {
      // navigation or unload raced the call
    }
  }

  /**
   * A log belongs to the probe when any stack frame — not just the top one —
   * comes from the injected script: the probe reaches into framework internals,
   * so it can blow up inside page bundles. The inverse never misfires, since the
   * probe never calls back into page handlers.
   */
  private classifyOrigin(
    frames: Array<{ url?: string }> | undefined,
    url?: string
  ): BrowserDevtoolsLogEntry["origin"] {
    const framed = (frames || []).some((frame) => typeof frame?.url === "string" && frame.url.includes(PROBE_SOURCE_URL));
    if (framed) return "probe";
    return typeof url === "string" && url.includes(PROBE_SOURCE_URL) ? "probe" : "page";
  }

  private readonly handleMessage = (_event: Electron.Event, method: string, params: unknown): void => {
    this.handleCdpMessage(method, params as Record<string, any>);
  };

  /** Also fires when someone else — an agent tool call — released the session. */
  private readonly handleDetach = (_event: Electron.Event, reason: string): void => {
    this.attached = false;
    this.ownsAttachment = false;
    this.hooks.onStateChange(false, reason);
  };

  private handleCdpMessage(method: string, params: Record<string, any>): void {
    if (method === "Console.messageAdded") {
      const message = params.message;
      const text = String(message.text || "");
      // Probe traffic already travels on the tab's `console-message` channel.
      if (isProbeMessage(text)) return;

      let level: BrowserDevtoolsLogEntry["level"] = "info";
      if (message.level === "error") level = "error";
      else if (message.level === "warning") level = "warn";
      // Vue reports these at warn level, but they break the page.
      if (text.includes("[Vue warn]") || text.includes("Unhandled error during execution")) {
        level = "error";
      }

      this.addLog({
        id: `cdp_${++this.logSeq}`,
        timestamp: Date.now(),
        level,
        category: "console",
        text,
        origin: this.classifyOrigin(message.stackTrace?.callFrames, message.url),
        url: message.url,
        line: message.line,
        column: message.column,
        stack: formatStack(message.stackTrace?.callFrames)
      });
      return;
    }

    if (method === "Runtime.exceptionThrown") {
      const details = params.exceptionDetails;
      const text = details.exception?.description || details.text || "Uncaught Runtime Exception";
      this.addLog({
        id: `cdp_${++this.logSeq}`,
        timestamp: Date.now(),
        level: "error",
        category: "runtime",
        text,
        origin: this.classifyOrigin(details.stackTrace?.callFrames, details.url),
        url: details.url,
        line: details.lineNumber,
        column: details.columnNumber,
        stack: formatStack(details.stackTrace?.callFrames) || text
      });
      return;
    }

    if (method === "Network.responseReceived") {
      const response = params.response;
      if (response && response.status >= 400) {
        this.addLog({
          id: `cdp_${++this.logSeq}`,
          timestamp: Date.now(),
          level: "error",
          category: "network",
          text: `HTTP ${response.status} ${response.statusText || ""} - ${response.url}`,
          url: response.url
        });
      }
      return;
    }

    if (method === "Network.loadingFailed") {
      this.addLog({
        id: `cdp_${++this.logSeq}`,
        timestamp: Date.now(),
        level: "error",
        category: "network",
        text: `Request Failed: ${params.errorText || "Network error"}`,
        url: params.requestId
      });
    }
  }

  private addLog(entry: BrowserDevtoolsLogEntry): void {
    this.hooks.onLog(entry);
  }
}

function formatStack(frames: Array<{ functionName?: string; url?: string; lineNumber?: number; columnNumber?: number }> | undefined): string | undefined {
  if (!frames || frames.length === 0) return undefined;
  return frames
    .map((frame) => `  at ${frame.functionName || "anonymous"} (${frame.url}:${frame.lineNumber}:${frame.columnNumber})`)
    .join("\n");
}
