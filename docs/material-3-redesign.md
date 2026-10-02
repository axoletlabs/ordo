# Material 3 design system

## Direction

Ordo is a personal reading library. Its primary tasks are saving, finding, organizing, and reading links. Search is a persistent field in the library; account/settings is a trailing destination. Search does not replace the screen or its list.

```
Compact                         Expanded
┌──────────────────────────┐    ┌───────────────────────────────────────────────┐
│ Search your library   ◉   │    │ Search your library                       ◉  │
│ Library    Sort Filter ⋯ │    │ Library                         Sort Filter ⋯ │
│ Folder / bookmark list   │    │ Search results       │ Reader / article       │
│                          │    │                      │                        │
│              + Save link │    │                      │             + Save link│
└──────────────────────────┘    └───────────────────────────────────────────────┘
```

Left-aligned content, 16dp screen margins, 16dp list padding, and an 8dp spacing grid. Content is constrained on wide displays. The visual emphasis belongs to the search app bar and the primary save action, with tonal surfaces expressing hierarchy.

## Tokens

- App source: teal `#006A60`, using Google's `SchemeTonalSpot` in both design modes. Expressive components do not require the unrelated hue-rotating `SchemeExpressive` color variant.
- Material You colors: opt-in Android 12+ system accent1/2/3 and neutral1/2 tonal palettes. Android 14+ uses exact semantic system roles at default contrast, including monochrome/system contrast choices. Android 12–13 uses the neutral-variant strategy from Compose. Additional surface/contrast tones use Google's color utilities. Refresh on foreground to pick up wallpaper and system color-style changes. Older Android, iOS, web, and older binaries use the app palette. No preset app-color picker.
- Colors: light/dark and standard/medium/high contrast, all via semantic roles and their intended `on*` pairs. AMOLED changes the root surface only.
- Type: Roboto, Material's 15-role type scale. Expressive emphasizes display/headline/selected labels. Reading typography stays user-controlled.
- Shape: 4, 8, 12, 16, 20, 28, 32, 48dp and full. Component-specific corners, rather than a universal radius.
- Motion: Material spatial springs for position/size/corners; non-overshooting effects for opacity/color. Standard and Expressive schemes are switched globally. Reduced motion removes spatial movement.

## Component decisions

- Search app bar: contained 56dp field plus a 48dp account target; one 64dp contextual row replaces the oversized heading and separate tools container. Cached matches arrive immediately, server/article matches follow, and stable-key list items use spatial spring layout transitions. Legacy `/search` links redirect to the library.
- Actions: filled, tonal, outlined, text, and error variants; pill shapes at rest; Expressive pressed-state shape morphing.
- Button sizes: 32/40/56/96/136dp, matching Compose's XS/S/M/L/XL tokens; compact visual containers retain separate 48dp touch targets. Destructive actions use `error/onError` filled buttons.
- Standard button groups: 15% press expansion with adjacent compression and fast spatial springs. Connected selection groups: 2dp gaps, rounded outer/square inner corners, selected pill shape, and no neighbor movement. Hover uses state layers only.
- Icons: preloaded Material Icons font, fixed em-square and no Android font padding. One renderer preserves tint/alignment consistently and adapts legacy stored folder names.
- FAB: 56dp container, primary-container/on-primary-container pairing. Extended save action on the library.
- Lists: 56/72/88dp minimum sizing, flexible height for content, consistent leading/trailing slots. Expressive segmented rows and selected tonal surfaces.
- Text fields: 56dp outlined fields with floating labels, 2dp active outlines, supporting/error text, and stable geometry during editing.
- Switches: 52×32dp track with a changing handle and a selected checkmark.
- Menus: surface-container elevation, 48dp rows, tokenized states, selected tonal treatment, retained exit placement, and keyboard navigation.
- Dialogs: 28dp corners (32dp Expressive), 24dp padding, headline-small title, a small unframed icon when needed, left-aligned supporting text, and trailing actions. Header/actions remain outside the scrolling body. Retained exit contents, focus containment/restoration, and one-time opening focus.
- Settings: small top app bars, a neutral account surface, grouped tonal rows with 24dp leading icons, and adaptive trailing controls. Session rows omit redundant device-type copy.
- Snackbar: inverse-surface/on-inverse-surface with inverse-primary actions.
- Tooltips: inverse tonal surfaces, 12sp supporting type, pointer hover / keyboard focus / long-press disclosure, and timed dismissal.
- Progress: rounded circular indicator in Standard; the documented wavy circular configuration in Expressive. Both become static when reduced motion is enabled.
- Selection: contextual chrome preserves the library's geometry; stationary holds select one item, with edge auto-scroll starting only after movement.

## Research

Official guidance consulted during implementation:

- https://m3.material.io/
- https://m3.material.io/styles/motion/overview
- https://m3.material.io/styles/motion/overview/specs
- https://m3.material.io/components/buttons/overview
- https://m3.material.io/components/buttons/specs
- https://m3.material.io/components/search/overview
- https://m3.material.io/components/menus/overview
- https://m3.material.io/components/lists/overview
- https://m3.material.io/components/text-fields/specs
- https://m3.material.io/components/progress-indicators/overview
- https://m3.material.io/components/button-groups/specs
- https://github.com/androidx/androidx/blob/androidx-main/compose/material3/material3/src/commonMain/kotlin/androidx/compose/material3/ButtonGroup.kt
- https://github.com/androidx/androidx/blob/androidx-main/compose/material3/material3/src/commonMain/kotlin/androidx/compose/material3/tokens/ButtonMediumTokens.kt
- https://github.com/androidx/androidx/blob/androidx-main/compose/material3/material3/src/commonMain/kotlin/androidx/compose/material3/tokens/ExpressiveMotionTokens.kt

This project uses React Native/Expo. Material's native Expressive component library is Compose-first; the shared React Native components implement the published roles, measurements, state behavior, and motion guidance across native and web.
