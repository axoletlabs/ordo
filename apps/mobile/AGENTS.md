# Material 3 UI

The app follows Material 3 and has a persisted Material 3 Expressive mode.
Use shared primitives; do not introduce screen-specific visual systems.

- Color comes from `Palette` Material roles, generated with Google's Material color utilities. Pair each container with its `on*` role. Dividers use `outlineVariant`, fields use `outline`.
- Typography uses the Roboto Material type scale through `Text` variants. Sentence case throughout. Reader content may retain the user's chosen reading font.
- Layout uses an 8dp grid, a shared 16dp screen rail, safe-area-aware columns, and minimum 48dp interactive targets. Wide screens use constrained content and list/detail panes.
- The library is home. Search opens from its search app bar; account/settings opens from the top-right icon. There is no persistent navigation bar or rail.
- Standard lists use Material list sizing and alignment. Expressive lists use segmented tonal surfaces and stronger selected states. Do not wrap list items in additional cards.
- Use `PressableScale` for actions, `ListPressable` for virtualized lists, and the shared Material spatial/effects motion schemes. Shape morphing is for Expressive controls. Honor reduced motion.
- Dialogs use `FloatingPanel`, `PanelHeader`, and `PanelActions`; destructive confirmations use `ConfirmDialog`. Menus use `ContextMenu`. All overlays retain their contents and placement during exit, support keyboard/back dismissal, and manage web focus.
- Material icons are rendered through `MaterialIcon`. Stored folder icon names remain compatible with existing data.
- Verify mobile and wide web layouts, both color schemes, both design modes, keyboard interaction, and reduced motion when changing shared UI.
