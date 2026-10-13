# Library interaction refinements

Ordo is a personal bookmark library, not a dashboard. The visual priority is
finding and opening saved content; chrome and metadata should stay quiet.

## Design direction

- Retain the existing Material color generator and Material You tonal families.
  Reference dark roles for the app's `#006A60` seed: surface `#0E1513`, low
  container `#161D1C`, high container `#252B2A`, on-surface `#DDE4E1`, primary
  `#82D5C8`, secondary container `#334B47`. Components use roles, not these
  literal colors.
- Keep Roboto: title medium for list titles, body small for metadata, body
  large for the compact app bar, and the shared dialog headline. Reading fonts remain
  account preferences.
- Left-align content. Search and account share one top row. The Create FAB
  overlays the list; scrollable content alone has clearance for the last item.
- Baseline lists remain continuous. Expressive groups use 16dp outer corners,
  4dp inner corners, and 16dp selected corners. No extra card wrappers.
- Keep titles free of status glyphs. Lock/pin sit with folder supporting text;
  reading time follows the source, and article/website glyphs have a separate
  trailing slot. Dates remain in accessible labels rather than a competing
  right-aligned column. Tags and reminders share one bounded supporting line.
  Favicons have no oversized tonal plate. Article descriptions remain in Reader.
- Baseline settings use continuous tonal groups with 16dp end corners, no row
  dividers, tonal secondary buttons and chips, and borderless segmented choices.
  Expressive retains its distinct segmented shapes and shape morphing.
- Reader and Website share a compact tonal header with Back, domain, and at most
  two standard icon actions. Reading time belongs in the article byline, not a
  second header line. Hosting separates the current connection from switching;
  Data puts import first, then format, scope, and export in decision order.
- Folder and tag choices are anchored menus. The save form remains visible,
  retains its draft, and yields focus/back to the menu. Menu selections do not
  reorder themselves under the pointer.

Material search and form text fields have different anatomy. Both outlined and
filled fields are valid. The current forms use filled fields to match the tonal
search treatment: `surfaceContainerHighest`, 56dp height, an in-field floating
label, rounded top corners, and an active bottom indicator. Folder/tag fields
use the same filled treatment. The search bar retains its full-round shape.
Both creation dialogs share bottom padding and actions; no bookmark-specific
footer spacer is needed.

## Official Material references

Researched rendered guidance and specs, including the Expressive updates:

- [Text field guidelines](https://m3.material.io/components/text-fields/guidelines)
  and [specs](https://m3.material.io/components/text-fields/specs): outlined and
  filled variants, persistent labels, 56dp fields, centered 24dp icon slots,
  16dp icon/text gaps, outline and primary focus roles.
- [Search guidelines](https://m3.material.io/components/search/guidelines) and
  [specs](https://m3.material.io/components/search/specs): contained search,
  contextual trailing actions, optional account/avatar, 56dp search bar.
- [List guidelines](https://m3.material.io/components/lists/guidelines) and
  [specs](https://m3.material.io/components/lists/specs): distinct leading,
  content, and trailing slots; top alignment for taller rows; Expressive
  segmented shapes rather than independent rounded cards.
- [App bar guidelines](https://m3.material.io/components/top-app-bar/guidelines):
  compact, single-line titles and only one or two essential contextual actions.
- [Color roles](https://m3.material.io/styles/color/roles) and
  [contrast](https://m3.material.io/styles/color/system/contrast): pair containers
  with their own foreground roles and provide three distinct contrast levels.
- [Menu guidelines](https://m3.material.io/components/menus/guidelines):
  dropdowns open from fields, reposition to fit, and may contain filtering;
  single-select closes, multi-select remains open until dismissed.
- [Dialog guidelines](https://m3.material.io/components/dialogs/guidelines):
  use less disruptive menus for simple choices; preserve visible actions and
  titles where possible in constrained windows.
- [Extended FAB guidelines](https://m3.material.io/components/extended-fab/guidelines):
  transform to an icon FAB on downward scroll, expand on upward scroll, move
  the icon as width changes, and fade the label without shrinking its target.
- [Snackbar guidelines](https://m3.material.io/components/snackbar/guidelines)
  and [specs](https://m3.material.io/components/snackbar/specs): inverse color
  roles, one message at a time, restrained rectangular shape, no decorative
  status icon, bottom placement, and clearance only for actual FABs/toolbars.
  Actionable messages persist; web messages have explicit dismissal.
- [Motion physics](https://m3.material.io/styles/motion/overview) and
  [specs](https://m3.material.io/styles/motion/specs): spatial springs for
  geometry, non-overshooting effects for opacity/color, reduced-motion support.
- [Transitions](https://m3.material.io/styles/motion/transitions/transition-patterns):
  forward/backward page movement and enter/exit transitions still support the
  legacy easing/duration system. Web native-stack requires its own animation;
  native stacks retain native transitions.

## Behavior and verification

- Known authenticated routes dispatch through the public navigation object in
  the press handler, bypassing Expo's extra effect-queue commit. A source-route
  flight guard rejects repeat taps until focus returns; it never delays the
  first tap. Stack route identity remains a second protection against duplicates.
  The accepted result is propagated through row/settings/back callbacks; only
  accepted actions emit feedback. Rejected taps cannot vibrate or repeat
  bookmark-open mutations.
  Different folder/article IDs still have distinct routes. Embedded detail
  choices change params rather than adding another copy of the list page.
- Browser handoffs accept the first tap immediately and reject the same URL
  within the double-tap window.
- Selection rows register stable refs but do not measure geometry until a drag
  begins. Passive row layout handlers are absent. Hidden menus/dialogs allocate
  their animation hooks only when first opened.
- Rows use exact 72dp/96dp geometry plus 2dp Expressive gaps. List offsets are
  precomputed instead of measuring each cell; enlarged accessibility text uses
  intrinsic layout. A three-screen render window limits synchronous overscan.
  New lists do not install layout animations for every cell. Ordinary actions
  use native ripples/state layers without shared-value or spring setup; only
  morphing/animated controls mount the animation implementation.
- Material You uses one shared native palette read/foreground subscription.
  Every app contrast level starts from the same Android tonal families, never
  from an already contrast-adjusted semantic scheme. Android 14+ resource reads
  fall from 119 to 65 at initialization; Reader mounts reuse the cached snapshot.
  Icon wells and switch handles enforce their matching foreground roles. Native
  chrome restores all app color inputs, including Material You and contrast.
- Nested menus retain their original width, origin, and scrollable viewport.
  Library sorting, lock choices, reminder choices, and filter pages share a
  160ms content transition. Longer choices scroll rather than resizing the
  surface. State layers have an 8dp inset on every edge.
- Bookmark/folder rows use long-press, right-click, Shift+F10, and accessibility
  actions instead of permanent overflow buttons. Manage tags has no menu count.
- The link field reads the clipboard only after its Paste action. External
  native edits update focused Android fields without remounting them.
- Create uses spatial springs for width/icon placement and effects springs for
  label opacity. Direction hysteresis collapses it on downward scroll and
  expands it on upward scroll or return to the top, without per-frame React
  state updates. Its accessible label and 56dp target remain intact.
- Icon selection uses a virtualized grid with lightweight list controls.
- Keyboard layout uses one viewport calculation and lifts only actual overlap,
  rather than recentering above the IME or applying Android resize twice.
  Horizontal form padding stays stable during keyboard opening.
- Reader choices update synchronously, with serialized account writes. Article
  reflow is deferred behind control feedback; HTML sources are memoized. The
  controls retain the app palette while the reading surface changes theme.
- Reader's HTML engine is loaded after shell paint, not while evaluating the
  route module. HTML/highlight tree construction is outside the navigation
  commit even when the engine is cached. Preference changes retain the mounted
  article; the old InteractionManager/skeleton cycle is removed.

Performance work follows React Native's [performance guidance](https://reactnative.dev/docs/performance),
[FlatList configuration](https://reactnative.dev/docs/optimizing-flatlist-configuration),
and [JavaScript loading](https://reactnative.dev/docs/optimizing-javascript-loading).
Native-stack transitions remain native; render work, not animation duration or
an extra tap debounce, is the target.

Run `pnpm --filter @ordo/mobile test:interactions` for route identity, browser
handoff, minimum keyboard movement, and segmented shape regressions. Also run
the normal mobile tests, Material color tests, lint, and typecheck.

Visual verification covers 390×844 portrait, 1280×800 landscape, 320×420
constrained forms, light/dark, baseline/Expressive, and reduced motion. Native
JS export is not a substitute for checking the keyboard animation on a device.

The refinement smoke test also covers clipboard paste, long-press/right-click,
Shift+F10, selection entry, submenu geometry, and Create changing from 108dp to
56dp. The follow-up also verifies exact row heights, Reader/Website headers,
Hosting and Data across all contrast levels, export scope, and server-switch
entry. Native latency and haptic feel remain unverified without a connected
device. Web chrome timings do not measure complete article layout or website
network loading.

In a four-open production-web comparison at 4× CPU throttling, cold Reader
chrome went from 454ms to 275ms and Settings chrome from 253ms to 203ms. Settings
median went from 187ms to 152ms; folder median was essentially unchanged
(329ms to 337ms). These are chrome-entry observations, not proof of native
frame timing or full article-render performance.
