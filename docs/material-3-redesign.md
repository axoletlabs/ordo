# Material 3 design system

## Direction

Ordo is a personal reading library. Its primary tasks are saving, finding, organizing, and reading links. The new shell treats search as an action and settings as an account destination, freeing the entire screen for the library.

```
Compact                         Expanded
┌──────────────────────────┐    ┌───────────────────────────────────────────────┐
│ Search your library   ◉   │    │ Search your library                       ◉  │
│                          │    │                                               │
│ Your library             │    │ Your library                                  │
│ Library tools            │    │ Library tools                                 │
│ Folder / bookmark list   │    │ Search results       │ Reader / article       │
│                          │    │                      │                        │
│              + Save link │    │                      │             + Save link│
└──────────────────────────┘    └───────────────────────────────────────────────┘
```

Left-aligned content, 16dp screen margins, 16dp list padding, and an 8dp spacing grid. Content is constrained on wide displays. The visual emphasis belongs to the search app bar and the primary save action, with tonal surfaces expressing hierarchy.

## Tokens

- Default source: teal `#006A60`. Optional violet `#6750A4`, blue `#005AC1`, rose `#984061`, and green `#386A20`.
- Colors: Google's `SchemeTonalSpot` in Standard and `SchemeExpressive` in Expressive, with light/dark and standard/medium/high contrast. All UI colors reference semantic roles. AMOLED changes the root surface only.
- Type: Roboto, Material's 15-role type scale. Expressive emphasizes display/headline/selected labels. Reading typography stays user-controlled.
- Shape: 4, 8, 12, 16, 20, 28, 32, 48dp and full. Component-specific corners, rather than a universal radius.
- Motion: Material spatial springs for position/size/corners; non-overshooting effects for opacity/color. Standard and Expressive schemes are switched globally. Reduced motion removes spatial movement.

## Component decisions

- Search app bar: contained 56dp search control plus a 48dp account target. Opens a focused search view with a back action.
- Actions: filled, tonal, outlined, text, and error variants; pill shapes at rest; Expressive pressed-state shape morphing.
- FAB: 56dp container, primary-container/on-primary-container pairing. Extended save action on the library.
- Lists: 56/72/88dp minimum sizing, flexible height for content, consistent leading/trailing slots. Expressive segmented rows and selected tonal surfaces.
- Text fields: 56dp outlined fields with floating labels, 2dp active outlines, supporting/error text, and stable geometry during editing.
- Switches: 52×32dp track with a changing handle and a selected checkmark.
- Menus: surface-container elevation, 48dp rows, tokenized states, selected tonal treatment, retained exit placement, and keyboard navigation.
- Dialogs: 28dp corners, 24dp padding, headline-small title, trailing actions, focus containment, and restoration.
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
- https://docs.expo.dev/versions/latest/sdk/symbols/

This project uses React Native/Expo. Material's native Expressive component library is Compose-first; the shared React Native components implement the published roles, measurements, state behavior, and motion guidance across native and web.
