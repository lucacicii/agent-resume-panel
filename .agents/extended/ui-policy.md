# UI Policy

Extension and desktop are **independent UI products**. See [product-independence.md](product-independence.md).

## VS Code Extension

- Use VS Code TreeView, command, QuickPick, InputBox, and webview APIs before building custom interaction layers.
- Keep sidebar labels, command titles, settings-panel text, and webview UI strings in the extension i18n flow (`apps/extension/src/i18n/`, `apps/extension/src/webview/uiStrings.ts`, and `apps/extension/locales/*.json`).
- Preserve existing context-menu generation. Do not manually edit generated contribution blocks in `package.json` or `package-vscode.json`.
- VS Code extension and webview UI follow the VS Code platform design language. The macOS rules below do **not** apply to extension surfaces.

## Electron Desktop

The desktop app follows the [Apple macOS Human Interface Guidelines](https://developer.apple.com/design/human-interface-guidelines/designing-for-macos). There is no separate design-system document: the rules in this section are the authority, and `apps/desktop/src/renderer/styles.css` `:root` is the single source of design tokens.

### Native-first

The window is Chromium, but everything the operating system can draw must be drawn by the operating system.

- **Menu bar** — one application menu built in the main process (`installApplicationMenu` in `src/main/main.ts`) with File / Edit / View / Window / Help. Every keyboard shortcut the renderer implements must also be registered as a menu item accelerator, because on macOS the menu bar is where shortcuts are discovered. `Reload`, `Force Reload`, and `Toggle Developer Tools` are development-only (`!app.isPackaged`).
- **Context menus** — native `Menu.buildFromTemplate().popup({ window, x, y })` through the preload contract. A DOM menu is allowed only when the surface cannot be expressed as an `NSMenu` (tag grids, agent/model pickers, colour and icon pickers, scrolling lists), and then it must implement first-item focus, `ArrowUp`/`ArrowDown`/`Home`/`End`/`Enter`/`Escape`, type-select, `role="menu"` plus `role="menuitem"`, and edge flipping driven by `screen.getDisplayNearestPoint`. Never clamp a menu with `window.innerWidth - <constant>`.
- **Dialogs** — `dialog.showMessageBox` for alerts and confirmations (`type: "warning"`, cancel first, destructive action last, `cancelId`, `defaultId`). `window.confirm` / `window.alert` / `window.prompt` are forbidden: they are Chromium dialogs, not `NSAlert`. File and folder selection uses `dialog.showOpenDialog` / `dialog.showSaveDialog`, never `<input type="file">`.
- **Notifications** — Electron `Notification`, not `osascript`.
- **Menu bar item (Tray)** — a template image plus `setContextMenu`; a coloured status dot may be shown in addition, never as the only affordance.

### System appearance

- `nativeTheme.themeSource` follows the in-app appearance setting (`light` / `dark` / `system`), so native menus, alerts, window chrome, and scrollbars match the content. Every window sets `backgroundColor` from `windowAppearance.ts`.
- The system accent colour (`systemPreferences.getAccentColor()`) drives `--color-accent`, hover, focus ring, selection fills, and destructive colour at runtime. Do not hard-code `#007aff`.
- **Translucent chrome.** The board, workbench and Settings windows are non-opaque (`transparent: true` + `vibrancy: "sidebar"` + transparent `backgroundColor`), so their chrome and sidebars use the translucent `--color-sidebar-bg` token and the desktop shows through; content surfaces (`.gtd-board`, `.wb-detail`, `.settings-main`) paint themselves opaque so text stays readable. `markTranslucentWindow()` keeps `applyWindowBackgrounds()` from painting an opaque colour over them on an appearance change. Measured 2026-09 (`scripts/qa-pixels.mjs`): the toolbar reads `#1e1e1e` in an opaque build and `#292322` over the same wallpaper in this one, i.e. the desktop is really coming through.
- **Known platform gap:** the material itself does not blur on macOS 15.7 + Electron 43 — the chrome over a pure-white backdrop and over a dark one measured within noise, in light and dark appearance, with `vibrancy` alone, `vibrancy` + transparent `backgroundColor`, and `vibrancy` + `transparent: true`. So the pass-through is visible but **unblurred**. Do not drop the transparency because of that, and re-run `pnpm --filter @agent-resume/desktop` QA (`qa-capture.mjs` + `qa-pixels.mjs`) after an Electron upgrade to see whether the blur returns.
- `prefers-reduced-motion` disables transforms and transitions; `prefers-reduced-transparency` falls back to opaque surfaces; `systemPreferences.getAnimationSettings()` is available for main-process decisions.

### Windows

- Main, workbench, note, and browser windows use `titleBarStyle: "hiddenInset"`, `trafficLightPosition: { x: 14, y: 14 }`, `backgroundColor` from `windowAppearance.ts`, `show: false` + `ready-to-show`, and restored bounds. Window open/close is never animated.
- The window title is visible to the user (header text or the system title bar); document-like windows use `setDocumentEdited`, `setRepresentedFilename`, `app.addRecentDocument`, `open-file`, and `tabbingIdentifier`.
- Native fullscreen is handled: traffic-light inset padding and drag regions are removed while fullscreen.
- Settings is a real window (`mode=settings`, ⌘,), not a modal overlay with a backdrop. Closing it never touches the board behind it.
- Closing a window on macOS does not quit the app; `window-all-closed` keeps background work alive.

### Controls, type, and layout

- Design tokens are semantic CSS custom properties in `styles.css` `:root` (`--color-*`, `--space-*`, `--radius-*`, `--font-size-*`, `--duration-*`). New rules use tokens, never raw hex values.
- System font stack only (`-apple-system`), with an 11–15px ladder; no web fonts.
- Hit targets are 24×24px minimum, 28×28px for icon buttons. iOS patterns (bottom tab bars, FABs, 44pt targets, swipe-only navigation) are not used.
- Scrollbars stay system-managed: never override `::-webkit-scrollbar` globally; scope it to a surface only when that surface must own its scrollbar (for example the terminal).
- The arrow cursor is correct for buttons and list rows; `cursor: pointer` is reserved for links and link-like text.
- Icons go through `<ThemeIcon name="…" />` (lucide, one size ladder, one stroke weight). This is a deliberate deviation from SF Symbols; the single entry point is what keeps it consistent.
- Keyboard accessibility is mandatory: semantic buttons and inputs, `aria-label` plus `title` on icon-only controls, `aria-expanded` / `aria-pressed` / `aria-selected` state, visible `:focus-visible` rings, and Enter/Escape semantics in dialogs.

### Renderer boundaries

- The renderer is React (`src/renderer-react/`, entry `main.tsx`, bundled by `scripts/build-renderer-react.mjs`) and mounts into the host divs declared in `renderer/index.html`. Do not add a UI component library for an isolated change.
- `index.html` / `styles.css` own shell markup and presentation; `app.js` is legacy-only. New behaviour goes into React components.
- Desktop UI copy uses `desktop.*` keys in `apps/desktop/locales/`. Do not reuse extension `t()` catalogs or webview string files in the renderer.
- Render untrusted Markdown through the existing `marked` plus DOMPurify path. Do not assign external or user-authored HTML directly to `innerHTML`.
- New renderer capabilities require an explicit preload API and main-process IPC handler (registered with `safeHandle`). Do not expose Electron or Node primitives to the renderer.
- Keep controls keyboard-accessible and provide stable empty/loading/error states.

## Verification

After any desktop UI change:

- `pnpm run typecheck:desktop`
- `pnpm --filter @agent-resume/desktop run test:renderer`
- `pnpm run build:desktop` before distribution
- `pnpm run i18n:check` after locale or `t()` changes (update `scripts/desktop-i18n-catalog.json` first, then `pnpm run merge:desktop-i18n`)
- `pnpm --filter @agent-resume/desktop run dev:mac` on macOS, then walk the checklist below

### macOS conformance checklist

> Visual QA tip: Playwright's `connectOverCDP` defaults `colorScheme` to light. Clear the override (`page.emulateMedia({ colorScheme: null })`, which `scripts/qa-drive.mjs` does) before judging appearance, or force it on purpose with `scripts/qa-capture.mjs --light|--dark`. Otherwise the screenshot contradicts the window on screen and the app looks like it ignores the system appearance.

1. Menu bar: every shortcut appears in the menu bar; packaged builds have no Reload / DevTools.
2. Right-click works in text inputs, the editor, and the terminal (Cut/Copy/Paste/Spelling/Lookup/Services).
3. ⌘, ⌘W ⌘N ⌘S and the view shortcuts (⌘1…⌘n) do what the menu says.
4. Fullscreen: no leftover traffic-light padding, no dead drag region.
5. System accent colour and light/dark switch apply live, including native menus and alerts.
6. Reduce Motion and Reduce Transparency are honoured.
7. Sidebar shows real vibrancy over the desktop.
8. Menu bar item: template icon, left click opens a menu, right click works.
9. Dock: context menu present; dragging a note file onto the icon opens it.
10. Layout holds at 860px (minimum) and 1120px (default) window width.
