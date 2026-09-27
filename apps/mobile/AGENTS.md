# Mobile UI

Don’t invent type or overlay chrome. Use `Text` variants and the overlay primitives.

**Alignment**
Similar things share one edge. Do not invent a new inset for a screen, row, or header control.

- Screen rail (`columnContentInset` / `layout.screenHorizontalPad`): section labels, card edges, list hairlines, header text actions, and the back chevron’s tip. A cutout replaces the rail where the column does not already clear it. Never add the safe area on top of the rail.
- Title line: the back button and trailing header icons center on the title. A subtitle does not move them.
- Row inset (`layout.rowInset`): the leading icon inside a list row or settings card, measured from that container’s edge. It is not the same x as the back chevron.
- Header icon buttons share one hit target. Ordinary glyphs stay centered in it. Only the back chevron is shifted, so its tip meets the rail.
- Forms add their own interior padding on top of the safe area. Menu rows pad inside the panel. Neither is the screen rail.

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
