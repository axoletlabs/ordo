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
- Menus: `ContextMenu`
- Center the overlay title. Stack the icon above it. Cancel and confirm are equal.
