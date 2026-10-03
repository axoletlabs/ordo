# Material 3 UI

The app follows Material 3 and has a persisted Material 3 Expressive mode.
Use shared primitives; do not introduce screen-specific visual systems.

- Color comes from `Palette` Material roles, generated with Google's Material color utilities. Pair each container with its `on*` role. Dividers use `outlineVariant`, fields use `outline`.
- Typography uses the Roboto Material type scale through `Text` variants. Sentence case throughout. Reader content may retain the user's chosen reading font.
- Layout uses an 8dp grid, a shared 16dp screen rail, safe-area-aware columns, and minimum 48dp interactive targets. Wide screens use constrained content and list/detail panes.
- The library is home. Search filters and reorders its existing list in place; account/settings opens from the top-right icon. There is no separate search screen or persistent navigation bar or rail.
- Keep filters inside the search bar. Sorting/tag management use library overflow; folder creation belongs to the customizable Create menu. Search uses pre-indexed cached metadata immediately and remote matches asynchronously; global indexes must respect folder access and stay off disk.
- App colors retain a single identity in both design modes. Material You reads Android 12+ system tonal palettes; do not offer preset app colors or equate Expressive components with the Expressive color variant.
- Standard button groups use the Material 15% pressed-width expansion and adjacent compression. Connected toggle groups use shape changes only. Hover uses state layers, not layout motion.
- Standard lists use Material list sizing and alignment. Expressive lists use segmented tonal surfaces and stronger selected states. Do not wrap list items in additional cards.
- Use `PressableScale` for actions, `ListPressable` for virtualized lists, and the shared Material spatial/effects motion schemes. Shape morphing is for Expressive controls. Honor reduced motion.
- Dialogs use `FloatingPanel`, `PanelHeader`, and `PanelActions`; destructive confirmations use `ConfirmDialog`. Menus use `ContextMenu`. All overlays retain their contents and placement during exit, support keyboard/back dismissal, and manage web focus.
- Picker dialogs own their virtualized list (`scrollBody={false}`). Form fields reserve space for floating labels and use the dialog's surface. Keep header/actions visible above the keyboard when space allows; do not fill creation forms with an icon grid.
- Obscure parent dialogs during sibling pickers (`obscured`) while preserving draft state. Only the active surface handles focus/back. Cancel delayed opening focus on dismissal; put potentially long picker headers inside the virtualized list.
- Reader palettes must not override `Appearance`: System must always read the device's real scheme. Serialize preference writes and preserve newer optimistic choices while earlier requests finish.
- Material icons are rendered through `MaterialIcon`. Stored folder icon names remain compatible with existing data.
- Verify mobile and wide web layouts, both color schemes, both design modes, keyboard interaction, and reduced motion when changing shared UI.
