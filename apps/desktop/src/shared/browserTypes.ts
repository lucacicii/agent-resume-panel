export type BrowserSurfaceState =
  | { kind: "workbench"; windowId: number }
  | { kind: "window"; windowId: number };

export type BrowserTabStateDto = {
  tabId: string;
  url: string;
  title: string;
  favicon?: string;
  loading: boolean;
  canGoBack: boolean;
  canGoForward: boolean;
};

export type BrowserPolicyState = {
  allowHosts: string[];
  blockHosts: string[];
  allowPopups: boolean;
  maxTabs: number;
};

export type BrowserSessionState = {
  id: string;
  projectPath: string;
  partition: string;
  tabs: BrowserTabStateDto[];
  activeTabId: string;
  createdAt: number;
  surface: BrowserSurfaceState;
  owners: Array<{ kind: "acp"; recordId: string } | { kind: "mcp-client"; clientName: string }>;
  policy: BrowserPolicyState;
};

export type BrowserIpcEvent =
  | { type: "state"; session: BrowserSessionState }
  | { type: "surface"; browserId: string; surface: BrowserSurfaceState }
  | { type: "console"; browserId: string; tabId: string; level: string; message: string }
  | { type: "download"; browserId: string; filename: string; state: "started" | "done" | "blocked" }
  | { type: "crash"; browserId: string; reason: string }
  | { type: "probeInspect"; browserId: string; tabId: string; target: BrowserProbeTarget }
  | { type: "probeMarkup"; browserId: string; tabId: string; markup: BrowserProbeMarkup }
  | { type: "probeCancelled"; browserId: string; tabId: string }
  | { type: "devtoolsLog"; browserId: string; tabId: string; entry: BrowserDevtoolsLogEntry }
  | { type: "devtoolsLogsCleared"; browserId: string; tabId: string }
  | { type: "devtoolsAttached"; browserId: string; tabId: string; attached: boolean; reason?: string };

export type BrowserProbeFramework = "vue3" | "vue2" | "react" | "native-dom";

export type BrowserProbeLocateMode = "compiler" | "fiber" | "text" | "none";

export type BrowserProbeRect = { top: number; left: number; width: number; height: number };

/** Payload of `__AR_INSPECT_RESULT__`: one picked element. */
export type BrowserProbeTarget = {
  tagName: string;
  className?: string;
  id?: string;
  text?: string;
  innerText?: string;
  textSnippet: string;
  selector: string;
  rect: BrowserProbeRect;
  framework?: BrowserProbeFramework;
  componentName?: string;
  sourceFile?: string;
  sourceLine?: number;
  /** `false` when the line came from a text match rather than the framework. */
  sourceLocated?: boolean;
  locateMode?: BrowserProbeLocateMode;
  outerHTMLSnippet?: string;
};

/** Payload of `__AR_MARKUP_RESULT__`: one drawn annotation box. */
export type BrowserProbeMarkup = {
  id: string;
  note: string;
  rect: { left: number; top: number; width: number; height: number };
  target: (Omit<BrowserProbeTarget, "rect" | "innerText" | "textSnippet"> & { stack: string[] }) | null;
};

export type BrowserDevtoolsLogEntry = {
  id: string;
  timestamp: number;
  level: "info" | "warn" | "error" | "network";
  category: "console" | "runtime" | "network" | "system";
  text: string;
  url?: string;
  line?: number;
  column?: number;
  stack?: string;
  /** `probe` marks the browser tooling's own bugs, not the page's. */
  origin?: "probe" | "page";
};

/** Localized copy the injected probe renders inside the page. */
export type BrowserProbeStrings = {
  dialogTitle: string;
  dialogHint: string;
  dialogDefaultNote: string;
  overlayTip: string;
  noTarget: string;
  cancel: string;
  confirm: string;
};
