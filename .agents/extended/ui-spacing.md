# Desktop Spacing Spec (macOS HIG)

> Parent: [`.agents/extended/ui-policy.md`](ui-policy.md) § Controls, type, and layout.
>
> Scope: the Electron desktop renderer (`apps/desktop/src/renderer/`). The VS Code
> extension follows the VS Code design language and is out of scope.

The single source of truth for values is `styles.css :root`. This document defines
which token to use where so padding/margin/gap stay on one grid instead of drifting
into ad-hoc values.

## The grid

macOS lays out on an **8pt grid with a 4pt half step and a 2pt optical step**. Every
spacing value is one of these tokens — no raw `px` in `padding` / `margin` / `gap`:

| Token | Value | Grid step | Typical use |
| --- | --- | --- | --- |
| `--space-0-5` | 2px | optical | Icon/text nudge, hairline gaps between a label and its dot |
| `--space-1` | 4px | half | Tight control padding, row gaps in dense toolbars |
| `--space-1-5` | 6px | half | Default inline gap (list rows, cards, menu items) |
| `--space-2` | 8px | base | Default padding for rows, controls, small cards |
| `--space-2-5` | 10px | half | Card padding, search field insets |
| `--space-3` | 12px | base | Card padding, section inner padding |
| `--space-3-5` | 14px | half | Field/row padding where 12 is too tight |
| `--space-4` | 16px | base | Window/toolbar horizontal padding, pane head gaps |
| `--space-5` | 20px | base | Detail header padding, section margins |
| `--space-6` | 24px | base | Section separation, large card padding |
| `--space-8` | 32px | base | Page-level separation |

Primary rhythm is **8px** (`--space-2`); reach for a half step only when the base
step is visibly too loose. 18px / 22px / 28px / 36px are **off-spec** — snap them to
the nearest token.

### Off-grid migration

| Raw | Snap to | Raw | Snap to |
| --- | --- | --- | --- |
| 3px | 2px or 4px | 18px | 16px or 20px |
| 5px | 4px or 6px | 22px | 20px or 24px |
| 7px | 6px or 8px | 28px | 24px or 32px |
| 9px | 8px or 10px | 36px | 32px |
| 11px | 10px or 12px | | |

## Padding roles

Padding is a **vertical density + horizontal companion**. Pick the pair for the
component's role — do not invent new pairs. The values below are the prevailing
pairs measured in `styles.css` (2026-09) and match macOS control metrics.

| Role | Selectors (examples) | Padding | Rationale |
| --- | --- | --- | --- |
| Icon button (square) | `.icon-btn`, `.wb-icon-btn`, `.wb-git-action-btn`, `.wb-diff-back` | `--space-1-5` (6) | 28×28 hit target, centered glyph |
| Compact chip / badge | `.wb-task-status`, `.bell-badge` | `--space-0-5 --space-1-5` (2 6) | Dense single-line pill |
| Small control (compact) | `.wb-diff-mode-btn`, `.wb-search-scope` | `--space-1 --space-2` (4 8) | Dense toolbar button |
| Small control (regular) | `.tool-btn` | `--space-1-5 --space-2-5` (6 10) | Standard toolbar button |
| Standard control / field | `input`, `select` | `--space-1 --space-2-5` (4 10) | Text field, drop-down |
| Nav / list row (fixed height) | `.app-sidebar-row`, `.notes-view-row` | `0 --space-2` (0 8) | 32px row; density lives in `height` |
| Multi-line list row | `.wb-list-item` | `--space-2 --space-2-5` (8 10) | Two-line rows |
| Menu item | `.rail-account-menu-item`, `.chat-context-menu button` | `--space-1-5 --space-2-5` (6 10) | Native menu metrics |
| Card / tile | `.gtd-card` | `--space-2-5 --space-3` (10 12) | Card body |
| Column / panel | `.gtd-column` | `--space-3` (12) | Column inner |
| Pane head | `.notes-detail-head` | `--space-4 --space-5` (16 20) | Detail header |
| Content pane | `.gtd-board`, `.notes-view-detail` | inset `--space-2`, inner `--space-4` | Pane chrome |

Companion rule: **horizontal is the next token above the vertical density** —
`2→6`, `4→8`, `6→10`, `8→10`, `10→12`, `12→14`, `14→16`, `16→20`. A fixed-height
row uses `0` vertical (the height carries the density). Asymmetric padding is only
for icon/chevron insets (e.g. `0 --space-2-5 0 --space-3-5`) and must stay a single
intentional offset.

## Surfaces

Canonical values for the recurring chrome. New rules should match the row for the
surface they extend.

| Surface | Selectors (examples) | Padding / margin | Gap | Height |
| --- | --- | --- | --- | --- |
| Window toolbar / header | `.mac-top`, `.wb-window-header` | `0 --space-4` (+ `78px` traffic-light clearance) | `--space-2` | 52px |
| Nav sidebar | `.app-sidebar` | `--space-2` horizontal | — | — |
| Sidebar / list row | `.app-sidebar-row`, `.notes-view-row` | `0 --space-2` | `--space-1-5` | 32px |
| List search field | `.notes-view-search` | `0 --space-2-5 0 --space-3-5` | `--space-1-5` | 44px |
| Workbench list row | `.wb-list-item` | `--space-2 --space-2-5` (`0 --space-2` outer) | `--space-1-5` | — |
| Card | `.gtd-card` | `--space-2-5 --space-3` | `--space-1-5` | — |
| Detail / content pane | `.gtd-board`, `.notes-view-list`, `.notes-view-detail` | inset `--space-2` (`margin` on list/board, `padding` on detail) | `--space-2` | — |
| Detail header | `.notes-detail-head` | `--space-4 --space-5 --space-2` | `--space-4` | — |
| Popover / menu item | `.rail-account-menu-item` | `--space-1-5 --space-2-5` | `--space-2` | — |
| Control (button/input) | `.wb-git-action-btn`, `input` | `--space-1 --space-2-5` | `--space-2` | 24–28px hit target |

Content/detail panes use the macOS standard radius `--radius-xl` (10px) with an
`--space-2` inset so the corners read against the translucent window.

## Exemptions

Raw values are allowed **only** for these, and must carry a comment:

- **Hairlines** — `0.5px` / `1px` borders and separators (never on the grid).
- **Fixed chrome geometry** — the `78px` traffic-light clearance, dialog/panel
  widths (`272px`, `920px`, …), and scrollbar gutters.
- **Optical nudges** — a 1px transform or `margin-top: -1px` used to align glyphs,
  not to space layout.

Anything else should be a token.

## Checking

List raw spacing values that are neither `0`/`auto` nor an exempt hairline:

```bash
grep -nE '(padding|margin|gap|row-gap|column-gap)[^:]*:[^;]*(3|5|7|9|11|18|22|28|36)px' apps/desktop/src/renderer/styles.css
```

Every remaining hit is either an exemption (comment it) or a value to snap.

## Conformance

- All `padding` / `margin` / `gap` declarations use `var(--space-*)` except the
  exemptions above.
- Radius uses the `--radius-*` ladder; `--radius-xl` (10px) is the macOS window /
  content standard.
- New UI is reviewed against this table; do not introduce a new spacing value.
