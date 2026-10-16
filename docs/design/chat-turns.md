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
  numbered circles on the agent's own reply;
- clicking a circle shows **all** of that turn's thinking and tool calls;
- a turn that **failed** is drawn red, and a turn's colour otherwise says what it
  did — tools or thinking;
- the **running turn gets no circle**, because it is already on screen.

A session reopened later shows the same thing, because thunder now writes the
transcript turn-shaped (§3.1.2) — the dots and the thinking they hold are the
run's own record, not the renderer's memory of it.

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
| A turn read back from disk: one assistant message per engine turn, each carrying its own `reasoning` and its `stats.turn` | `packages/core/src/thunder/types.ts`, and `docs/architecture.md` §16.1 in the thunder repo |

## 3. Design

```
.tb-chat-body
├── .tb-chat-feed            ← scrolls; the running turn streams in it
│   └── .tb-messages-container
│       └── .tb-message-row.is-assistant      ← the run's reply
│           ├── .tb-message-avatar
│           └── .tb-message-container
│               ├── .tb-turn-dots             ← new; the pile, first block
│               │   └── .tb-turn-dots-track
│               │       └── .tb-turn-dot  (one per *finished* turn, piled)
│               └── .tb-message-bubble        ← the answer text
└── .tb-turn-overlay-mask / .tb-turn-overlay  ← the drawer, absolute over the pane
```

The pile is the reply's **first block**, so it lands right after the avatar and
above that reply's own text: a run's history belongs to the agent's answer, not
to the pane. Which row leads with it is `ChatMain`'s call — the streaming row
while the run is live, the reply's own row once it is over. `ChatMessageItem`
takes it as a `turnDots` slot so the message component stays ignorant of turns.

### 3.1 Only finished turns get a dot

`TurnDots` filters `status !== "running"` and pairs each survivor with its index
in `turns`, so the drawer — keyed by that index plus the pile it came from — is
not renumbered by the filter. When the only turn is the running one, the row
renders nothing at all rather than an empty strip.

The running turn is deliberately kept out: it is on screen in the feed, so a dot
for it would be a second, staler copy of the same thing. The drawer's arrows
still walk into it, and read its **live** segments rather than the frozen copy it
holds — the magnifier that path always had.

### 3.1.1 The pile outlives the run

When the run ends, `finalizeSessionTurn` settles its turns (the last turn of a
run that never saw `turn_end` has to flip out of "running" for its dot to appear
at all) and hands them to the row it appends: `messages[last].turns`. The answer
text is all that message shows — no `segments`, no `reasoning`, no
`tool_executions` — because all three have a home in the pile, and a second flat
copy under the reply is exactly the wall this feature exists to remove. Two
consequences worth knowing:

- The chat's file-change derivation reads tools off the messages, so it now falls
  back to the run's turns when the live segments are gone (`ChatMain`), keeping a
  finished run's touched files visible without the flat copy.
- A run that opened **no** turn at all (an error before the first event) still
  takes the old path: its message carries the segments, since there is no pile to
  hold them.

The turns stay on the session stream as well, so a drawer left open on the
running turn keeps working across the boundary instead of blinking shut.

### 3.1.2 A run read back from disk is the same row

That row is not a live-only shape: it is the shape a run has on disk, which is
why reopening a session paints the same thing the run looked like when it
finished. Thunder writes **one assistant message per engine turn** — its text,
its `tool_calls`, its chain-of-thought `reasoning`, its `stats.turn` — with that
turn's tool results after it, so a run is a stretch of consecutive assistant
messages between the user messages that bracket it.

`buildConversationRows` (exported from `useThunderChat.ts`, where the disk shape
is read) folds that transcript into feed rows, in two passes over the messages:

- tool results are absorbed into the call that produced them, as before;
- consecutive assistant messages become **one** row: a run. Its `turns` are
  synthesized from the messages — `stats.turn` numbers the dot, `reasoning`,
  text and tool calls become the turn's segments in that order, `stats` supplies
  duration and tokens — and its `content` is the turns' text glued in the order
  the stream produced it, which is exactly what the run's row held while it was
  live.

Alongside those, three deliberate moves:

- the flat `reasoning` / `tool_calls` are dropped from the row, and
  `ChatMessageItem` suppresses the flat lanes for any row that carries turns
  (`pileHoldsDetail`), so a reopened run cannot paint a second, staler copy of
  what its dots hold;
- `tool_executions` is **kept**, as the run's union: nothing paints it, but the
  file-change scan has nowhere else to read a run's touched files from;
- `stats` is dropped: it describes one turn, and the row stands for all of them.
  The numbers move to the dot's tooltip and the drawer's header chip.

Every reply on the feed therefore owns its pile — not just the last one — and
`ChatMain` keys the open drawer by `{ pile, index }`, where a pile is a message
row's turns or the stream's (`"live"`).

The dot's `turn` comes from `stats.turn` when it is there, and from the turn's
position in the run when it is not: a run cut short before a turn's `turn_end`
flushes that turn without stats.

### 3.2 The pile

The dots overlap instead of sitting in a row:

- `gap: 0` plus `.tb-turn-dot + .tb-turn-dot { margin-left: -9px }`. What gets
  covered is the previous dot's right side, which is outside its number: the
  number sits at the dot's **left** (`justify-content: flex-start`,
  `padding-left: 2px`) because that is the part a pile leaves visible — the
  newest dot, which nothing covers, centres its number in the whole circle
  instead (`:last-child`). 9px is as far as the pile can close: half a dot
  (12px) reads better as a stack, but the covering dot's edge then eats into a
  **two-digit** turn number, and runs reach turn 10 long before they stop. A dot
  is 24px — a two-digit number needs the room, and it is the hit-target minimum.
- **The colour says what the turn did**, not just that it finished:
  `.is-tools` (green, `--color-success`) for a turn that ran a tool,
  `.is-thinking` (orange, `--color-warning`) for one that only thought and
  answered. It is `TurnDots`'s `kindOf`, one class per dot, and a failed turn
  keeps its kind — the `.is-error` rule is what paints it red. The distinction is
  not colour-only: the tooltip and `aria-label` state the tool count.
- Orange, not the thinking blocks' blue accent: shoulders together in a pile, two
  blues 9px apart read as one smudged mark, while blue against orange stays
  legible at the size a pile actually is. The colour is a **kind** colour, not a
  status one, which is why it does not reuse `--color-warning`'s "something needs
  attention" meaning — nothing in the pile is a warning.
- **Each dot glows in its own colour.** `.tb-turn-dot` declares
  `--turn-glow: transparent` and a shadow built from it — `0 0 0 1px` (a hairline
  rim, which is what makes the halo read as light rather than blur) plus
  `0 0 5px` — and each kind sets the variable to its own colour at 32%
  (`--color-success` / `--color-warning`, 45% for the error's red). One variable
  is what lets `:focus-visible` and `.is-open` re-state the whole shadow with
  their own ring in front of the glow instead of dropping it. A dot with no kind
  has no halo.
- Paint order is plain DOM order — later turns sit on top — which is exactly what
  a pile should look like, and needs no `z-index`.
- A dot's fill is `color-mix(…, var(--color-window-bg))` rather than
  `color-mix(…, transparent)`: an **opaque** fill is what lets a dot cover the one
  behind it instead of blending into it. Both were tried against a rendered strip;
  the translucent version merged the pile into one mass.
- A failed turn is a **solid** `--color-destructive` disc with its number knocked
  out to `#fff`, and it keeps DOM order like every other dot. Tinted, its red is a
  neighbour of the thinking dots' orange; a fill is what separates them, and a fill
  survives being half-covered. It used to pierce the pile (`z-index: 40`) for fear
  of a buried red *ring* — but a dot drawn over its successor covers the successor's
  number, which sits in the dot's left crescent for exactly this reason, and an
  unlabelled sliver of a dot is a worse outcome than a red circle with a bite out
  of its right side. Rendered side by side at 3.2× and 1×: the bite is invisible
  next to the missing number.
- Hover and `:focus-visible` take `z-index: 60` and grow the dot out of the pile
  (`translateY(-2px) scale(1.08)`), the way the timeline rail's dots answer a
  hover. They deliberately do **not** recolour it: the later-rule-wins order is
  what keeps a pointed-at dot green, orange or red, and the accent ring stays the
  mark of the open turn. `:focus-visible` draws the rail's `--color-focus-ring`
  halo in front of the dot's own glow.
- The track's `--space-1-5` padding is the pile's clip margin
  (`overflow-x` makes the vertical axis clip too), sized for the widest thing a dot
  draws outside its own box: the glow's 5px spill plus its 1px rim. The focus ring
  and the lift fit inside that.
- It scrolls sideways inside the reply's column (`min-width: 0` on the track)
  instead of widening the message row, and keeps the newest dot in view.
- No caption: the numbers carry the meaning on screen, and a "Turns" label at the
  top of a reply reads as chrome. The i18n string stays as the row's accessible
  name.

### 3.3 The drawer

`TurnDetailOverlay` is `position: absolute` inside `.tb-chat-body`, from 40% of
the pane's height down, so the message flow never reflows under it and the
composer stays reachable. The mask is `z-index: 20`; the pile is `z-index: 22`
and is therefore **the drawer's own control** — clicking a different dot switches
turns rather than dismissing the drawer. That matters more now: the pile lives
inside the scrolling feed, and the reply it hangs off sits under the mask
whenever the feed is pinned to the bottom, so the pile has to out-paint the mask
to stay clickable. `position: relative` (no stacking context in between) is what
makes that `z-index` count. `←` / `→` walk the run's turns, `Esc` closes, and the
open dot's second click closes it too.

## 4. Files

| File | What |
| --- | --- |
| `features/chat/TurnDots.tsx` | `TurnDots`, `kindOf` (the dot's colour), `describeTurn`, `TurnDetailOverlay` |
| `features/chat/ChatMessageItem.tsx` | The `turnDots` slot: the pile renders as the reply container's first child; suppresses the flat thinking/tool lanes on a row that carries turns |
| `features/chat/ChatMain.tsx` | Which pile each row leads with (its own turns, or the stream's while live) and the drawer below it; clears the open drawer when the conversation switches or the stream's turns empty; falls back to the run's turns for the file-change derivation |
| `features/chat/useThunderChat.ts` | The turn model (§2), `RenderedChatMessage.turns`, the pile's survival past `finalizeSessionTurn` (§3.1.1), and `buildConversationRows` (§3.1.2) |
| `src/renderer/styles.css` | `.tb-turn-dots*`, `.tb-turn-overlay*` |
| `packages/core/src/thunder/types.ts` | `turn` on observations, `finish_reason` on `turn_end`, `reasoning` + `stats.turn` on a persisted assistant message |

## 5. i18n

`desktop.chat.turns.{label,turnN,toolCount,statusDone,statusError,statusRunning,openHint,prev,next,empty}`
— all ten in all three locales. `statusRunning` survives the "no dot while
running" rule because the drawer still labels a running turn.

## 6. Testing

`ChatMain.test.tsx` → *ChatMain turn dots*: one dot per finished turn with the
failed one marked and each dot carrying what its turn did (tools or thinking), the
running turn left out of the pile yet still reachable (and reading live segments)
from the drawer's arrows, switching between turns and closing on a second click, no
row when the run's only turn is the running one, the pile rendering inside the
agent row after its avatar, the pile staying on the answer once the run is over
(off the row's own turns, and still opening them), and two runs each opening their
own pile. `ChatView.test.tsx` covers the hand-over end to end: after
`loop_complete` the reply leads with the dot, carries no tool groups or thinking,
and one click brings them back in the drawer — and a conversation read back from
disk arrives as one reply per run, its turns piled into dots whose colours come
from what each turn persisted. The colours themselves are CSS, so the tests assert
the kind class (`is-tools` / `is-thinking`), never a colour value.
`useThunderChat.test.tsx` covers the model: splitting on `turn_start`, splitting
on payload turns alone, freezing on a turn change, `error` marking the current
turn, a finished run handing its turns to the pile while its answer stays
segment-free, every turn's thinking surviving a cancel, and the read-back fold —
run boundaries at the user messages, glued text, per-turn numbering (falling back
to position without stats), thinking and tools moved into the turns, and the tool
calls kept on the row for the file-change scan.

## 7. Verification

```bash
pnpm run typecheck:desktop
pnpm --filter @agent-resume/desktop run test:renderer
pnpm run i18n:check
```

## 8. Risks and known gaps

- **A turn read back from disk is always "done".** Nothing persisted says how a
  run ended, so a failed turn's dot is not red after a reload — only the run the
  renderer watched paints its failure. Persisting the run's `finish_reason` (or
  the turn's own) with the transcript is the fix.
- **A run is whatever sits between two user messages.** That covers every run
  today, because a run starts from a user message — including a `steering` or
  `followUp` one, which therefore splits the row in two. A run that continued
  across a mid-run user message would read back as two runs.
- **Conversations written before thunder's turn-shaped transcript fall back to
  one turn per assistant message.** The numbers then come from position, so an
  old conversation's dots are right; only its turn numbers can differ from the
  run's own (`stats.turn` is what fixes them).
- **`tool_executions` sits on a folded row without being painted.** It is there
  for the file-change scan, which reads the whole run's calls off the message;
  `turns` is the only thing the row paints.
- **The dots are 24px, not 20px.** A 10-plus-turn run's number needs the room to
  stay clear of the dot covering it, and 24px is the hit-target minimum.
- **The drawer is keyed by `{ pile, index }`.** A row's pile is stable, but the
  stream's is not: a new run clears `liveTurns` before filling them, and
  `ChatMain` closes a `"live"` drawer on that empty frame so an index cannot
  survive into a run it does not belong to.
- **The run's row carries no segments.** Anything that used to read a finished
  run's thinking or tools off the message has to read the turns now; the
  file-change derivation is the one such reader and does exactly that.
- **Orange thinking dots are neighbours of the error red.** Tinted, the two hues
  are close, so what separates them is the failure's *fill* — solid red with a
  white number — rather than its hue. A palette change that lightens
  `--color-destructive` (or darkens `--color-warning`) reopens that question. The
  failed dot is also covered on its right by the dot after it, like every other
  dot: the price of not swallowing that dot's number (§3.2), and the reason the
  red is a fill that can afford to be bitten.
- **Every dot's glow is set by eye.** The 32% / 5px pair was chosen against a
  rendered strip at 3.2× and 1×, light and dark; it is a judgement, not a
  measured value, and it is the one part of §3.2 that a render cannot verify.

