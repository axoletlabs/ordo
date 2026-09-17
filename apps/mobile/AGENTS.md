# Mobile UI

Don’t invent type or overlay chrome. Use `Text` variants and the overlay primitives.

**Type**
- `header` — screen titles, buttons, overlay titles
- `label` — field labels, section labels, compact actions
- `headline` — bookmark / folder / tag names
- `title2` — empty states (sentence case)
- `body` / `footnote` — copy and supporting text
- `monoSmall` — URLs, hosts, counts, times
- Tabs use `NAV_CHROME_TEXT`. Segmented matches `label`. Setting values are `footnote`.

**Overlays**
- Dialogs: `FloatingPanel` + `PanelHeader` + `PanelActions`
- Confirms: `ConfirmDialog` (including deletes from a context menu)
- Menus: `ContextMenu`. Rows fill the panel: `overlayMenuPadding` is 0, no gap between rows, hover is a full-bleed rectangle (first touches the top, last the bottom, left and right meet the edge). The menu's `overflow: hidden` clips the first/last hover to the panel radius. Comfort is the row's inner padding, not inset chrome around the buttons. Draw the panel with a 1px `palette.outline` stroke — quiet, theme-aware, not a separator hairline.
- Center the overlay title. Stack the icon above it. Cancel and confirm are equal.
