# Performance audit (October 2026)

Original release baseline: `release/0.2.0` (`faa9bed`). Branch:
`perf/app-optimization`. The large-library/long-reader follow-up below uses
`20e15ad` as its baseline; do not combine the two sets of measurements.

## Measured results

**Android APK (arm64, release, from CI):**

| | Before (v0.2.0) | After |
| --- | --- | --- |
| APK size | 60.9 MB | 24.0 MB |
| DEX (uncompressed) | 53.4 MB in 6 files | 11.0 MB in 2 files |
| Classes | 44,615 | 15,544 |
| Native libraries (in APK) | 23.9 MB stored | 7.8 MB compressed |
| JS bytecode bundle | 6.38 MB | 5.32 MB |
| Fonts (uncompressed) | 7.1 MB | 4.7 MB |

**JS bundle (Metro, minified, before bytecode):** 5.83 MB → 4.62 MB.
Assets 7.84 MB → 5.9 MB.

**Web build** (Chromium, CPU throttled 4×, 400-bookmark fixture library,
5 interleaved runs, medians). Web is a proxy for the shared JS work, not a
native frame-rate measurement.

| | Before | After |
| --- | --- | --- |
| Cold launch → library painted | 3,924 ms | 3,185 ms |
| Script time, launch + 6 s | 4.08 s | 3.19 s |
| Long tasks in the 6 s after launch | 845 ms | 358 ms |
| Font requests at launch | 28 | 6 |
| JS heap after launch | 30.6 MB | 27.3 MB |
| Component renders, launch + 6 s | 6,323 | 3,182 |
| Component renders, 40-step reader scroll | 14,320 | 9,232 |
| Search typing long tasks | 3,445 ms | 3,629 ms (render counts identical; no new hotspot found) |

## Large-library and long-reader follow-up

Baseline: `20e15ad`, after the original optimizations above. Release-web export,
Chromium 153 on an ARM64 Linux host, CPU throttled 4×, fixture API responses,
10,000 bookmarks, a 5,000-bookmark folder and a 1,200-paragraph article
(442,850 HTML bytes). These are an isolated before/after observation per layout,
**not multi-run medians, backend timings or native frame-rate measurements**.
No builds ran alongside the accepted timing runs.

| Metric | Portrait before → after | Landscape before → after |
| --- | --- | --- |
| First article text | 5,188 → 1,670 ms | 5,028 → 1,659 ms |
| Largest article-window main-thread task | 2,802 → 420 ms | 2,806 → 390 ms |
| Complete article text mounted | 5,420 → 7,138 ms | 5,255 → 7,052 ms |
| Total article-window long-task time | 4,920 → 6,343 ms | 4,764 → 6,192 ms |
| Library ready | 3,047 → 3,083 ms | 3,036 → 3,156 ms |
| Folder open | 859 → 839 ms | 793 → 840 ms |
| Mounted library / folder rows | 21 / 33 → 21 / 33 | 19 / 31 → 19 / 31 |
| Catalogue requests during the scenario | 11 → 1 | 11 → 1 |

**Tradeoff:** first text appears about 67–68% sooner and the worst task is
85–86% shorter, but complete mounting takes 32–34% longer and aggregate
long-task time increases. This is a responsiveness optimization, not faster
total article rendering. A 390–420 ms worst task is still noticeable. The
large-library measurements do not demonstrate faster launch or folder opening;
they verify bounded row mounting and pagination while avoiding hidden work.

The harness polls native `document.body.textContent` for first/last paragraphs.
Earlier experimental completion timings used recursive Playwright text matching,
which became expensive as sections accumulated; those timings are invalid and
are not reported here. Accepted raw results/screenshots for this session are in
`/tmp/opencode/ordo-stress-before-final` and `/tmp/opencode/ordo-stress-accepted`
(temporary local artifacts, not checked into the repository).

### Changes and safeguards

- **Title sorting:** reuse an `Intl.Collator` rather than passing locale options
  to every comparison. An isolated Node benchmark of 10,000 mixed-case/Unicode
  titles measured a median **953.66 → 22.95 ms** over ten retained iterations,
  with identical ordering. This measures sorting alone, not a screen transition.
- **Catalogue warm-up:** stop scheduling additional pages when the library loses
  focus or the app backgrounds. An in-flight request may still finish. Search
  resumes the same in-memory catalogue when the screen is active again.
- **Long articles:** parse once into structurally intact sections, share the
  renderer/config providers, mount one section initially, then two per scheduled
  task (16 ms delay). Boundaries use 64 blocks or 24,000 text characters; highlight
  markup cannot shift subsequent boundaries. Reuse unchanged section sources on
  highlight edits. Lists, tables, paragraphs and styled containers stay intact.
  This is progressive mounting, **not article virtualization**: all sections
  eventually stay mounted, and an oversized indivisible block can still stall.
- **Navigation/progress:** generate heading IDs globally, queue a TOC jump until
  its target mounts, cancel scheduled work on unmount, and restore a saved
  position only after complete content/layout. Fresh detail can correct stale
  cached progress before restoration, never after a user jump. Changing motion
  preferences no longer resets per-article progress initialization.
- **Reader chrome:** run header/FAB direction hysteresis and scrollbar position
  on the Reanimated UI thread. Sample noncritical JS scroll bookkeeping every
  80 ms, with final drag/momentum reports. Preserve shared Material springs,
  reduced motion, selection pinning and programmatic expansion.
- **In-app browser:** memoize the WebView element independently of loading/pull
  HUD updates; limit pull-to-refresh bridge updates and layout probes to once
  per 32 ms; cancel reversed pulls and recheck top-of-page on release. Force-dark
  refinements avoid identical stylesheet, class, meta and color-scheme writes.
  VM tests execute the injected scripts; no native WebView FPS claim is made.
- Smaller article batches caused repeated layout overhead. A web CSS containment
  experiment did not help and was removed.

### Reproducing and validating

From `apps/mobile`, use a release web export served with SPA route fallback.
Set `ORDO_UI_URL` to that local server, `PLAYWRIGHT_MODULE` to an installed
Playwright module if necessary, and `PLAYWRIGHT_CHROMIUM` to a Chromium binary.
The UI scripts use fixture API responses, not a production library.

```sh
pnpm test
pnpm test:material
pnpm typecheck
pnpm lint
pnpm test:performance
node --experimental-strip-types --disable-warning=MODULE_TYPELESS_PACKAGE_JSON tests/library-sort-performance.mjs
pnpm test:stress-ui
pnpm test:reader-sections-ui
ORDO_UI_READER_ONLY=1 pnpm test:ui
```

The stress harness asserts virtualization before/after folder scrolling and a
subsequent page fetch. Section unit tests cover text/structure, parent/sibling
links, global heading IDs and unchanged-source reuse. The long-reader UI matrix
uses both themes and design modes, both layouts, keyboard TOC navigation to an
unmounted target, highlight removal without remount/jump, live reduced-motion
changes without progress reset, navigation cancellation and saved-position
restoration. The existing rich-reader matrix covers typefaces, sizes, reader
themes, tables, code, links and highlights. Search CPU regression queries on
10,000 records measured roughly 13–24 ms median; short queries skip article bodies.

Final validation passed: the full mobile test command (525 tests), the separate
Material color/contrast suite (118 tests), typecheck, lint and `git diff --check`.
The long-reader UI matrix passed all four light/dark × standard/Expressive
combinations, including the progress-accessibility assertion after live motion
and layout changes. The rich-reader matrix also passed (236 screen captures,
16 interaction groups); representative portrait/light/standard and
landscape/dark/Expressive captures were visually inspected. Its incidental frame
samples ran alongside validation work and are not accepted performance timings.

Release-web and Android JS-only (`expo export --platform android --no-bytecode`)
exports pass. Android Hermes bytecode export cannot run here: the host is ARM64
but the bundled Linux `hermesc` is x86-64 (exit 128). No Android runtime/device
was available. Native FPS, OS text selection across sections, image-driven
relayout, WebView navigation/refresh/dark-mode smoothness and background/resume
still need device verification. No native release, OTA or deployment was made.

## What changed

### Launch

- **Fonts.** The splash used to wait for all 29 fonts (~6.3 MB), and
  expo-asset re-hashes each cached file on every cold start. Launch now loads
  only Roboto, the icon font and the two JetBrains Mono faces in use
  (`src/theme/fonts.ts`). Reading typefaces load per family: the reader keeps
  the previous family on screen while a new one loads, and the account's
  family is preloaded 1.5 s after the library appears.
- **zod off the launch path.** `@ordo/shared` has a zod-free `client` entry
  that Metro selects through the `react-native` / `browser` export conditions.
  Form screens import schemas from `@ordo/shared/schemas`. Mobile TypeScript
  uses `customConditions`, so using a schema value from the root import fails
  to compile instead of crashing at runtime.
- **Search index warming** (`useLibraryCatalogue`) waits 2 s, or until search
  starts, and runs in a leaf component. Each catalogue page used to re-render
  the whole library screen.

### Runtime

- **Query persistence.** TanStack's subscriber dehydrated the entire cache on
  every cache event (fetch starts, polls, search keystrokes, reader loads) and
  re-serialized the library to disk each second. `query-cache.ts` now saves
  only when folders or a public bookmark list gets new data, once per 1 s
  burst, and flushes when the app leaves the foreground.
- **Reader scroll.** The whole-percent progress value (used only for the
  progress bar's accessibility value) lived in `ReaderPaneInner`, so the
  entire reader re-rendered at every 1% of scroll. It now lives in
  `ReaderProgressBar`.
- **Row warm-up.** Press-in (which also fires when a scroll starts on a row)
  no longer prefetches detail for website bookmarks, and prefetch uses the
  reader's 5-minute freshness rather than 30 s.

### Bundle and assets

- `metro.config.js` stubs modules that dependencies load but ordo never
  runs (see `metro-stubs/`):
  - zod's 40 locale catalogs;
  - expo-router's Material Symbols font (966 KB) and `@expo/ui` toolbar views;
  - the ramda barrel used by the reader engine;
  - react-native-svg's css-tree parser, reached only via QR-code `logoSVG`.
- `date-fns` is imported per function.
- Icons use `assets/fonts/MaterialIcons-Ordo.ttf`: 171 glyphs, 18 KB, down
  from 357 KB. **After adding an icon, run**
  `node --experimental-strip-types scripts/build-icon-font.mjs`. CI fails if
  you forget (`tests/icon-font.test.mjs`). Unknown names draw a folder glyph,
  never tofu.
- Reading fonts are subset to drop glyphs reachable only through OpenType
  features the app never enables. Every character's outline, advance and
  kerning is unchanged (see `assets/fonts/README.md`).

### Android build (`plugins/with-android-build.js`)

- R8 minify and resource shrinking. Extra keep rules cover the app package
  (config-plugin Kotlin) and `react-native-worklets`. `raw` and `drawable`
  resources are kept because React Native loads JS assets by name.
- Native libraries are compressed in the APK, cutting about 17 MB from each
  arm64 download. Android inflates them once at install: about 80 ms on the
  build box, well under a second on low-end phones. Launch is unaffected, and
  installed size grows by about 8 MB.
- `@expo/ui` (Jetpack Compose), `@expo/dom-webview`, `@expo/log-box` and
  `expo-keep-awake` are excluded from Android autolinking. None is reachable
  from production JS, and no other native code references them.
- BouncyCastle's post-quantum and certificate-review data files are excluded.
  R8 already removes every BouncyCastle class.

### Server

- In-process gzip (`compression`) for API responses. The nginx example only
  compresses `text/html`, and LAN self-hosts often expose Node directly.
  OkHttp decompresses transparently. **Takes effect on the next server deploy.**

## Considered and not done

- **React Compiler.** The full UI suite passes with it on, and renders drop
  13–36% depending on the interaction (4% for list scroll). It still bails
  out of 220 functions, including the library, folder, tags and reader
  screens, and Reanimated asks for `.get()`/`.set()` on shared values under
  the compiler, while this codebase uses `.value` throughout. Revisit with
  device testing.
- **Metro tree shaking** (`EXPO_UNSTABLE_TREE_SHAKING`): still unstable in
  SDK 57. The targeted stubs above captured most of its measured saving.
- **`lazyImports`:** little to gain, because the library screen renders its
  imports immediately (hidden sheets included), and late initialization of
  side-effect modules is a real risk.
- **AsyncStorage → MMKV:** would need a data migration for small gains.

## Before release

R8 changes can fail only at runtime. Smoke-test the CI APK on a device:

- launch signed in and signed out;
- library, folders, tags and search;
- reader (fonts, highlights, settings sheet);
- the in-app browser;
- share-sheet Save and Quick Save;
- reminders/notifications, import/export and avatar upload;
- MFA QR code;
- folder unlock (biometric/PIN);
- the in-app updater.

For the follow-up reader/browser changes, also verify on a physical device:

- Open and rapidly scroll a large folder; confirm later pages load without
  unbounded row mounting, and return from the reader to the same list position.
- Open a book-length article, immediately use the TOC for a late heading, and
  leave/reopen during mounting. Confirm saved progress restores after rendering.
- Select/highlight text within and across section boundaries; edit/remove a
  highlight while reading later sections. Check tables, lists and late images.
- Reverse scroll direction while sections mount; verify header/FAB behavior,
  reduced motion, selection pinning and progress after orientation changes.
- Browse, navigate back, reload and pull-to-refresh inside both ordinary pages
  and nested scrollers. Reverse/cancel pulls and toggle force-dark on light and
  already-dark pages; background/resume without reload or position regressions.
