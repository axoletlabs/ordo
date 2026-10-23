# Changelog Material guidance

Reviewed Google's published Material 3 guidance on 23 October 2026. The
changelog combines one release button row with a prominent
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
  related single-selection choices belong in one connected toggle group. Each
  button names a complete release, such as “0.3.0 Preview 5” or “0.2.0,” so one
  selection opens the desired notes. The row uses shared 48dp targets and
  scrolls horizontally instead of truncating labels or adding another filter
  row. Arrow keys and Home/End select releases and keep the active one visible.
- [Color roles](https://m3.material.io/styles/color/roles): use semantic
  surface/container/foreground pairs. Selection uses the shared secondary
  roles; the acknowledgement action uses primary.
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
