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
  allowDownloads: boolean;
  allowPopups: boolean;
  snapshotMode: "a11y" | "dom-lite" | "screenshot";
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
  | { type: "crash"; browserId: string; reason: string };
