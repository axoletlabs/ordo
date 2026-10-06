# Reader appearance follow-up — 2026-10-05

## Changes

- Theme choices: **4 → 3** (System, Light, Dark). Replaced the dropdown with visible single-selection segments. Removed the Sepia palette; stored Sepia values and older-client preference patches normalize to System without losing typography or AMOLED preferences.
- Reader settings now inherit the reader palette, including root-hosted overlays, rather than the app palette. Palette changes apply immediately to content and chrome together; typography reflow remains deferred.
- Shared segments support vertical arrangements on narrow windows or large native font scales, preserve Standard outlined/Expressive connected shapes, and support web arrow/Home/End selection with a roving tab stop.
- Article body ink uses `onSurface`. Code, quotations and tables use paired tonal surfaces; saved highlights carry `onTertiaryContainer` through nested emphasis and links. Native selection uses a tonal surface rather than a high-contrast primary container that could make unchanged text ink unreadable.
- Source-site inline colors, backgrounds, fonts, sizes and line heights cannot override reader preferences. Semantic heading/code/link/emphasis styling remains intact. Inline links expose the link accessibility role.
- Plain article text is memoized by HTML rather than rebuilt on every palette/typography change. Highlighted HTML and renderer source remain memoized separately. This reduces redundant scanning; it does not eliminate layout or renderer work when preferences change.
- Contents/highlight action targets: **44 → 48dp**; highlight text actions also have a 48dp minimum height.
- System appearance uses an external-store snapshot. The browser regression caught RN Web missing a color-scheme event during a simultaneous reduced-motion change after keyboard theme selection; a stable subscription and current snapshot close that gap without overriding `Appearance`.

## Verification

Isolated plain-text preparation benchmark (`pnpm --filter @ordo/mobile test:reader-performance`): unchanged **95,012-byte** article across **24** font/size/theme combinations, **30** measured iterations with alternating order. Repeated parsing versus caching gives **24 → 1 scans**, **135.948 → 6.250ms median** and **146.893 → 8.061ms p95** for the complete 24-combination workload. Both paths assert identical text checksums. This is a Node preparation-cost comparison, not a React/native rendering, startup or FPS measurement; concurrent browser matrices were running on the build box.

The production web fixture exercises both app schemes × Standard/Expressive, all reader themes, all three fonts × four sizes in both explicit reader schemes, AMOLED, saved nested-link highlights, source-styling rejection, headings, lists, quotations, long code, stacked tables, images/captions, live device appearance, keyboard controls, contents navigation and highlight removal. Controls are checked at 390×844, 1280×800 and 320×420. Article layouts are checked in portrait and landscape.

The API fixture is not live-server validation. Separate server e2e checks verify stored legacy preference reads, older-client patches, persistence and partial merges. Role contrast checks use the repository's 4.45:1 integer-RGB tolerance and are not WCAG certification.

Unit/backend results: **1,007 passing tests** (399 mobile/calendar/reader, 118 Material role checks, 40 shared, 271 server unit, 179 server e2e). A separate auth rerun passed all 52 cases after adding the stored-legacy-preference assertion. Workspace typecheck/lint, shared/server builds, production web export and Android/iOS JavaScript exports passed.

Whole-app regression: **452 captures, 72 interaction groups, 0 uncaught page errors** across light/dark × Standard/Expressive. These are repeated screen/state captures, not 452 unique screens. Results and images were reviewed at run time and are not kept in the repo. Twelve short one-bookmark browser samples had **16.7–33.2ms p95 frame intervals**, **33.3ms maximum**, and **0 Long Tasks**. The samples ran alongside the reader matrix and other build-box work; they are not native or app-wide smoothness guarantees.

Final reader matrix, including the dialog's separately painted web background: **172 captures, 16 interaction groups, 0 uncaught page errors**. Results/images were reviewed at run time and are not kept in the repo. Together with the whole-app regression this is **624 captures and 88 interaction groups**. Twelve short rich-article theme-change samples recorded **16.7–33.4ms p95 frame intervals**, **50.1ms maximum frame interval**, and **one 57ms Long Task**. The evidence does **not** establish zero hitches or a universal 60fps guarantee, despite the isolated text-preparation savings.

Native device verification remains pending: `adb devices -l` reports **0 devices**. Native selection, assistive technology, actual large-type behavior, system chrome and long-document frame pacing cannot be approved from browser screenshots. Android/iOS JavaScript exports use `--no-bytecode`; the previously recorded ARM-host Hermes compiler blocker remains unresolved.
