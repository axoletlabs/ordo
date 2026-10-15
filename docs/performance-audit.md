# Performance audit (October 2026)

Baseline: `release/0.2.0` (`faa9bed`). Branch: `perf/app-optimization`.

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
