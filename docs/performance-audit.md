# Performance audit (October 2026)

> Historical report. The automated test and performance runners described below have been removed from the repository; these are not current test commands or CI gates.

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

### Historical validation

All test runners and artifacts have been removed. The measurements below describe past runs; the remaining static checks from `apps/mobile` are:

```sh
pnpm typecheck
pnpm lint
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

## Custom reminder opening follow-up

Baseline: `b09154b`, with the prior audit changes already included. The custom
calendar constructed a locale formatter for every date on every render, and
mounted an SVG/circle pair for all dates even when nothing was painted.

- Share one `Intl.DateTimeFormat` for all date accessibility labels in a month,
  and one for the seven weekday labels. Memoize labels and the month title
  across date/time edits; refresh when reopening or changing months so an OS
  locale/timezone change is not permanently cached.
- Preserve the current month state object when opening in that same month,
  avoiding a redundant calendar render.
- Mount circle geometry only for today and the selected date: **31 SVG trees
  become 1–2** in the October fixture. Keep the explicit SVG circles that avoid
  square selection backgrounds on Android; the visible styling is unchanged.

The historical timing harness (since removed) used release-web exports served with SPA
fallback, the same Chromium binary/host, and no concurrent builds/tests.
It fixed the date, throttled CPU 4×, and reported medians of three fresh browser contexts per design mode, each
measuring a first opening and a reopening. API responses were fixtures.
This measures shared JavaScript/web work, **not native FPS or backend latency**.
The action dispatches the real Custom menu click; first-content time is the
first animation-frame callback that sees the calendar DOM, not the end of the
opening animation. Pointer and keyboard behavior have separate interaction tests.

Observed medians (milliseconds) on the shared ARM64 host:

| Mode / opening | First calendar content before → after | Largest task before → after |
| --- | --- | --- |
| Standard / first | 1,256 → 447 | 1,148 → 370 |
| Standard / reopen | 1,034 → 316 | 917 → 252 |
| Expressive / first | 944 → 1,113 | 736 → 977 |
| Expressive / reopen | 1,006 → 414 | 946 → 356 |

**Timing limitation:** no builds/tests from this session ran during measurement,
but other agents' browser jobs were active. These are contended observations,
not an isolated speedup estimate; Expressive first opening did not improve in
this repeat run, and the remaining stalls are still noticeable. An earlier
single-sample pair showed 46–56% shorter worst tasks, but the repeated run does
not justify claiming that percentage as stable. Do not combine those samples.
The initial combined run timed out during the after pass; only its completed
before results and the subsequent completed after pass are listed above.
Raw results: `/tmp/opencode/ordo-reminder-opening-before-medians/results.json`
and `/tmp/opencode/ordo-reminder-opening-verified-medians-complete/results.json`
(temporary local artifacts, not checked in).

The deterministic work reduction is consistent: `toLocaleDateString` calls
during opening drop **71 → 1** (first) and **64 → 1** (reopen), with month and
weekday labels using shared formatters instead. The remaining call formats the
month title. This counter is not a count of all date formatting operations.

Validation: all 571 mobile tests, typecheck, lint for the changed code, the
release-web export and Android JS-only (`--no-bytecode`) export pass. The web
JavaScript hashes match the export used by the
interaction matrix: 16 captures and four light/dark × standard/Expressive
interaction groups, portrait/wide layouts, 12/24-hour cycles, reduced motion,
keyboard date/hour selection, month navigation, short-window scrolling, busy
save, dismissal and reopening. Locale unit cases cover en-US, en-GB, ar-EG,
ja-JP and leap/non-leap months. Native-device runtime remains unverified.

### Remaining picker stall: idle control animation setup

Follow-up baseline: `6efe90c` (the date-formatter/SVG optimization above is
already present). Tracing both bookmark actions and the reader/notification
reminder flows leads to the same `ReminderCustomPanel` and shared controls.
There is no network request, intentional opening timeout, or wait for the
outgoing menu to finish before the custom panel is made visible.

The remaining avoidable work was in the controls mounted by that panel:

- `AnimatedStatePressable` initialized its shared values at their resting
  targets, then started background, press, state-layer and corner springs to
  those **same targets** in mount effects. The hour/minute grid alone started
  96 unnecessary springs in 12-hour mode or 144 in 24-hour mode. Compare
  committed targets in refs instead; still animate actual presses, selection,
  palette and shape changes, and settle live reduced-motion changes. Do not
  read shared `.value` on the JS thread to perform the comparison.
- Ordinary `StateLayer` instances allocated animation values, subscribed to
  motion preferences, and mounted invisible animated views even before any
  interaction. Mount that feedback subtree on first use, then retain it for
  its entrance/release fades. An untouched October calendar now mounts **zero**
  feedback subtrees instead of 31. The actual pressable, focus target and date
  circle geometry stay in place.

These changes keep the shared primitives and the existing Material motion;
they do not prewarm a hidden picker, defer its contents, shorten the entrance,
or move the stall to the preset menu.

The opening benchmark now fixes only `Date`, rather than installing
Playwright's clock (which also instruments timers/animation frames). Compare
before/after exports with this same updated harness; do not compare the
numbers directly with the older timer-instrumented results above. Set
`ORDO_REMINDER_MAX_OPEN_MS` to enforce an explicit per-sample budget on a
controlled runner.

Same-host release-web measurements (Chromium headless shell 1243, ARM64,
390×844, dark, en-US/12-hour Standard and en-GB/24-hour Expressive, 4× CPU
throttle; medians of three fresh contexts, each cold + reopen):

| Mode / opening | First content before → after (ms) | Largest task before → after (ms) |
| --- | --- | --- |
| Standard / first | 303.3 → 270.5 | 254 → 218 |
| Standard / reopen | 268.7 → 230.7 | 229 → 197 |
| Expressive / first | 355.3 → 286.1 | 304 → 242 |
| Expressive / reopen | 303.4 → 249.1 | 267 → 214 |

The export builds completed before measurement; no concurrent builds/tests
from this session. This is still a shared host, not an isolated native-device
latency guarantee. Residual mounting/rendering work remains; this is an
11–19% reduction in the observed first-content medians, not a claim of zero
long tasks or native 60/120 FPS. First content is detected by RAF, not the end
of the 200ms fade. Profiles/raw samples are in
`/home/builder/ci/ordo-reminder-freeze-oct17/artifacts/date-only-{before,after}`
on the build host (temporary artifacts, not checked in).

Validation: 598 mobile tests, 118 Material tests, mobile typecheck/lint,
release-web and Android JS-only exports pass. The picker, shared-control hover
and overlay-layout matrices pass (112 captures; light/dark,
Standard/Expressive, portrait/wide, 12/24-hour cycles, keyboard, reduced motion,
busy save and reopening). Deterministic lifecycle tests exercise web/Android/iOS
branches; there is no connected native device for a runtime FPS claim. The
broader animation suite's stale `Save` selector was updated to the existing
`Save bookmark` accessible label (also present on the baseline).

### Clock picker: reducing the remaining first-paint tree

Baseline `2dfdc74` includes the idle-animation fix above and the current shared
panel's bottom-sheet support (the reminder still uses dialog presentation).
Both compared builds include that same shared-panel implementation.
The idle-animation fix did not remove
the time grid itself: each of its 24–36 `AnimatedStatePressable` instances still
initializes four shared values and four animated styles, plus its native/web
view tree. The 31-date calendar also mounts alongside it. These are synchronous
React/animation/layout costs before useful content can paint, not a deliberate
opening timer or a backend/notification-permission request. The overlay portal
publishes into a sibling host, so making the panel visible still has to mount
that entire content tree before its first useful frame. The previous release's
OTA job completed successfully; that alone does not establish which update an
individual device has applied.

The new picker has two explicit editing steps rather than a scrolling wall of
date/hour/minute buttons:

- **Time opens first:** a Material clock with large hour/minute readouts, the
  device's 12/24-hour cycle, and AM/PM when applicable. Tap or drag a hand;
  choosing an hour advances to minutes only after release. The 24-hour dial has
  outer 1–12 and inner 00/13–23 rings.
- **One adjustable surface:** SVG numerals are paint, not separate animated
  pressables. A single gesture/slider handles the face, with native
  increment/decrement actions and web arrow/Home/End/Page keys. Minute taps use
  the existing five-minute steps; dragging supports individual minutes. Exact
  existing minutes are preserved; keyboard/accessibility actions also adjust
  by one minute.
- **Date is a real, separate step:** it mounts the existing 48dp calendar,
  preserving keyboard navigation and explicit Android-safe selection circles.
  Time edits do not construct calendars/date labels. Date edits do not mount a
  time grid. Switching steps retains the chosen datetime and the tab's focus.
- Opening resets the draft before committing descendants, not in a post-mount
  effect. A session-scoped datetime formatter avoids repeated ICU construction
  during clock edits and respects the same hour cycle as the clock readout.

No hidden prewarming, delayed body reveal, artificial opening sleep or shortened
fade is used. The benchmark works with both exports and also measures switching
to Date and back to Time, to detect merely moving the pause to the second step.
Run with `ORDO_UI_REMINDER_PERF_ONLY=1` as above; the first-frame probe now accepts
either the baseline calendar or the complete new clock SVG. `dialogNodes` and
`controls` count descendants/interactive roles inside the dialog, not the app
background. Native frame timing still requires an attached device.

Paired release-web exports use baseline `2dfdc74` and PR #32's combined tree
(`6bc0ba3` plus that same baseline). Same ARM64 host, Chromium headless shell
1243, 390×844, dark, full motion, 4× CPU throttling; medians of three fresh
contexts per design mode, each cold + reopen:

| Mode / opening | First content before → clock (ms) | Largest task before → clock (ms) | Controls before → clock |
| --- | --- | --- | --- |
| Standard / first | 314.3 → 166.5 | 265 → 137 | 61 → 9 |
| Standard / reopen | 343.7 → 123.8 | 263 → 101 | 61 → 9 |
| Expressive / first | 341.3 → 172.9 | 301 → 145 | 71 → 7 |
| Expressive / reopen | 301.7 → 144.7 | 266 → 121 | 71 → 7 |

Standard uses en-US/12h and Expressive en-GB/24h in the timing harness; the
interaction matrix independently crosses both hour cycles with both modes.
Dialog DOM descendants fall from 245–266 to 82–86. Date-step medians are
109–161ms, and returning to Time is 71–100ms under the same throttle, below
the old opening stall rather than moving it intact to the next tap.

These are observed first-content reductions of 47–64%, not an isolated native
speedup or a zero-long-task claim. This shared host had other workloads; no
builds/tests from this session ran concurrently with measurement. Total
post-opening script/task time did not improve uniformly (Expressive cold total
task time was nearly unchanged), so do not turn the first-content result into
a blanket CPU/FPS percentage. First content is the first RAF observing the
complete interactive clock/calendar DOM, not the end of the unchanged fade.
Raw samples, CPU profiles and export source maps remain under
`/home/builder/ci/ordo-reminder-clock-oct17/artifacts/`, in
`perf-integrated-before`, `perf-integrated-after`, `baseline` and `clock`.

Validation on that combined tree: 617 mobile tests, 118 Material tests,
typecheck/lint, release-web and Android JS-only exports pass. Eight
light/dark × Standard/Expressive × 12/24h picker contexts pass (40 captures),
including tap/drag, one-minute precision, 24h inner ring, keyboard focus,
short windows, busy saves, quick Back/reopen and prevention of accidental SVG
text selection. The overlay matrix passes (24 captures). Handler tests execute
Android/iOS/web code paths, including cancelled/batched gestures; they are not
native visual tests. The broad legacy accessibility suite stops before the
reminder section on the same registration `aria-describedby`/Required-helper
assertion on baseline and clock builds. Auth is unchanged; that assertion was
not weakened to claim a green suite.

While this change was being merged, `cec6fce` removed the repository's test
suite and scripts. That removal is preserved: the clock validation additions
and modifications are not reintroduced into the shipping tree. The results
above were obtained before removal, using the archived harness; temporary
artifacts and `/tmp/opencode/reminder-clock-validation-archive.tar` retain the
validation evidence. The final merge continues with the repository's current
build/typecheck/lint CI gates.

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
  `node --experimental-strip-types scripts/build-icon-font.mjs`. Unknown names draw a folder glyph,
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
