# Chat timeline rail

Status: implemented · Surface: `apps/desktop` renderer (`features/chat`) · Scope: `ChatMain` (board **Agent** tab and the Workbench visual chat both render it)

## 1. Goal

A floating timeline on the right edge of an AI chat, where **every user or agent
answer is one point**. Hovering a point previews that message; clicking jumps the
feed to its anchor.

Constraints taken as given:

- No change to the data model. `ThunderChatMessage` carries no timestamp, only
  `stats.turn` / `stats.completion_tokens` / `stats.duration_ms`.
- No new IPC, no core change. The rail is pure renderer.
- It must work in both hosts, including the Workbench pane where the chat shares
  its column with other views.

## 2. What the code already had

| Fact | Where |
| --- | --- |
| Messages are `.tb-message-row` in order; the streaming turn is one extra row | `ChatMain.tsx` |
| Scroller is `.tb-chat-feed` (`overflow-y: auto`, 24px padding); content is `.tb-messages-container` (max-width 800, centred) | `styles.css` |
| `stickToBottom` ref + four `useLayoutEffect`s keep the newest content pinned | `ChatMain.tsx` |
| Historical sessions are rebuilt one assistant message per engine step | `useThunderChat.ts` `normalizeConversationMessages` |
| Header buttons already use `desktop.*` keys (`desktop.chat.changes.*`) | `ChatMain.tsx` |

Two facts drove the design:

1. **The feed is not virtualized.** Every row is in the DOM, so its real offset is
   measurable. This is what makes a true minimap possible instead of a guess.
2. **`scrollIntoView` is unusable here.** It also scrolls ancestors and the
   window, which is wrong when the chat is one column of the Workbench. The jump
   offset has to be computed from rects.

## 3. Design

```
.tb-chat-main
├── header / popovers                       (unchanged)
├── .tb-chat-body            ← new; position: relative; flex column
│   ├── .tb-chat-feed        ← unchanged scroller; rows carry data-timeline-index
│   └── .tb-chat-timeline    ← new; absolute, 20px wide, over the feed's padding
│       └── .tb-timeline-rail
│           ├── .tb-timeline-viewport     ← the visible slice of the conversation
│           ├── .tb-timeline-dots > button.tb-timeline-dot ×N
│           └── .tb-timeline-preview      ← hover / focus card
└── ChatComposer                            (unchanged)
```

### 3.1 Acceptance: it must not take layout width

The rail is `position: absolute` over the feed's own right padding, so the 800px
message column keeps its centring and no message can be covered. Two independent
checks in `ChatMain.test.tsx` pin this: the rail is a **sibling** of
`.tb-chat-feed` (so it cannot scroll away), and it is **not** inside it.

### 3.2 Point placement: a real minimap, not an index list

`computeRailDots` projects each row's measured `offsetTop` onto the rail:

```
ratio = offsetTop / (scrollHeight - clientHeight)
y     = ratio × (railHeight - dotSize)
```

The rail therefore shows where the conversation is dense — a 40-step answer
spreads out, a short exchange collapses to one point.

**Overlap handling.** Anchors whose projected gap is below `DEFAULT_MIN_GAP`
(14px, which is also the hit-box height in CSS) merge into the earlier dot,
which gains a `count` and is drawn as a 3×12 bar instead of an 8px point. The
merged dot's `y` is the **average** of its members, so it sits where the group
is rather than drifting to its first or last element. Clicking a merged dot
jumps to its first member; the preview says how many it stands for.

**One alternative was on the table and is 10 lines away:** an equidistant list
(`i / (n-1) × railHeight`) never merges and never overlaps, but says nothing
about where the reader is. `computeRailDots` is a pure function, so switching
is a one-hunk change with no effect on the component.

### 3.2.1 Pointer resolution belongs to the rail, not to the dots

A dense rail puts neighbouring dots closer together than any usable hit box, so
per-dot boxes would overlap and hover would land on whichever happened to be
later in the DOM. Instead:

- The **strip** (`.tb-timeline-rail`, full height, 20px wide) takes pointer
  events; the dots are `pointer-events: none`.
- `dotIndexAtPoint` resolves **nearest centre by distance**, so the whole rail is
  a target, every position is unambiguous, and moving the pointer up and down it
  scrubs through the conversation.
- Each dot is still a real `<button>` for focus and keyboard activation, so it
  keeps `title` / `aria-label`. Its own click can therefore bubble to the rail —
  the rail ignores any click whose `target` is not the strip itself, which is
  exactly the keyboard-synthesised case (`clientY: 0`, plus a duplicate jump).

### 3.3 Preview: ordinal, turn and duration — not a wall clock

`buildTimelineItems` produces `{ index, role, excerpt, turn, durationMs, isLive }`:

- **Ordinal** (`#7`) — always available.
- **`Turn n`** and **duration** from `stats`, when the daemon reported them.
- **Excerpt** — `excerpt()` drops fenced code blocks whole, unwraps inline code,
  links and list markers, collapses whitespace and truncates to 180 chars. The
  card clamps it to two lines: it is a signpost, not a reading pane.

**Deliberately not added: `receivedAtMs`.** Recording a receipt time in
`useThunderChat` would give new sessions `HH:MM` and leave every historical
session (rebuilt from disk) without it — the rail would then show times for some
conversations and not others. `stats` is the field that exists in both.

### 3.4 Jumping

```
target = rowTop - feedTop + feed.scrollTop - 12
```

then `feed.scrollTo({ top: target, behavior: "smooth" })`, with `"auto"` under
`prefers-reduced-motion`, and a plain `scrollTop` assignment where `scrollTo`
does not exist (jsdom).

`stickToBottom.current` is **re-derived from the target** before scrolling: if
the destination is the newest message the feed keeps following the stream,
otherwise following stops so the next commit cannot yank the reader back down.
`jumpToMessage` is the only writer of that ref outside the scroll handler and the
session-change effects.

### 3.5 Visibility

The rail renders an inert shell (`.is-empty`, `aria-hidden`, no dots, no
pointer events) and only becomes navigable when **all** hold: the rail has a
measured height, there are at least two entries, the projected dot list is
non-empty, and the feed actually scrolls. The shell has to exist even when
inert: it is the element the first measurement reads its own height from.

### 3.6 Keyboard

- The rail is **one** Tab stop (`role="toolbar"`, `aria-orientation="vertical"`).
- Within it: `ArrowUp` / `ArrowDown` wrap, `Home` / `End` jump to the ends;
  focus follows and shows the same preview hover does. `Enter` / `Space` on a
  focused dot activates it once — the rail's own click resolver stands aside
  because the target is not the strip.
- The active dot owns the tab stop; without one, the first dot does.
- The `title` and `aria-label` both carry the ordinal, so the control is
  announced as "Jump to message 7" rather than as a bare glyph.

## 4. Files

New:

- `features/chat/timelineModel.ts` — pure geometry and text model
- `features/chat/timelineModel.test.ts` — 32 cases
- `features/chat/ChatTimeline.tsx` — the rail
- `features/chat/ChatTimeline.test.tsx` — 17 cases
- this document

Changed:

- `features/chat/ChatMain.tsx` — `.tb-chat-body` wrapper, `anchorIndex` on both
  message rows, `timelineItems`, `jumpToMessage`, `<ChatTimeline />`
- `features/chat/ChatMessageItem.tsx` — `anchorIndex` → `data-timeline-index`
- `styles.css` — the rail block
- `features/chat/ChatMain.test.tsx` — 4 cases pinning the wiring
- `locales/{en,zh-cn,ja}.json` — `desktop.chat.timeline.*` (8 keys × 3)

Not touched: `packages/core`, `useThunderChat`, `preload`, main process, any IPC.

## 5. i18n

Keys live only in `apps/desktop/locales/*.json`, **not** in
`scripts/desktop-i18n-catalog.json` — same as `desktop.chat.changes.*`.
`merge-desktop-i18n.mjs` overlays the catalog onto those files without deleting
what is not in it, so a later `merge:desktop-i18n` will not drop these. Keys were
inserted with the file's existing `localeCompare` ordering so the one-line JSON
diff stays a one-line JSON diff.

`t()` here takes `(key, ...interpolationArgs)` — **not** `(key, fallback)`. A
fallback string as the second argument interpolates into `{0}` and produces
`"Turn Turn {0}{0}s"`. The repo has no fallback convention; the one place that
wants one wraps it (`ScheduleLiveRun`'s `const text = (key, fallback) => ready ? t(key) : fallback`).

## 6. Testing

jsdom has no layout: every `getBoundingClientRect` returns zeros, nothing
scrolls, and `ResizeObserver` / `matchMedia` / `scrollTo` do not exist. The
component guards each of those with `typeof`, and the tests install the
geometry the rail would see in a browser:

- `timelineModel.test.ts` — projection, merging (gap boundary, average position,
  live flag carried through), clamping against stale measurements, the
  zero-scroll case, active-anchor probe, jump offset, viewport indicator.
- `ChatTimeline.test.tsx` — a prototype-level `getBoundingClientRect` stub keyed
  on class / `data-timeline-index` (the rail does not exist until it renders, so
  instance mocking is too late), then: dot count, **placement follows measured
  offsets rather than order**, merge + count, preview contents, live marking,
  click target, nearest-dot resolution, scrub-to-preview, single jump on
  keyboard activation, active highlight + single tab stop, arrow/Home/End, the
  two inert cases.

## 7. Verification

```
pnpm run typecheck:desktop
pnpm --filter @agent-resume/desktop run test:renderer
pnpm run i18n:check                     # needs the pre-existing
pnpm run i18n:check:translations        # desktop.settings.agentStatus.* gap closed
pnpm run build:desktop
```

Manual, in both hosts: dots match the message count; spacing follows the real
document; a long conversation merges into a bar that says "N messages"; hover
previews role / ordinal / turn / duration; clicking scrolls the anchor under the
header **and stays there** while the answer keeps streaming; arrow keys walk the
rail; Reduce Motion removes the pulse and the smooth scroll.

## 8. Risks

| Risk | Handling |
| --- | --- |
| Measurement cost | One O(n) layout **read** pass per commit that changes `entries`; no writes, so no layout thrash. Sub-pixel churn is filtered by `MEASURE_EPSILON`. |
| Fighting auto-follow | The jump re-derives `stickToBottom` from the target; the four existing auto-scroll tests must stay green (they do). |
| Narrow panes | The rail is 20px over 24px of padding, and the merged-dot bar keeps the rail readable at any height. |
| Preview overlaying text | Transient, `pointer-events: none`, and clamped inside the rail's own height. |
| A stale measurement | `computeRailDots` clamps `ratio` to `[0, 1]`, so an out-of-date offset moves a dot, never deletes it or pushes it off the rail. |
