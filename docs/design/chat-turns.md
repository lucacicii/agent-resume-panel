# Chat turns and the turn dots

Status: implemented · Surface: `apps/desktop` renderer (`features/chat`) · Scope: `ChatMain` (board **Agent** tab and the Workbench visual chat both render it)

## 1. Goal

Give a run's thinking and tool calls a unit. They used to arrive as one flat
sequence, so a long run was an undifferentiated wall and "what did the agent do"
could only be read for the last stretch of it.

The sketch that drove this:

- the feed shows the **running turn** — its thinking and tool calls — exactly as
  it always did;
- every **finished** turn is pulled out of the feed and piled into a stack of
  numbered circles above it;
- clicking a circle shows **all** of that turn's thinking and tool calls;
- a turn that **failed** is drawn red;
- the **running turn gets no circle**, because it is already on screen.

## 2. Where turn boundaries come from

Thunder tags every observation event with its turn number, which is what makes
the grouping possible at all. `useThunderChat` turns that into `LiveTurn`
(`turn`, `status`, `toolCount`, `durationMs`, `promptTokens`, `completionTokens`,
`startedAtMs`, `segments`).

| Fact | Where |
| --- | --- |
| `turn` on every observation event, `finish_reason` on `turn_end` | `packages/core/src/thunder/types.ts` |
| `ensureTurn` is driven by any event carrying a turn; `openTurn` publishes only when a turn really opens | `useThunderChat.ts` |
| `turn_end` freezes that turn and books its stats; `error` marks the current turn failed | `useThunderChat.ts` |
| `finalizeSessionTurn` settles a last turn whose `turn_end` never arrived | `useThunderChat.ts` |
| `rebuildTurns` replays boundaries from the main process's event buffer when the renderer remounts mid-run | `useThunderChat.ts` |
| Turns hang off `SessionStream`, next to `segments` — not React state, so a background session does not drive renders | `useThunderChat.ts` |

## 3. Design

```
.tb-chat-body
├── .tb-turn-dots            ← new; one row, above the feed
│   ├── .tb-turn-dots-label
│   └── .tb-turn-dots-track
│       └── .tb-turn-dot  (one per *finished* turn, piled)
└── .tb-chat-feed            ← unchanged; streams the running turn only
.tb-turn-overlay-mask / .tb-turn-overlay   ← the drawer, absolute over the pane
```

### 3.1 Only finished turns get a dot

`TurnDots` filters `status !== "running"` and pairs each survivor with its index
in `turns`, so the drawer — keyed by that index into `liveTurns` — is not
renumbered by the filter. When the only turn is the running one, the row renders
nothing at all rather than an empty strip.

The running turn is deliberately kept out: it is on screen in the feed, so a dot
for it would be a second, staler copy of the same thing. The drawer's arrows
still walk into it, and read its **live** segments rather than the frozen copy it
holds — the magnifier that path always had.

### 3.2 The pile

The dots overlap instead of sitting in a row:

- `gap: 0` plus `.tb-turn-dot + .tb-turn-dot { margin-left: -6px }`. What gets
  covered is the previous dot's outer 6px, which is outside its 10.5px number, so
  every turn stays legible however long the run is. A dot is 24px — the number of
  a 10-plus-turn run needs the room, and it is the hit-target minimum.
- Paint order is plain DOM order — later turns sit on top — which is exactly what
  a pile should look like, and needs no `z-index`.
- A dot's fill is `color-mix(…, var(--color-window-bg))` rather than
  `color-mix(…, transparent)`: an **opaque** fill is what lets a dot cover the one
  behind it instead of blending into it. Both were tried against a rendered strip;
  the translucent version merged the pile into one green mass.
- A failed turn takes `z-index: 40` and therefore **pierces** the pile: its red
  ring must never end up buried under the dots that come after it.
- Hover and `:focus-visible` take `z-index: 60` and grow the dot out of the pile
  (`translateY(-2px) scale(1.08)`), the way the timeline rail's dots answer a
  hover. They deliberately do **not** recolour it: the later-rule-wins order is
  what keeps a pointed-at dot green or red, and the accent stays the mark of the
  open turn. `:focus-visible` draws the rail's `--color-focus-ring` halo.
- The track's `--space-1-5` / `--space-1` padding is the pile's clip margin
  (`overflow-x` makes the vertical axis clip too), which is why the halo, the
  focus ring and the lift all fit.

### 3.3 The drawer

`TurnDetailOverlay` is `position: absolute` inside `.tb-chat-body`, from 40% of
the pane's height down, so the message flow never reflows under it and the
composer stays reachable. The mask is `z-index: 20`; the dots row is `z-index: 22`
and is therefore **the drawer's own control** — clicking a different dot switches
turns rather than dismissing the drawer. `←` / `→` walk the run's turns, `Esc`
closes, and the open dot's second click closes it too.

## 4. Files

| File | What |
| --- | --- |
| `features/chat/TurnDots.tsx` | `TurnDots`, `describeTurn`, `TurnDetailOverlay` |
| `features/chat/ChatMain.tsx` | Renders the row above the feed and the drawer below it; clears the open index when the conversation switches or the run's turns empty |
| `features/chat/useThunderChat.ts` | The turn model (§2) |
| `src/renderer/styles.css` | `.tb-turn-dots*`, `.tb-turn-overlay*` |
| `packages/core/src/thunder/types.ts` | `turn` on observations, `finish_reason` on `turn_end` |

## 5. i18n

`desktop.chat.turns.{label,turnN,toolCount,statusDone,statusError,statusRunning,openHint,prev,next,empty}`
— all ten in all three locales. `statusRunning` survives the "no dot while
running" rule because the drawer still labels a running turn.

## 6. Testing

`ChatMain.test.tsx` → *ChatMain turn dots*: one dot per finished turn with the
failed one marked, the running turn left out of the pile yet still reachable (and
reading live segments) from the drawer's arrows, switching between turns and
closing on a second click, and no row when the run's only turn is the running
one. `useThunderChat.test.tsx` covers the model: splitting on `turn_start`,
splitting on payload turns alone, freezing on a turn change, `error` marking the
current turn, an unsettled turn at finalize, and every turn's segments surviving
a cancel.

## 7. Verification

```bash
pnpm run typecheck:desktop
pnpm --filter @agent-resume/desktop run test:renderer
pnpm run i18n:check
```

## 8. Risks and known gaps

- **Turn boundaries only exist for a run this panel watched.** `rebuildTurns`
  reads the main process's in-memory buffer, so a session reopened after a
  restart has no turns and therefore no dots — its thinking and tools render flat
  in the message, the way they always did. Persisting boundaries with the message
  is the fix if it ever matters.
- **The strip is taller than it was.** A dot went 20px → 24px so that a 10-plus
  turn run's number stays clear of the dot covering it, and the bar is ~49px
  where it was 36. The pile only appears once a run has finished a turn.
- **The drawer's index is positional.** A new run clears the turns before filling
  them, and `ChatMain` closes the drawer on that empty frame so an index cannot
  survive into a run it does not belong to.
