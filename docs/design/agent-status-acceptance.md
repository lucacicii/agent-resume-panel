# Agent status — acceptance checklist

> Implementation spec: [`agent-status.md`](agent-status.md). Design history:
> [`agent-status-herdr-parity.md`](agent-status-herdr-parity.md).

One page to run before shipping the status plane (stage 8 of
[`agent-status-herdr-parity.md`](agent-status-herdr-parity.md)). Every line is a
thing a human has to look at; the automated suites are listed at the bottom.

## 1. Capability matrix (what "working" means)

| Scenario | Own-pane screen | Hook reports | Agents outside the app |
| --- | --- | --- | --- |
| App running, window visible | ✅ | ✅ | ✅ (listed, state from process evidence) |
| Window closed (macOS stays in Dock) | ✅ | ✅ | ✅ |
| App fully quit, daemon alive | ❌ (its PTYs are gone with the app) | ✅ | ✅ |
| Daemon stopped | ❌ | ❌ | ❌ |

The third row is the product statement: with the app quit we can still tell you
that an *external* agent is blocked, but our own panes no longer exist to sense.
Say so in release notes; do not imply otherwise.

## 2. Manual checks (macOS, packaged build)

Setup: build a DMG, install it, launch, then **Settings → Background status**.

1. **Daemon starts**: the pane shows `Running (pid …, API v2)`; `launchctl print
   gui/$(id -u)/dev.agentresume.agent-status` succeeds.
2. **Hooks install**: install for Claude Code and Codex; the rows switch to
   `Reporting`; the files gain entries pointing at
   `~/.agent-resume-panel/.desktop/agent-state/agent-resume-status-<agent>.sh`.
3. **Uninstall restores the file**: `diff` the agent config before and after
   install+uninstall — only our entries may differ, and after uninstall the file
   must be byte-identical to the backup.
4. **Codex hooks are trusted**: after installing, run `codex` once and approve the hook when it asks; `codex`'s hook list must show `trustStatus: trusted` for our five entries (until then they are registered but inert).
5. **Exact state with hooks**: in a workbench pane run `claude`, ask it to do
   something that needs approval → dot turns to *waiting* while the dialog is on
   screen; approve → back to *running*; finish → no dot.
6. **Rule state without hooks**: use an agent with no hook installed; its
   approval dialog must still produce *waiting* (rule `live_blocked_form` or its
   fallback) and the pane must not flicker while the TUI redraws.
7. **No false alarms**: sit in a plain Claude prompt for a minute; scroll back
   through a transcript containing the word "Allow" → the dot must stay off.
8. **Rules explain themselves**: Settings → Background status → Inspect on a
   blocked pane → matched rule, both manifest layers, per-rule reasons, and the
   screen text are shown; the screen text matches what the terminal displayed.
9. **Window closed**: close the window (`⌘W`), keep the app in the Dock, let an
   agent block → the tray/rail still shows the session; nothing is notified while
   a window is attached.
10. **App quit, external agent**: quit the app entirely, run `claude` in an
   external terminal (iTerm / VS Code), let it block → a macOS notification
   appears, and re-opening the app lists the external pane in the pane list.
11. **Daemon restart**: `kill` the daemon, reopen the app → it is replaced and
    status resumes; `state.json` survived (blocked panes stay blocked).
12. **Override a rule**: copy a manifest into
    `~/.agent-resume-panel/.desktop/agent-detection/<agent>.json`, change a
    priority, restart the daemon, confirm the inspector shows `source: override`.
13. **Diagnostics agree with reality**: `pnpm run doctor:desktop` reports the
    daemon pid/API version and the installed hooks.

## 3. Automated gates

| Gate | Command | Expected |
| --- | --- | --- |
| Engine + protocol | `pnpm --filter @agent-resume/desktop run test:agent-status` | all steps pass |
| Unit + golden fixtures | `pnpm --filter @agent-resume/desktop run test:renderer` | all pass |
| Desktop script suite | `pnpm run test:desktop` | 5/5 pass |
| Core library | `pnpm run test:core` | all pass |
| Strings | `pnpm run merge:desktop-i18n && pnpm run i18n:check` | check passes |
| Build | `pnpm run build:desktop` | manifests copied to `dist/.../engine/manifests` |
| Packaging | `pnpm run pack:desktop` | DMG starts, daemon spawns from inside `app.asar` |
| Fixture discipline | `pnpm --filter @agent-resume/desktop run agent-status:mine` | `0 stale` |

## 4. Fixture discipline (standing rule)

A misjudged pane is a bug with a missing test. The loop is:

```
pnpm --filter @agent-resume/desktop run agent-status:capture -- --pane <id> --name <case>
# add the printed expectation to engine/fixtures/expected.json
# fix the rule, then:
pnpm --filter @agent-resume/desktop run test:agent-status
```

Fixtures shipped with the first release were reconstructed from another project's
captured screens; replacing them with real captures from dogfooding is the first
maintenance task, not an optional one.

## 5. Known gaps to state in the release notes

- Windows is not supported for status (the probe needs POSIX process groups).
- OpenCode has no hook installer yet (its plugin registration differs across
  versions); it relies on screen rules and process identity.
- A pane's status cannot outlive the app for panes the app itself spawned —
  see the capability matrix.
