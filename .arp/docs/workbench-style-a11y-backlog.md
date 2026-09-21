# Workbench style / accessibility backlog

Authority: `.agents/extended/ui-policy.md` (macOS HIG section) + `.agents/extended/ui-spacing.md`.

**Status: all items resolved.** Fixed after `f83d859f`; see the resolution column
for the line to look at in `apps/desktop/src/renderer/styles.css` at the time of
writing. Kept as a record of what was wrong and how it was decided, so the same
details are not re-litigated.

---

## 1. Hit targets below spec — fixed

Policy: *"Hit targets are 24×24px minimum, 28×28px for icon buttons."*

| Selector | Was | Now |
| --- | --- | --- |
| `.wb-detail-tool` | `26×26` | `28×28` |
| `.wb-detail-project-reveal` | `22×22` | `24×24` |
| `.wb-terminal-tab-close` | `20×20` | `24×24` |
| `.wb-workbench-tab-close` | `20×20` | `24×24` |
| `.wb-session-git-review-btn` | ~19px tall | `min-height: 24px` |
| `.wb-session-git-commit-btn` | ~19px tall | `min-height: 24px` |

`.wb-diff-ask-agent` and `.wb-git-clean-action-btn` were already at 24px and
gained an explicit `min-height` so they cannot drift below it.

## 2. Raw values and non-existent tokens — fixed

- Added `--color-warning-subtle` (light + both dark blocks). The old fallback was
  a raw `rgba(234, 179, 8, 0.15)` for a token that never existed.
- Added `--color-button-text` (`#ffffff`). The old fallback was a raw `#ffffff`
  for a token that never existed. Existing accent-filled buttons still paint raw
  `#ffffff`; they can migrate to the token opportunistically.
- `.wb-detail-tool-badge` now uses `--color-warning`, `--color-button-text`,
  `--font-size-micro`, `--font-weight-bold`, and `--color-label-quaternary`
  instead of `#1a1a1a` / `9px` / `700` / `rgba(0, 0, 0, 0.25)`.
- `.wb-session-git-review-shortcut` uses `--font-size-micro` and `--radius-xs`
  instead of raw `10px` / `2px`.

Token definitions are the only raw colour literals left in the diff, which is
where the policy says they belong (`:root` is the single source of tokens).

## 3. Font ladder — fixed for new code, token left alone

`--font-size-micro` is `10px`, below the policy's documented 11–15px ladder.
Decision: **do not change the shared token.** It has 17 existing consumers across
unrelated surfaces, so raising it is a global visual change with no demonstrated
need. New label text instead uses `--font-size-caption` (11px), and the
misleading `var(--font-size-micro, 11px)` fallbacks are gone — the fallback was
dead and read as if 11px were intended. Where a deliberately small size is
wanted (the numeric badge, the keyboard-shortcut hint) the rules use
`--font-size-micro` directly with no fake fallback.

If the ladder is ever enforced app-wide, raise the token in one commit and
validate every consumer.

## 4. Fake shortcut hint — fixed by implementing the shortcut

The review banner advertised `⌃⇧G` with nothing listening for it. Registered for
real instead of removing the hint:

- `src/main/main.ts` — View menu item `Review Git Changes…` with
  `CommandOrControl+Shift+G`, dispatched through the existing `workbenchCommand`
  helper to `workbench:cmdShiftG` (so the accelerator is discoverable in the menu
  bar, as the policy requires).
- `src/preload/preload.ts` — `onWorkbenchCmdShiftG` on the bridge contract.
- `WorkbenchPanel.tsx` — bridge subscription plus a renderer keydown fallback
  matching the `⌘⇧F` pattern, both opening the Git side panel.

The banner's `<kbd>` is platform-aware (`⌃⇧G` on macOS, `Ctrl+Shift+G` elsewhere)
via the existing `macShortcuts` flag.

## 5. Change count invisible to assistive tech — fixed

`aria-label` now carries the count (`Git, 3`), and the badge stays `aria-hidden`
so the number is not announced twice. The tooltip keeps label + count +
accelerator.

Implementation note: the count is composed as
`` `${t("desktop.workbench.sidePanelGit")}, ${gitDirtyCount}` `` rather than a new
pluralized i18n key. A new key would have required touching the ~80 inline mock
catalogs in `WorkbenchPanel.test.tsx`; composing from the existing translated
label needs none, and the button's accessible name is now prefix-`Git` so the
tests match both the clean and dirty variants.

## 6. Toolbar tooltips omit accelerators — fixed where a shortcut exists

- **Search** is a real registered shortcut (`⌘⇧F`), so its tooltip now shows it.
- **Git** shows `⌃⇧G`, which is real as of item 4.
- **Files** and **Scripts** still have no accelerator, so their tooltips stay
  bare — a shortcut must not be advertised until it is wired.

## 7. `prefers-reduced-motion` coverage — fixed

Added a block disabling `transition` for `.wb-detail-tool`,
`.wb-detail-project-reveal`, `.wb-session-git-review-btn`,
`.wb-session-git-commit-btn`, `.wb-git-clean-action-btn`, `.wb-diff-ask-agent`,
`.wb-workbench-tab-close`, and `.wb-terminal-tab-close`.

---

## Checked and NOT a violation

`.wb-terminal-tab-label` was suspected of suppressing its focus ring (its base
rule sets `box-shadow: none`). Specificity resolves the other way: the global
`button:focus-visible { box-shadow: 0 0 0 3px var(--color-focus-ring) }` is
`(0,1,1)` and outranks the `(0,1,0)` class rule, so the ring renders. The
`background: transparent` on `.wb-terminal-tab-label:focus-visible` is redundant
but harmless. No change made.
