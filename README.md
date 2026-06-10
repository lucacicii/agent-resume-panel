# Agent Resume Panel

Local VS Code extension for browsing and resuming Codex, Claude Code, and Antigravity CLI sessions from one sidebar.

## Features

- Reads Codex history from `~/.codex/state_*.sqlite`, with `session_index.jsonl` fallback.
- Reads Claude Code history from `~/.claude/history.jsonl` and `~/.claude/projects/**/*.jsonl`.
- Reads Antigravity CLI history from `~/.gemini/antigravity-cli/history.jsonl` and falls back to Antigravity conversation files under `~/.gemini/antigravity`.
- Shows recent sessions and project groups in a VS Code side bar.
- Shows project names in the recent session list, so mixed-project history is easier to scan.
- Opens each resumed session in its own integrated terminal, shown in the editor area beside the current editor by default.
- Starts a new Codex, Claude, Antigravity CLI, or Codex App session in the current workspace from the Sessions title bar.
- Starts new Codex, Claude, Antigravity CLI, or Codex App sessions from a project group's right-click menu.
- Opens sessions in Ghostty when you need Ghostty image workflows.
- Resumes Codex sessions in Codex App from the session right-click menu.

## Commands

- Command Palette:
  - `Agent Resume: New Session`
    - Choose `Codex`, `Claude`, `Antigravity CLI`, or `Codex App`.
  - `Agent Resume: Search Sessions`
  - `Agent Resume: Refresh`
- Session right-click menu:
  - `Resume Session`
  - `Copy Resume Command`
  - `Open Folder and Resume`
  - `Open in Ghostty`
  - `Resume in Codex App` for Codex sessions
- Project right-click menu:
  - `Open Folder and Resume`
  - `Open in Ghostty`
  - `New Codex Session`
  - `New Claude Session`
  - `New Antigravity Session`
  - `New Codex App Session`

## Codex App

- `New Codex App Session` opens the selected project with `codex app <projectPath>`.
- `Resume in Codex App` is shown only for Codex sessions. It first resumes the session in a VS Code terminal, then sends `/app` to hand the active session to Codex App.

## Settings

- `agentResume.codexHome`: defaults to `~/.codex`
- `agentResume.claudeHome`: defaults to `~/.claude`
- `agentResume.antigravityHome`: defaults to `~/.gemini`; scans `antigravity-cli` and `antigravity` subdirectories
- `agentResume.maxItems`: defaults to `500`
- `agentResume.terminalLocation`: defaults to `editorBeside`; set to `panel` for the bottom terminal panel
- `agentResume.enableVsCodeTerminalImagesHint`: defaults to `true`
- `agentResume.ghosttyExecutable`: defaults to `Ghostty`
- `agentResume.ghosttyLaunchMode`: defaults to `pasteCommand`; set to `copyCommand` for manual paste, or `executeCommand` if you accept Ghostty's macOS execution confirmation
- `agentResume.ghosttyAutoPasteDelayMs`: defaults to `900`
- `agentResume.showArchivedCodex`: defaults to `false`

## Images

VS Code's integrated terminal can render Sixel and iTerm inline images when `terminal.integrated.enableImages` is enabled, but it is not a full replacement for Ghostty's image workflow. Use `Agent Resume: Open in Ghostty` for sessions where you need Ghostty-specific image upload or display behavior.

On macOS, Ghostty shows a security confirmation when another app asks it to execute `/bin/zsh` directly. To avoid that dialog, the default `Open in Ghostty` behavior opens Ghostty in the project folder, copies the resume command to your clipboard, pastes it into Ghostty, and presses Enter. This uses macOS automation, so the first run may require granting Accessibility or Automation permission. Set `agentResume.ghosttyLaunchMode` to `copyCommand` for manual paste or `executeCommand` if you prefer Ghostty's direct execution path.

## Development

```sh
npm install
npm run compile
```

Open this folder in VS Code and run the extension host launch target, or package it with:

```sh
npm run package
```

For local install testing after extension changes:

```sh
npm run install:local
```

Reload VS Code after local install with `Developer: Reload Window`; the extension's own refresh command only reloads session data.

## License

MIT
