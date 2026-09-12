# Agent Status — herdr-parity plan (Desktop)

Status: in progress (stages 0–5 landed; every agent the app resumes has its own rules)
Owner surface: `apps/desktop` only. The extension keeps ACP-native status only.
Reference implementation studied: [herdr](https://github.com/herdrdev/herdr) — `src/detect/*`,
`src/pane/agent_detection.rs`, `src/integration/*`.

## Decisions (agreed)

1. **App 关闭后仍要感知** → 常驻 `agent-status` daemon。
2. **在线 LLM 裁决下线** → 删除 `statusJudge` / `prompt` / judge IPC / `llmOptions.sessionStatus`;
   质量改由离线挖掘 + 夹具黄金测试保证。
3. **一次性发布** → 阶段 0~8 在单分支完成,阶段 5 起 dev 构建 dogfood ≥5 工作日,之后一次出包。
4. **D2(PTY 所有权迁进 daemon)不做** — 本次不追求"agent 在 App 退出后继续运行"。
5. **daemon 默认随登录启动**,设置面板显式可关 + 一键卸载。

## Architecture

Sensor / evaluator split. The process that owns the PTY is the only one that can see the
screen, so it senses; judgement is centralised so there is exactly one truth.

```
Electron main (sensor, PTY-bound)
  ptyHost.ts            raw PTY bytes (AR sequence stripped before forwarding to xterm)
  agentStatus/mirror.ts @xterm/headless screen mirror            (stage 2)
  agentStatus/scan.ts   OSC 0/2 title, OSC 9;4 progress, DEC 25  (stage 2)
  sensors/processTable  ps table: identity + foreground group    (stage 3)
        │ telemetry.publish (unix socket, JSON lines)
        ▼
agent-status daemon (evaluator, always on, Electron-free)
  server.ts             unix socket transport + subscriptions
  state.ts              snapshot, native reports, state.json persistence
  engine/*              manifests, regions, single-authority arbitration (stage 4)
  integrations/*        hook install + report entry point          (stage 6)
  notify.ts             macOS notification while the app is closed (stage 7)
        │ status.changed events
        ▼
renderer (UI only): dots, rollups, explain panel
```

### Capability matrix (must stay in sync with the acceptance checklist)

| Scenario | Own-pane screen | Native hooks | External agents |
| --- | --- | --- | --- |
| App running | ✅ | ✅ | ✅ |
| Window closed (macOS stays in Dock) | ✅ | ✅ | ✅ |
| App fully quit, daemon alive | ❌ (PTY died with the app) | ✅ | ✅ |
| Daemon stopped | ❌ | ❌ | ❌ |

The third row is why D2 is a separate product decision: state awareness for our own panes
cannot outlive the PTY that hosts them.

## Wire protocol (v2)

Transport: `unix` domain socket at `<panelHome>/.desktop/agent-status/daemon.sock`,
JSON lines, directory `0700`, socket/endpoint `0600`. No TCP listener on purpose —
a loopback port is reachable from any browser page, a unix socket is not.

```ts
type Request =
  | { id: string; method: "hello"; params: { apiVersion: number; role: "app" | "cli" | "test"; appVersion?: string } }
  | { id: string; method: "telemetry.publish"; params: PaneTelemetry }
  | { id: string; method: "pane.report_state"; params: NativeReport }
  | { id: string; method: "pane.forget"; params: { paneId: number } }
  | { id: string; method: "status.snapshot"; params: {} }
  | { id: string; method: "status.explain"; params: { paneId: number } }
  | { id: string; method: "status.subscribe"; params: {} }
  | { id: string; method: "daemon.shutdown"; params: { reason: string } };
```

Responses: `{ id, ok: true, result }` | `{ id, ok: false, error: { code, message } }`.
Pushes: `{ event: "status.changed", data: StatusSnapshot }` | `{ event: "daemon.shutting_down", data }`.

`endpoint.json`: `{ apiVersion, appVersion, pid, socketPath, startedAt, updatedAt }` — read by
the app, by tests, and by the `agent-resume-status` CLI that hooks call.

## Files

| Path | Role | Stage |
| --- | --- | --- |
| `src/main/agentStatus/types.ts` | protocol + snapshot vocabulary | 0 ✅ |
| `src/main/agentStatus/paths.ts` | panel-home paths + launchd label | 1 ✅ |
| `src/main/agentStatus/endpoint.ts` | atomic endpoint/socket/state file IO | 1 ✅ |
| `src/main/agentStatus/server.ts` | unix socket transport, subscriptions | 1 ✅ |
| `src/main/agentStatus/client.ts` | request/subscribe client | 1 ✅ |
| `src/main/agentStatus/state.ts` | snapshot + native reports + persistence | 1 ✅ (derivation is the stage-4 seam) |
| `src/main/agentStatus/daemon.ts` | daemon entry, single instance, handshake | 1 ✅ |
| `src/main/agentStatus/lifecycle.ts` | app-side spawn / handshake / launchd install | 1 ✅ |
| `src/main/agentStatus/mirror.ts` | `@xterm/headless` screen mirror | 2 ✅ |
| `src/main/agentStatus/scan.ts` | OSC title/progress, cursor, AR sequence (+ chunk carry) | 2 ✅ |
| `src/main/agentStatus/screen.ts` | screen prompt fingerprint (stage-4 placeholder for manifests) | 2 ✅ |
| `src/main/agentStatus/derive.ts` | verdict order + anti-flicker hysteresis | 2 ✅ |
| `src/main/agentStatus/sensor.ts` | mirror + scan + process table → telemetry | 2 ✅ |
| `src/main/agentStatus/bridge.ts` | reconnect-safe link to the daemon | 2 ✅ |
| `src/main/agentStatus/ipc.ts` | renderer snapshot surface | 2 ✅ |
| `src/shared/agentStatusTypes.ts` | cross-process status vocabulary | 2 ✅ |
| `src/main/agentStatus/identity.ts` | process → agent, interpreter unwrapping, session hint | 3 ✅ |
| `src/main/agentStatus/processTable.ts` | `ps` table: job control + argv for identity | 3 ✅ |
| `src/main/agentStatus/engine/*.ts` | manifest, region, evaluate, arbitrate | 4 ✅ |
| `src/main/agentStatus/engine/manifests/*.json` | per-agent rules + generic base layer | 4–5 ✅ |
| `src/main/agentStatus/integrations/*.ts` | claude / codex / pi / opencode hooks | 6 |
| `src/renderer-react/.../sessionStatus/useAgentStatus.ts` | UI subscription | 7 |
| `scripts/agent-status-daemon.test.mjs` | daemon lifecycle + protocol test | 1 ✅ |
| `scripts/agent-status-mine.mjs` | offline rule mining and triage (dev only) | 5 ✅ |
| `scripts/agent-status-capture.mjs` | capture a pane's screen into fixtures | 5 ✅ |

## Stages

| # | Content | Exit criteria | Days |
| --- | --- | --- | --- |
| 0 | Contracts + fixture corpus + capture script | types frozen, ≥5 real screen samples | 1 |
| 1 | Daemon skeleton: single instance, endpoint, launchd, handshake, socket, `state.json`; app-side ensure; packaged-app check | daemon survives app quit, restarts clean, `test:agent-status` green | 4–6 ✅ |
| 2 | Sensor: `@xterm/headless` mirror + scan in main, telemetry to daemon, renderer subscribes; delete `probe.ts` / `statusJudge.ts` / `prompt.ts` / renderer `store.ts` | status correct with the Workbench tab unmounted | 3–5 ✅ |
| 3 | Identity + foreground process group (`tpgid`); global discovery deferred to stage 7 | every pane reports its agent | 3–4 ✅ |
| 4 | Rule engine (region / priority / all-any-not / `visible_*` / `skipStateUpdate`), single authority, `status.explain` | verdicts explainable rule-by-rule | 4–6 ✅ |
| 5 | Manifests for claude / codex / pi / opencode + offline mining + local override dir | fixture suite green, no online LLM in the runtime path | 5–8 ✅ |
| 6 | Hook integrations + `agent-resume-status` CLI + settings toggle | uninstall restores user config byte-for-byte | 5–8 |
| 7 | UI: dots, rollups, notifications (incl. app-closed), explain panel | "who is stuck" visible and actionable | 4–5 |
| 8 | One-shot release: dogfood, acceptance, CHANGELOG, i18n, pack + notarize | DMG verified on a clean machine | 3–5 |

Total: 32–48 dev-days.

## Verification

| Level | How |
| --- | --- |
| daemon lifecycle | `pnpm --filter @agent-resume/desktop run test:agent-status` (single instance, handshake, 0600 perms, telemetry→snapshot, seq ordering, persistence, shutdown) |
| engine golden tests | `fixtures/screens/**` × `expected.json` → `test:agent-status` (stage 4+) |
| integration | `pnpm run test:desktop` (daemon script added to the chain) |
| packaging | `pnpm run pack:desktop`, then verify daemon start, hook connectivity, and uninstall cleanup with the notarized build |
| types / strings | `pnpm run build:desktop`, `pnpm run merge:desktop-i18n && pnpm run i18n:check && pnpm run i18n:check:translations` |

## Stage 2 notes (landed)

- **The renderer holds no detection state.** `sessionStatus/store.ts` (660 lines), `resolver.ts`,
  `fingerprint.ts`, `protocol.ts` and `react.ts` are gone; what remains is `useAgentStatus`
  (daemon snapshot → dots), `useAcpStatus` (ACP lifecycle, which never leaves the app), and the
  `AgentState` → `SessionDotStatus` projection.
- **The daemon owns derivation.** `derive.ts` is a faithful port of the old resolver order
  (native > process > streaming output > screen fingerprint > running window > idle) plus the
  anti-flicker hysteresis, so behaviour is unchanged while the source of truth moved. Stage 4
  replaces the fingerprint branch with manifests and deletes `screen.ts`.
- **The renderer no longer receives PTY tails.** `terminal:activity`, `onTerminalActivity`, the
  activity throttle, and the renderer's tail buffer are gone: main mirrors the screen itself, so
  background panes are sensed without any renderer participation.
- **`@xterm/headless` is a new dependency** (pure JS, no native build) and needs
  `allowProposedApi: true` to read `terminal.buffer`; the mirror flushes before snapshotting because
  xterm parses queued writes asynchronously.
- **A pane's session is bound from the renderer** (`terminal:bindSession`, plus `sessionKey` on
  `terminal:spawn`) because main only knows the PTY while the renderer knows the session — and the
  session can resolve after the pane was spawned.
- **Shell-integration command markers were dropped, not moved.** `protocol.ts` parsed OSC 633
  `A`/`C`/`D`, but nothing in the app ever emitted them (the injected shell integration only reports
  `633;P;Cwd`, and nothing reads that). The surviving exact signal is the agent status sequence.
- **Dev builds now run the daemon too** — stopped on quit, opted out with
  `AGENT_RESUME_AGENT_STATUS_DAEMON=0` — so development sees real status instead of nothing.

## Stage 3 notes (landed)

- **Identity is derived, not declared.** `identity.ts` names a pane's agent from the process tree,
  with `cli:<provider>` from the session key as a fallback hint. The executable map covers every
  agent the app can resume (`claude`, `codex`, `pi`, `opencode`, `grok`, `cursor-agent`, `agy`,
  `prime-agent`), which is also why `AgentKind` was widened from four values to those eight.
- **Interpreter unwrapping is required in practice, not in theory.** `claude`, `codex`, `opencode`
  install as native binaries, but `pi` installs as a `#!/usr/bin/env node` script: `ps comm` reports
  `node`, and only argv carries the name. Verified on this machine. `ps -Ao pid=,args=` is therefore
  read as a second pass and joined by pid — two `ps` calls, because `comm` may contain spaces and
  cannot be delimited from `args` in one pass.
- **Foreground job control replaced the descendant heuristic.** `ps` `tpgid` gives the terminal's
  foreground process group, so "a command is running" is now the kernel's answer instead of "some
  descendant is not the agent". The shell, the identified agent, and our injected MCP bridge are
  excluded; anything else in the group is a tool. The failure mode is the safe one: when a probe
  cannot see a terminal, nothing is running and the derivation falls back to output and screen.
  `apps/desktop/scripts/process-foreground-baseline.mjs` proves it on a real pty.
- **`identity.ts` sits between the two pure layers** (`processTable.ts` mechanics, `derive.ts`
  policy); the sensor orchestrates, so neither layer knows about the other's vocabulary.
- **Global discovery of external agents was deferred to stage 7** (deviation from the first draft).
  The primitives it needs — identity plus a process table — land here, but its consumers
  (notifications and the tray while the app is closed) do not exist yet, and a daemon that records
  panes nobody reads is exactly the kind of unused machinery this repo avoids. Stage 7 is then a
  thin addition: scan, exclude owned pids, register the rest.

## Stage 4 notes (landed)

- **Rules are data, and the engine is small**: `manifest.ts` (schema + compile), `region.ts`
  (which slice of the screen), `evaluate.ts` (gates, priority, evidence), `registry.ts` (which
  manifest applies, with the `generic` fallback), `arbitrate.ts` (the trust order). The hard-coded
  `screen.ts` fingerprint is gone; its heuristics now live in `manifests/generic.json`.
- **Schema choices that carry their weight**:
  - `atLeast` — "at least N lines look like options" is what separates a menu from prose containing
    an arrow. It is the declarative form of the old evidence counting.
  - `cursorHidden` — a hidden cursor (DEC 25) corroborates a single option line.
  - one gate = *all* conditions; `any` holds alternatives as separate gates. Inside a gate, `regex`
    means every pattern must match, so pattern *lists* are written as sibling gates (the nav-hint rule
    is verbose on purpose).
  - patterns and `contains` are case-insensitive: the same TUI copy changes case between versions,
    and matching is about shape, not spelling.
- **Vetoes before alternatives**: `not` gates are evaluated before `any` short-circuits. Found by a
  unit test: a rule with both a matching `any` alternative and a matching `not` gate was accepted.
- **One evaluation per frame, then hysteresis**: the daemon runs the rules when telemetry arrives (not
  on every snapshot read) and advances hysteresis at that single frame boundary, so reading
  `status.snapshot` or `status.explain` can never change a verdict.
- **`visibleBlocker` changes the trust order** — a dialog the agent is drawing *now* outranks the
  output that drew it; ordinary rule matches stay below fresh output. `visibleIdle` clears a held alert
  immediately instead of waiting out the miss streak.
- **`skipStateUpdate` is about the screen, not the pane**: a viewer keeps the last published state
  (`lastState`), which is why `PaneRecord` tracks it.
- **The golden fixture harness landed with the engine** (`fixtures/<agent>/<case>.txt` +
  `expected.json`), so stage 5 only has to add data: it fails today if a manifest has no fixtures.
- **Deferred to stage 5**: the marker-based regions (`prompt_box_body`,
  `after_last_prompt_marker`). They only make sense once per-agent rules define what a marker is, and
  writing them untested now would be speculation. The region set that exists is fully unit-tested.

## Stage 5 notes (landed)

- **Rules are layered, not duplicated.** `generic` is the base layer and runs for every pane; an
  agent manifest adds what only its UI needs. Per-agent rules are listed first, so a priority tie
  goes to the agent, and `explain` reports both layers. Copying the dialog rules into each agent
  file (herdr's approach) was rejected because it guarantees drift.
- **Four manifests landed** (`claude`, `codex`, `opencode`, `pi`), with the UI literals taken from
  herdr's captured manifests and re-expressed in this schema. Priorities sit above the base where a
  rule is more specific, and claude's dialog rules deliberately outrank its title spinner: a box the
  agent is drawing now is stronger evidence than a title glyph (herdr ranks them the other way).
- **Fixtures pin the winner, not the author's intent.** One codex fixture is won by a base rule
  (`yn_permission` claims the `[y/n]` prompt the agent rule was written for), and one claude dialog is
  won by `bash_permission_prompt` because the form rule needs a navigation hint that screen does not
  have. The expectations record what actually happens, and `agent-status:mine` fails when that stops
  being true.
- **Local overrides**: `<panelHome>/.desktop/agent-detection/<agent>.json` replaces the bundled
  manifest with the same id (`source: "override"`). An invalid override is ignored with a warning
  rather than disabling detection.
- **`pane.screen` + API v2.** A daemon left running from an older build keeps its old behaviour, and
  the protocol shape is the only thing an app can check — so adding a method bumps
  `AGENT_STATUS_API_VERSION`, which makes the app replace the daemon on upgrade. Learned the hard
  way: a stale daemon answered `status.snapshot` happily and rejected the new method.
- **Two offline tools replace the deleted online judge**:
  `agent-status:capture` writes the exact bytes the engine judged into `fixtures/<agent>/` and prints
  the `expected.json` entry; `agent-status:mine` triages fixtures and captured screens (verdicts,
  stale expectations, screens no rule matches) and, with `--propose`, asks the configured tool model
  for one candidate rule to review. The LLM helps author rules offline; it never runs in a status tick.
- **Deviation: the per-agent fixtures are reconstructions.** They were written from herdr's captured
  shapes rather than live captures, because authoring them needs an authenticated TUI session. The
  capture script exists so dogfooding replaces them; "one fixture per real screen" stays the
  standing discipline.
- **Still deferred**: marker-based regions. The agent rules use `bottom_non_empty_lines(n)` and
  `after_last_horizontal_rule`, and their fixtures pin that behaviour; a marker region is worth adding
  only once a real screen proves the approximation insufficient.

## Deviations from the first draft (and why)

- **The socket lives in the per-user temp dir, not under the panel home.** Unix socket paths are capped
  at ~104 bytes on macOS, so `<panelHome>/.desktop/agent-status/daemon.sock` breaks outright for a long
  user name or a long panel-home path (found while writing the test: `listen EINVAL`). The socket is now
  `<tmpdir>/agent-resume-status-<uid>-<profile-hash>.sock`, while `endpoint.json` / `state.json` /
  `daemon.log` stay under the panel home. The endpoint file remains the discovery source of truth and
  records the real socket path, so nothing else has to care.
- **No asar rule added to `mac-app.mjs`.** The packaged app already spawns the pure-Node MCP CLI
  from inside `app.asar` with `ELECTRON_RUN_AS_NODE=1` (`mcpRegistration.ts`), which proves the
  pattern works here; `resolveDaemonEntryPath` keeps an `app.asar.unpacked` candidate as a
  fallback. Packaging is still verified explicitly in stage 1/8.
- **Unix socket instead of the loopback HTTP used by the browser MCP server.** Hooks are our own
  scripts, so we do not need TCP; avoiding a loopback port removes the local-CSRF surface.
- **Packaged builds keep the daemon alive on app quit** (`performQuitCleanup` only stops it in dev
  builds), which is what makes hook reporting work while the window is closed.
- **Dev builds stop the daemon on quit** (`AGENT_RESUME_AGENT_STATUS_DAEMON=0` disables it
  entirely), so `pnpm run dev` does not leave an orphan; packaged builds start it unconditionally and
  never stop it.

## Known cosmetic issues

- The daemon imports the `@agent-resume/core` barrel, which pulls in `node:sqlite` and prints Node's
  SQLite experimental warning into `daemon.log`. Harmless, but a narrow `@agent-resume/core/panel-home`
  export (plus a `moduleResolution` upgrade in the desktop tsconfig) would remove the noise.
- `pnpm run i18n:check:translations` fails on 589 pre-existing `desktop.*` keys that have no ja
  translation (mostly `desktop.agent.*`). Unrelated to this work: none of the removed status keys
  appear in the report.
- `FloatingSessionNote.test.tsx`, `NotesPanel.test.tsx` and `i18n.test.tsx` can lose a race under
  full-suite load (a `waitFor` timeout for the two find tests; React flushing the effect that adds
  `i18n-ready` for the third, where the class only drives CSS anti-FOUC). All pass in isolation and
  on a re-run; wrapping those assertions in `waitFor` would make the suite deterministic.

## Open risks

| Risk | Mitigation |
| --- | --- |
| Screen sensing moves into main and behaviour drifts | stage 2 feeds the existing logic first; the engine swap happens in stage 4 |
| `@xterm/headless` differs from `@xterm/xterm` rendering | pin the same 5.5.x line; golden fixtures compare identical screens |
| Hook installation damages user config | ownership marker + deep-diff test + backup into panel home before the first write |
| Remote/override manifests as untrusted input | compile-validate rules, per-rule evaluation timeout, agent allow-list |
| launchd daemon annoys users | visible toggle, one-click uninstall, no secrets on disk, never touches other user config |
