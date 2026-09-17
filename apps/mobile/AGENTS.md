# Mobile UI

Use existing primitives and `Text` variants. Do not invent font sizes, families, or overlay chrome.

## Type

| Variant | Use |
| --- | --- |
| `header` | Screen titles, buttons, overlay titles (uppercase Tight) |
| `label` | Field/section labels, selection actions, toast actions (uppercase Tight) |
| `headline` | Bookmark, folder, tag names |
| `title2` | Empty-state titles (sentence case) |
| `body` / `bodyStrong` | Copy, setting-row names |
| `footnote` | Supporting copy, errors, descriptions, setting values |
| `caption` | Compact Tight that is not uppercase (e.g. chips) |
| `mono` / `monoSmall` | URLs, hosts, counts, timestamps, codes |
| `NAV_CHROME_TEXT` | Tab and rail labels only |

- Inter Tight = chrome and list names. Inter = copy. JetBrains Mono = meta. Playfair = wordmark only.
- Prefer `body` over `callout` / `subhead`. Inputs use `fontSize.md` and `label`. Segmented matches `label`.
- Reader article HTML keeps its own type. Crash UI uses these tokens, not raw sizes.

## Overlays

`FloatingPanel` + `PanelHeader` + `PanelActions` for dialogs. `ConfirmDialog` for confirms. `ContextMenu` for anchored menus.

- Header: centered `header`, icon stacked above, subtitle `footnote`.
- Width: confirms `layout.overlayConfirmWidth` (380), menus `overlayMaxWidth` (420).
- Padding: `overlayPadding` (16); menus `overlayMenuPadding` (8). No extra horizontal pad on panel bodies.
- Actions: Cancel `secondary`, confirm `primary` or `danger`, equal width.
- In-menu delete opens `ConfirmDialog`. Destructive copy must match whether the action is undoable.
