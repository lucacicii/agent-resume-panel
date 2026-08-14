export type BrowserSessionId = string;
export type BrowserTabId = string;

/** Where the live WebContentsView is parented right now. */
export type BrowserSurface =
  | { kind: "workbench"; windowId: number }
  | { kind: "window"; windowId: number };

export type BrowserSurfaceKind = BrowserSurface["kind"];

export type BrowserTabState = {
  tabId: BrowserTabId;
  url: string;
  title: string;
  favicon?: string;
  loading: boolean;
  canGoBack: boolean;
  canGoForward: boolean;
};

export type BrowserPolicy = {
  allowHosts: string[];
  blockHosts: string[];
  allowDownloads: boolean;
  allowPopups: boolean;
  snapshotMode: "a11y" | "dom-lite" | "screenshot";
  maxTabs: number;
};

export type BrowserOwner =
  | { kind: "acp"; recordId: string }
  | { kind: "mcp-client"; clientName: string };

export type BrowserSessionState = {
  id: BrowserSessionId;
  projectPath: string;
  partition: string;
  tabs: BrowserTabState[];
  activeTabId: BrowserTabId;
  createdAt: number;
  surface: BrowserSurface;
  owners: BrowserOwner[];
  policy: BrowserPolicy;
};

export type BrowserRect = {
  x: number;
  y: number;
  width: number;
  height: number;
};

export type BrowserEvent =
  | { type: "state"; session: BrowserSessionState }
  | { type: "surface"; browserId: BrowserSessionId; surface: BrowserSurface }
  | {
      type: "console";
      browserId: BrowserSessionId;
      tabId: BrowserTabId;
      level: string;
      message: string;
    }
  | {
      type: "download";
      browserId: BrowserSessionId;
      filename: string;
      state: "started" | "done" | "blocked";
    }
  | { type: "crash"; browserId: BrowserSessionId; reason: string };

export type BrowserCreateArgs = {
  projectPath: string;
  startUrl?: string;
  boundRecordId?: string;
  surface?: BrowserSurfaceKind;
};

export const DEFAULT_BROWSER_POLICY: BrowserPolicy = {
  allowHosts: [],
  blockHosts: ["*.paypal.com", "*.alipay.com", "*.stripe.com"],
  allowDownloads: false,
  allowPopups: false,
  snapshotMode: "a11y",
  maxTabs: 6
};

export function normalizeUrlInput(raw: string): string {
  const value = raw.trim();
  if (!value) return "about:blank";
  if (value === "about:blank") return value;
  if (/^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(value)) return value;
  if (value.startsWith("//")) return `https:${value}`;
  return `https://${value}`;
}
