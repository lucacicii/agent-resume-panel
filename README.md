# Agent Resume Panel

Local VS Code extension for browsing and resuming Codex and Claude Code sessions from one sidebar.

## Features

- Reads Codex history from `~/.codex/state_*.sqlite`, with `session_index.jsonl` fallback.
- Reads Claude Code history from `~/.claude/history.jsonl` and `~/.claude/projects/**/*.jsonl`.
- Shows recent sessions and project groups in a VS Code side bar.
- Opens each resumed session in its own integrated terminal, shown in the editor area beside the current editor by default.
- Opens sessions in Ghostty when you need Ghostty image workflows.

## Commands

- `Agent Resume: Refresh`
- `Agent Resume: Search Sessions`
- `Agent Resume: Resume Session`
- `Agent Resume: Copy Resume Command`
- `Agent Resume: Open Folder and Resume`
- `Agent Resume: Open in Ghostty`

## Settings

- `agentResume.codexHome`: defaults to `~/.codex`
- `agentResume.claudeHome`: defaults to `~/.claude`
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

## License

MIT
