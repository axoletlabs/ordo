# Changelog Material guidance

Reviewed Google's published Material 3 guidance on 23 October 2026. The
changelog combines direct release buttons with a version menu, a prominent
acknowledgement action, and continuous notes rather than separate cards.
Use the official website as the reference when revisiting these decisions.

- [Bottom sheets](https://m3.material.io/components/bottom-sheets/guidelines)
  and [specs](https://m3.material.io/components/bottom-sheets/specs): use the
  shared tonal sheet, bounded to 640dp, with scrollable notes. A basic dialog
  is intended for important prompts; these release notes are supplementary.
- [Applying type](https://m3.material.io/styles/typography/applying-type):
  headline for “What's new,” body type for notes, label large for controls.
  Hyperlinks use primary color and an underline, including nested emphasis.
- [Buttons](https://m3.material.io/m3/pages/common-buttons/guidelines) and
  [specs](https://m3.material.io/m3/pages/common-buttons/specs): Expressive
  supports larger sizes and filled actions. “Got it” uses a full-width 56dp
  primary button, matching the product preference for generous controls.
- [Button groups](https://m3.material.io/components/button-groups/guidelines):
  related single-selection choices belong in a connected toggle group. Choose
  a version family, such as 0.3.0, from the menu, then select its Preview 5,
  Preview 4, or stable release directly. The shared group fills the available
  width and scrolls on narrow screens instead of truncating labels; keyboard
  navigation keeps the selected choice visible.
- [Menus](https://m3.material.io/components/menus/guidelines) and
  [accessibility](https://m3.material.io/components/menus/accessibility): use
  the shared single-selection menu with a checkmark and 48dp targets. Enter,
  Space, Up, and Down open it; arrows navigate and Escape dismisses it.
- [Color roles](https://m3.material.io/styles/color/roles): use semantic
  surface/container/foreground pairs. Expressive standard menus and vibrant
  menus have different color treatments; Expressive mode alone does not mean
  recoloring the entire menu to tertiary.
- [Shape](https://m3.material.io/styles/shape/applying-shape) and
  [building with M3 Expressive](https://m3.material.io/blog/building-with-m3-expressive):
  emphasize hierarchy and meaningful interaction. Keep shape morphing on the
  controls and stronger Expressive headline typography; avoid decorative shapes.
- [Motion](https://m3.material.io/styles/motion/overview/how-it-works) and
  [specs](https://m3.material.io/styles/motion/overview/specs): share spatial
  springs for geometry and non-overshooting effects for color/opacity. The
  official guidance includes conversion for web; library availability does
  not prevent implementing these springs. Retain reduced-motion support.
- [Spacing](https://m3.material.io/styles/spacing/overview): use the shared
  spacing scale and parent gaps, adapting padding to the available window.

Retain the app's shared primitives, Roboto type scale, palette, overlay focus,
Back/Escape handling, and exit-content retention. Verify portrait and wide
layouts, both themes and design modes, short windows, and keyboard interaction.
