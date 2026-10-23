# Changelog Material guidance

Reviewed Google's published Material 3 guidance on 23 October 2026. The
changelog is a quiet reading surface: the release selector provides the main
interaction, and the notes remain continuous prose rather than separate cards.
Use the official website as the reference when revisiting these decisions.

- [Bottom sheets](https://m3.material.io/components/bottom-sheets/guidelines)
  and [specs](https://m3.material.io/components/bottom-sheets/specs): use the
  shared tonal sheet, bounded to 640dp, with scrollable notes. A basic dialog
  is intended for important prompts; these release notes are supplementary.
- [Applying type](https://m3.material.io/styles/typography/applying-type):
  headline for “What's new,” body type for notes, label large for controls.
  Hyperlinks use primary color and an underline, including nested emphasis.
- [Buttons](https://m3.material.io/m3/pages/common-buttons/guidelines): text
  buttons suit low-priority actions without distracting from nearby content.
  “Got it” uses the shared trailing text action; selecting a release remains
  a tonal control. This is a design choice for an acknowledgement sheet, not
  a requirement that every sheet use text actions.
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
  selector and stronger Expressive headline typography; avoid decorative shapes.
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
