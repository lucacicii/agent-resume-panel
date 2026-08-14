# BrowserPane — LLM-operable browser (Workbench + standalone window)

> Design decision record for Agent Resume Desktop.  
> Status: **P0 + P0b + P1 + TUI external MCP implemented** (the product owner, 2026-08-14). Human browser + pop-out/dock + `agent-resume-browser` local HTTP MCP for ACP + stdio proxy for CLI/TUI when `exposeExternalMcp` (default true). P2 policy UI / always-allow-per-host still pending.  
> Scope: Desktop only (`apps/desktop`). Does not change the VS Code extension product surface.

Related:

- Workbench pane model: `apps/desktop/src/renderer-react/features/workbench/WorkbenchPanel.tsx`
- ACP session create/restore (`mcpServers: []` today): `apps/desktop/src/main/acp/agentConnection.ts`
- Existing data MCP (notes/sessions/flow — separate service): `packages/core/src/mcp/server.ts`, `agent-resume-desktop-doc/mcp.md`
- Permission prompts: `apps/desktop/src/main/acp/handlers/permission.ts`
- Multi-window precedents: Settings auxiliary window + standalone note windows in `apps/desktop/src/main/main.ts`

---

## 1. Goal

Add a **visible, interactive browser** that an ACP agent can drive through a **narrow tool surface**, hostable in **both**:

1. **Workbench embedded pane** (fourth tab group `browser`)
2. **Standalone browser window** (pop-out, multi-monitor friendly)

…without:

- polluting the app UI Electron session
- silently taking over the user's daily Chrome identity
- exposing full CDP / `eval` to the model by default
- forking two independent browser engines for the same logical session

One-line product intent:

> One `BrowserSession` (isolated partition + tabs + agent tools) can be shown in Workbench **or** a dedicated window; chrome/state stay in sync; the live `WebContentsView` is attached to exactly one surface at a time.

---

## 2. Decisions (locked)

| # | Decision | Choice |
|---|----------|--------|
| D1 | Ship vehicle | **In-app `WebContentsView`** (main process), not system Chrome by default |
| D1b | Host surfaces | **Workbench pane + standalone `BrowserWindow`**, both first-class |
| D1c | Dual-surface model | **Single live view, reattach** (not two mirrored WebContents) |
| D2 | LLM interface | **Dedicated MCP-shaped tool server** `agent-resume-browser` (not folded into the 31-tool `agent-resume` data MCP) |
| D3 | ACP wiring | Fill `mcpServers` on session new/restore (today hard-coded `[]`) when settings allow |
| D4 | Login state (v1) | **Manual login inside agent browser** + **persistent partition** |
| D5 | Chrome cookie auto-sync | **Never** (no background / full-profile sync) |
| D6 | Chrome cookie import | **Not in v1**. Optional **P3+ opt-in, per-host, always-confirm** import only |
| D7 | Observation channel | Prefer **accessibility snapshot + ref ids**; screenshots secondary |
| D8 | External stdio MCP for browser | **On by default** (`exposeExternalMcp`); stdio proxy reads endpoint file; Desktop must be running |
| D9 | `browser_eval` / raw CDP | **Off by default**; never covered by always-allow |
| D10 | headless screenshot screenshots | Stay on headless Chrome CLI; do not route through BrowserPane |
| D11 | Pop-out default | User/agent can open either surface; **pop-out does not clone** the session |

---

## 3. Architecture

```
                         ┌── agent-resume-browser tools (ACP / optional stdio)
                         │
                    BrowserController (main)  ── owns BrowserSession + WebContentsView(s per tab)
                         │
          ┌──────────────┴──────────────┐
          │ attachment: one active host │
          ▼                             ▼
   Workbench host                 Standalone host
   (mainWindow bounds             (BrowserWindow
    over BrowserPane)              mode=browser)
          ▲                             ▲
          │   browser:event (state)     │
   BrowserPane chrome            BrowserWindow chrome
   (url/tabs/policy)             (same chrome components)
```

```
┌──────────── Main window ────────────┐     ┌──── Browser window (optional) ────┐
│ Workbench: session|terminal|code|   │     │  BrowserChrome + content bounds     │
│ browser (pane may be placeholder    │     │  query=agent-browser:{browserId}   │
│ when popped out)                    │     └────────────────────────────────────┘
│ AcpChatPane ── tools ──► same BrowserSession either way
└─────────────────────────────────────┘
```

**Ownership:** browsing engine + session state live in **main**. Renderers only draw chrome, report bounds, and request attach/detach.

**Critical Electron constraint:** a `WebContentsView` has a single parent. “Workbench and window both support it” means **both can host**, not that the same pixels are painted in two places at once. Sync = shared `BrowserSession` state + chrome; live page = one attachment.

**Backend interface** (swap later without UI rewrite):

```ts
interface BrowserBackend {
  createTab(url?: string): Promise<string>;
  navigate(tabId: string, url: string): Promise<void>;
  snapshot(tabId: string, opts: SnapshotOpts): Promise<BrowserSnapshot>;
  screenshot(tabId: string): Promise<Buffer>;
  click(tabId: string, target: { ref: string } | { x: number; y: number }): Promise<void>;
  type(tabId: string, target: { ref: string }, text: string, opts?: { submit?: boolean }): Promise<void>;
  dispose(): Promise<void>;
}
```

| Backend | Role |
|---------|------|
| `ElectronWebContentsBackend` | **Default** — visible in-app browser |
| `PlaywrightCdpBackend` | Optional later — attach dedicated Chrome profile (not main profile by default) |

---

## 4. Data model

### 4.1 Workbench pane (renderer)

Extend:

```ts
type WorkbenchPaneGroup = "session" | "terminal" | "code" | "browser";

type BrowserPane = {
  key: string;                 // browser:${id}
  title: string;
  group: "browser";
  browserId: string;
  projectPath: string;
  boundRecordId?: string;      // ACP chat binding; optional for human-only browsing
  startUrl?: string;
  /** Mirrors main: where the live view is attached */
  surface: BrowserSurface;
};
```

Keyboard group cycling (⌘↑ / ⌘↓) includes `browser` when non-empty.

When `surface.kind === "window"`, the Workbench tab remains as a **dock placeholder** (title + “Show in window” / “Return to Workbench”) so the session stays in the strip and can be pulled back.

### 4.2 Main session

```ts
type BrowserSessionId = string;

/** Where the live WebContentsView is parented right now */
type BrowserSurface =
  | { kind: "workbench"; windowId: number }  // main window id
  | { kind: "window"; windowId: number };    // standalone browser window id
  // future: | { kind: "hidden" } for headless tool-only runs

type BrowserTab = {
  tabId: string;
  url: string;
  title: string;
  favicon?: string;
  loading: boolean;
  canGoBack: boolean;
  canGoForward: boolean;
};

type BrowserSession = {
  id: BrowserSessionId;
  projectPath: string;
  /** Electron session partition, e.g. persist:agent-browser:<projectHash> */
  partition: string;
  tabs: BrowserTab[];
  activeTabId: string;
  createdAt: number;
  /** Live attachment — single active host */
  surface: BrowserSurface;
  owners: Array<
    | { kind: "acp"; recordId: string }
    | { kind: "mcp-client"; clientName: string }
  >;
  policy: BrowserPolicy;
};

type BrowserPolicy = {
  allowHosts: string[];     // empty => first navigation prompts
  blockHosts: string[];     // e.g. payment hosts
  allowDownloads: boolean;
  allowPopups: boolean;
  snapshotMode: "a11y" | "dom-lite" | "screenshot";
  maxTabs: number;          // default 6
};
```

### 4.3 Settings (`desktop.browser`)

```ts
type DesktopBrowserSettings = {
  enabled: boolean;
  partitionMode: "per-project" | "shared";
  defaultPolicy: BrowserPolicy;
  /** Inject agent-resume-browser into ACP session/new + restore */
  injectIntoAcpSessions: boolean;
  /** Register stdio MCP for external agents (off by default) */
  exposeExternalMcp: boolean;
  /** status/snapshot/screenshot/wait auto-allow */
  autoAllowReadTools: boolean;
  /**
   * Where a newly created BrowserSession attaches first.
   * "workbench" | "window" | "last-used"
   */
  defaultSurface: "workbench" | "window" | "last-used";
  /** Remember last bounds per browserId for standalone windows */
  restoreWindowBounds: boolean;
  /**
   * P3+ only. When false (default), import tools are absent from tools/list.
   * Never enables background sync.
   */
  chromeCookieImport: {
    enabled: boolean;
    maxHostsPerImport: number; // default 5
    allowSessionCookies: boolean;
  };
};
```

**Defaults:**

```json
{
  "desktop": {
    "browser": {
      "enabled": true,
      "partitionMode": "per-project",
      "injectIntoAcpSessions": true,
      "exposeExternalMcp": true,
      "autoAllowReadTools": true,
      "defaultSurface": "workbench",
      "restoreWindowBounds": true,
      "chromeCookieImport": {
        "enabled": false,
        "maxHostsPerImport": 5,
        "allowSessionCookies": true
      },
      "defaultPolicy": {
        "allowHosts": [],
        "blockHosts": ["*paypal.com", "*alipay.com", "*stripe.com"],
        "allowDownloads": false,
        "allowPopups": false,
        "snapshotMode": "a11y",
        "maxTabs": 6
      }
    }
  }
}
```

Partition naming:

- `per-project` → `persist:agent-browser:<sha256(projectPath)[0:12]>`
- `shared` → `persist:agent-browser`

Storage lives under Electron's userData partition area; treat as **agent credentials** in backup/docs warnings.

---

## 5. IPC contract

### Lifecycle

| Channel | Direction | Payload |
|---------|-----------|---------|
| `browser:create` | invoke | `{ projectPath, startUrl?, boundRecordId?, surface?: "workbench" \| "window" }` → `BrowserSession` |
| `browser:destroy` | invoke | `{ browserId }` |
| `browser:list` | invoke | → session summaries |
| `browser:attachBounds` | invoke | `{ browserId, rect, windowId }` — only honored if this window is the active surface |
| `browser:setVisible` | invoke | `{ browserId, visible }` — workbench host hide when tab group inactive |
| `browser:setSurface` | invoke | `{ browserId, surface: "workbench" \| "window", bounds?: Rectangle }` — **pop-out / dock** |
| `browser:focus` | invoke | `{ browserId }` — focus host window + active tab |

### Human chrome

Same channels work from **either** renderer (main Workbench or standalone window). Main resolves `event.sender` → window; mutating chrome always goes through `BrowserController` so both UIs stay consistent.

| Channel | Purpose |
|---------|---------|
| `browser:navigate` | URL bar |
| `browser:back` / `forward` / `reload` / `stop` | Navigation |
| `browser:newTab` / `closeTab` / `activateTab` | Tabs |
| `browser:setPolicy` | Allow/block host edits |
| `browser:clearCookies` | `{ browserId, hosts?: string[] }` — user or tool |

### Events (`browser:event`)

Broadcast to **main window and any open browser window** for that `browserId` (same pattern as multi-window settings fan-out):

```ts
type BrowserEvent =
  | { type: "state"; session: BrowserSession }  // includes surface
  | { type: "surface"; browserId: string; surface: BrowserSurface }
  | { type: "console"; browserId: string; tabId: string; level: string; message: string }
  | { type: "permission"; requestId: string; action: string; detail: unknown }
  | { type: "download"; browserId: string; filename: string; state: "started" | "done" | "blocked" }
  | { type: "crash"; browserId: string; reason: string };
```

---

## 6. Tool surface (`agent-resume-browser`)

Keep the tool list **small and stable** — rename cost is high.

### 6.1 v1 tools

| Tool | Side effect | Notes |
|------|-------------|-------|
| `browser_status` | read | session/tabs/url/title/loading/**surface** |
| `browser_open` | write | ensure session; optional url, projectPath, `surface?: "workbench"\|"window"` |
| `browser_set_surface` | write | pop-out / return to Workbench (`workbench` \| `window`) |
| `browser_navigate` | write | host policy applies |
| `browser_snapshot` | read | **primary** observation (a11y tree + `ref`) |
| `browser_screenshot` | read | secondary; sized down |
| `browser_click` | write | prefer `{ ref }` |
| `browser_type` | write | `{ ref, text, submit? }` |
| `browser_fill` | write | clear + type |
| `browser_select` | write | `<select>` |
| `browser_press` | write | Enter/Tab/Escape… |
| `browser_wait` | read | text / url / load state |
| `browser_tabs` | read/write | list / new / close / select |
| `browser_clear_cookies` | write | optional hosts; always confirm if broad |

### 6.2 Explicitly not v1 tools

| Tool | Why |
|------|-----|
| `browser_eval` | Code exec surface; dev-only later |
| `browser_import_chrome_cookies` | P3+ opt-in only (§8) |
| `browser_sync_chrome_cookies` | **Never ship** |
| Network/CDP passthrough | Too wide |

### 6.3 Snapshot shape

```ts
type SnapshotNode = {
  ref: string;       // short id for click/type
  role: string;
  name?: string;
  value?: string;    // password fields masked
  states?: string[];
  children?: SnapshotNode[];
};

type BrowserSnapshot = {
  url: string;
  title: string;
  mode: "a11y";
  nodes: SnapshotNode[];
  truncated: boolean;
};
```

Tool instructions (server `instructions` string):

1. Snapshot before acting; do not click blind coordinates unless snapshot lacks the control.
2. Re-snapshot after navigation or significant DOM change.
3. Prefer snapshot over screenshot.
4. Never echo cookie values, `Authorization` headers, or password field contents into chat.

### 6.4 Permission matrix

| Class | Tools | Default |
|-------|-------|---------|
| Read | status, snapshot, screenshot, wait, tabs(list) | Auto if `autoAllowReadTools` |
| Act | navigate, click, type, fill, select, press, tabs(new\|close) | ACP permission prompt; optional “Always allow for host X” |
| Dangerous | clearCookies (all), downloads, popups, eval, cookie import | Always prompt or deny; **not** covered by `alwaysAllowAgent*` |

Reuse existing `permissionRequest` / waiter flow in `acpHost.ts`.

---

## 7. ACP injection

Today:

```ts
const params = { sessionId: acpSessionId, cwd, mcpServers: [] as [] };
```

Target:

```ts
const mcpServers = buildSessionMcpServers({
  projectPath,
  recordId,
  settings
});
// includes agent-resume-browser when desktop.browser.injectIntoAcpSessions
```

Transport preference:

1. In-process / host-local if ACP SDK allows  
2. Else stdio via `ELECTRON_RUN_AS_NODE` + dedicated CLI flag (same pattern as data MCP registration — avoid second Dock icon)

Binding:

- Lazy-create `BrowserSession` on first browser tool call (or on pane open).
- Default `browserId` for tools = session owned by calling `recordId`.
- Closing chat pane does **not** destroy browser by default; user can Disconnect / Destroy.
- Tool calls must fail if caller is not in `owners`.

`buildSessionMcpServers()` is the generic seam for future desktop-local tools; browser is the first consumer.

### 7.1 TUI / external CLI (stdio proxy)

CLI sessions (Workbench TUI `cli:*`, Claude Code, Codex, …) do not receive ACP `mcpServers`. Instead:

1. Desktop main starts loopback HTTP `agent-resume-browser` and writes  
   `{panelHome}/.desktop/browser-mcp-endpoint.json` `{ url, token, port, pid, updatedAt }`.
2. Headless stdio proxy `packages/core/dist/mcp/browserCli.js` (launched with `ELECTRON_RUN_AS_NODE`) reads that file and forwards JSON-RPC, adding  
   `X-Agent-Resume-Project` (cwd) + `X-Agent-Resume-Record` (`mcp:<client>`) + optional `X-Agent-Resume-Client`.
3. When `desktop.browser.exposeExternalMcp` is true (default), Desktop registers service id **`agent-resume-browser`** on automatic clients (same pattern as data MCP `agent-resume`, separate entry).
4. If Desktop is not running, tools fail closed with a clear error (no endpoint file / unauthorized).

Ownership for external callers uses `owners: [{ kind: "mcp-client", clientName }]`, not ACP `recordId`.

---

## 8. Login / cookie policy (product)

### 8.1 v1 — recommended path (implement this)

```
User opens BrowserPane (or agent browser_open)
  → isolated persist partition (per project)
  → user logs in manually once in that pane
  → cookies/localStorage stay in agent partition
  → later agent turns reuse the same login
```

UI affordances:

- Address bar menu: **Clear cookies for this site** / **Clear all agent browser data for project**
- Status chip when partition has cookies for current eTLD+1: `Signed in (agent profile)`
- Docs: agent browser identity ≠ daily Chrome

### 8.2 Never

- Background or periodic sync from Chrome Default profile  
- `hosts: ["*"]` import  
- Writing cookies **back** into Chrome  
- Importing passwords / credit cards / Web Data  
- Returning raw cookie values through MCP tool results or transcript-friendly payloads  
- Attaching CDP to the user's **main** Chrome profile as the default login strategy  

### 8.3 P3+ optional — per-host import (design only until enabled)

Only if `desktop.browser.chromeCookieImport.enabled === true`:

- UI: **Import from Chrome for this site…** / **choose hosts…**
- Tool: `browser_import_chrome_cookies` with **required** `hosts: string[]` (max `maxHostsPerImport`)
- Every call: modal listing hosts + cookie counts; Allow once / Deny only (no global Always)
- Audit log: `~/.agent-resume-panel/browser-audit.jsonl`
- Implementation sketch (macOS): copy Cookies SQLite → decrypt via Keychain “Chrome Safe Storage” → `session.cookies.set` into agent partition → `flushStore`
- Document limits: no localStorage/IndexedDB; SSO may still step-up; Chrome must not exclusively lock the DB mid-copy

This remains **import**, not sync.

### 8.4 Alternative for hard sites (optional later)

Dedicated Chrome user-data-dir under `panelHome` + CDP backend — still **not** the daily profile.

---

## 9. Electron hosting

### 9.1 View creation (once per tab)

```ts
const ses = session.fromPartition(partition);
const view = new WebContentsView({
  webPreferences: {
    session: ses,
    sandbox: true,
    contextIsolation: true,
    nodeIntegration: false
  }
});
// Do NOT permanently parent to mainWindow — parent is switched by surface.
```

### 9.2 Dual surface: reattach (not dual paint)

```ts
async function setSurface(browserId: string, next: "workbench" | "window") {
  const session = get(browserId);
  const view = activeView(session);

  // 1) detach from current parent if any
  detachFromParent(view);

  if (next === "window") {
    const win = getOrCreateBrowserWindow(browserId); // Map like standaloneNoteWindows
    win.contentView.addChildView(view);
    view.setBounds(contentBoundsFor(win));
    session.surface = { kind: "window", windowId: win.id };
    win.show();
    win.focus();
  } else {
    const main = getMainWindow();
    main.contentView.addChildView(view);
    // bounds come from next browser:attachBounds from Workbench BrowserPane
    view.setVisible(false); // until pane reports rect
    session.surface = { kind: "workbench", windowId: main.id };
    main.focus();
  }

  broadcast({ type: "state", session });
  broadcast({ type: "surface", browserId, surface: session.surface });
}
```

Standalone window creation aligns with existing auxiliary windows:

| Precedent | Pattern to reuse |
|-----------|------------------|
| Settings window | Singleton-style host, `query: { mode: "settings" }`, separate shortcuts |
| Standalone notes | `Map<id, { window }>` , `query: { mode: "standalone-note", noteId }` |

Browser windows:

```ts
// query: { mode: "browser", browserId }
// Map<browserId, BrowserWindow>
// webPreferences: same preload family as main, but renderer route only mounts BrowserChrome shell
// — do NOT mount full WorkbenchPanel / PTY (same footgun as settings design doc)
```

### 9.3 What “同步支持” means

| Layer | Workbench | Standalone window | Synced? |
|-------|-----------|-------------------|---------|
| Cookie / storage partition | same `BrowserSession.partition` | same | **Yes** (identity) |
| Tabs / URL / title / loading | via `browser:event` state | via `browser:event` state | **Yes** |
| Agent tools | operate on `browserId` | same | **Yes** (surface-agnostic) |
| Address bar / back-forward UI | shared chrome actions → main | shared chrome actions → main | **Yes** |
| Live pixels / input focus | only if `surface.kind==="workbench"` | only if `surface.kind==="window"` | **One at a time** |
| Closing surface | dock placeholder or destroy | close window → default **return to Workbench** (not destroy session) | configurable |

**Not supported (v1):** two live mirrored pages (two WebContents) for one `browserId`. That would double memory, split focus, and desync agent click targets.

### 9.4 UX flows

1. **Open in Workbench** — default; tab group `browser`.  
2. **Pop out** — toolbar / tab context / `browser_set_surface(window)` → standalone window; Workbench tab becomes placeholder.  
3. **Return to Workbench** — window button or `browser_set_surface(workbench)` or closing window (default).  
4. **Open directly as window** — `browser:create({ surface: "window" })` or settings `defaultSurface: "window"`.  
5. **Multi-session** — multiple `browserId`s allowed; each may be workbench or window independently; one standalone window per `browserId` (focus existing if pop-out twice).

### 9.5 Rules

- Do **not** use deprecated `<webview>` tags for the product pane.
- Do **not** reuse the main window's default session.
- `setWindowOpenHandler` / `will-navigate` enforce `BrowserPolicy`.
- Downloads default off; if enabled, save under `panelHome/browser-downloads/`.
- Workbench host: on group switch away from browser, `setVisible(false)` so the view does not cover terminal/code.
- Standalone host: on minimize, keep session; on close → reattach workbench unless user chose Destroy.
- Permission prompts still render in **ACP chat** (main window); optional OS bounce/badge on browser window when a prompt is pending.
- Agent tools never need to know window geometry; snapshots/clicks hit the live WebContents regardless of surface.

---

## 10. File placement

```
apps/desktop/src/main/browser/
  types.ts
  policy.ts
  controller.ts
  surface.ts                    # attach/detach workbench vs window
  window.ts                     # BrowserWindow Map, bounds restore
  backend/types.ts
  backend/electron.ts
  ipc.ts
  mcpServer.ts
  cli.ts                         # --agent-resume-browser-mcp

apps/desktop/src/renderer-react/features/workbench/
  BrowserPaneView.tsx            # embedded + dock placeholder
  BrowserChrome.tsx              # shared chrome (also used by window route)
  # WorkbenchPanel.tsx — group + strip integration

apps/desktop/src/renderer-react/
  browserWindowApp.tsx           # mode=browser route (chrome only)

packages/core/src/settings/types.ts   # DesktopBrowserSettings
agent-resume-desktop-doc/browser.md   # user docs when shipping
```

Do **not** register browser tools inside `packages/core/src/mcp/server.ts` (that process is headless data MCP).

---

## 11. Phased delivery

| Phase | Deliverable | Done when |
|-------|-------------|-----------|
| **P0** | Controller + Electron backend + IPC + **Workbench** BrowserPane (human only) | Open URL, multi-tab, correct bounds/visibility |
| **P0b** | Standalone window host + `setSurface` pop-out/dock + state fan-out | Same session moves window ↔ Workbench without reload; chrome stays in sync |
| **P1** | Tool server + ACP `mcpServers` injection + snapshot/click/type + permissions + `browser_set_surface` | ACP chat can open a site and click via refs in either surface |
| **P2** | Policy UI, per-project partition persistence, always-allow-per-host, screenshot, window bounds restore | Daily logged-in-in-agent-profile workflows work |
| **P3** | Optional external stdio MCP; optional per-host Chrome import behind flag | **stdio MCP done** (endpoint file + browserCli proxy + client registration). Chrome import still open |
| **P4** | Console/network optional, download manager | Debug polish |

Login for P0–P2 = **manual in pane/window only**.  
P0 may ship Workbench-only if needed; **P0b is required before calling dual-surface “supported”.** Prefer implementing `surface.ts` early so P0 bounds API already takes `windowId`.

---

## 12. Security checklist

- [ ] Partition isolated from app UI session  
- [ ] Navigation gated by policy  
- [ ] Password values masked in snapshots  
- [ ] Cookie values never in tool responses  
- [ ] Owner binding on every mutating tool call  
- [ ] Dangerous tools excluded from always-allow  
- [ ] External browser MCP default off + warning copy  
- [ ] Audit any future Chrome import  
- [ ] Backup docs mention agent partition may hold session tokens  
- [ ] Standalone `mode=browser` renderer does not mount Workbench/PTY  
- [ ] `attachBounds` ignored from non-active surface (no cross-window bounds fight)

---

## 13. Non-goals

- Replacing system Chrome for daily browsing  
- Computer Use / OS-level mouse control as the browser agent  
- Full DevTools protocol for the model  
- Merging headless screenshot headless screenshot pipeline into BrowserPane  
- Silent or full-profile Chrome identity sync  
- **Dual live mirrored WebContents** for one `browserId` (two surfaces painting at once)  
- Arbitrary N browser windows per session (v1: **one** standalone window per `browserId`)

---

## 14. Implementation order (when coding starts)

1. Types + settings defaults (`defaultSurface`, `BrowserSurface`)  
2. `BrowserController` + Electron backend + IPC including `windowId` on bounds  
3. Workbench `BrowserPane` UI + bounds (P0)  
4. `surface.ts` + standalone `mode=browser` window + pop-out/dock (P0b)  
5. `buildSessionMcpServers()` seam  
6. Tool server + P1 tools + `browser_set_surface` + permission mapping  
7. Docs: `agent-resume-desktop-doc/browser.md` + Workbench README row  

Do not implement §8.3 import until P3 and an explicit product go-ahead on Keychain access UX.

---

## 15. Open points (defer until implement)

- Exact ACP SDK field shape for `mcpServers` entries (command vs in-process) — verify against current `@agentclientprotocol` / vendor adapters at implement time.  
- Whether partition data should appear in Desktop backup/export. Default lean: **exclude** until user opts in.  
- Close-window default: always dock vs ask once — default **dock** (preserve session).  
- Whether pop-out should auto-focus on agent `browser_navigate` when surface is window (lean **yes**).
