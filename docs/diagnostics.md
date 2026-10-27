# Local diagnostics

Ordo includes a phone-friendly diagnostics page in **Settings → About → Build details → Diagnostics**. It is also available from sign-in, the offline screen, Build details, and the render-error fallback. An account, a reachable server, and USB debugging are not required.

## Recording and reports

**Save diagnostic logs** is on by default. It keeps a small history of app activity and recognized errors on the device. It does not sample performance or inspect the view hierarchy.

On Android, **Check performance** immediately starts one 15-second main-thread timing sample, then captures a bounded layout summary and saves both with the logs. A temporary overlay shows progress while you reproduce the slowdown elsewhere in Ordo. You can hide the overlay without stopping the check, or use **Stop performance check** to cancel. The check ends automatically; leaving the app, signing out, deleting logs, or disabling logs cancels it. No extra recording mode needs to be enabled first. The internal detailed-mode gate remains for bounded collectors; it is not a second kind of event log.

To report a problem:

1. Open Diagnostics. For a slowdown, tap **Check performance**, then return to the affected part of the app during the check.
2. Use **Mark a problem** after something goes wrong. **More details** shows saved measurements, recent errors, and history controls.
3. Create a report. **View report** opens its fixed preview; **Choose sections** lets you remove optional data.
4. Save or copy the report and attach it to your own issue report. Include what happened, what you expected, and reproduction steps separately.

If the display stays blank, close and reopen the app once, then create a report. Recognized native host errors can survive React runtime destruction. A missing error does not prove the app was healthy.

Nothing is automatically submitted. A report is collected once and frozen; new actions do not change the preview or saved bytes. Creating a report waits until a running check finishes or is stopped, so it includes saved results rather than interrupting the check. Turning logs off deletes app-managed history and revokes pending reports/exports. While off, **Create report** includes build facts only and does not scan Android logs or exit history.

## Privacy policy for this feature

Diagnostic inputs are converted to a closed technical vocabulary **before persistence**. Unrecognized text is omitted instead of being redacted with best-effort regular expressions.

Reports may contain validated build version/commit/origin, OS family/API version, screen categories, approved typography/theme choices, relative timing, coarse operation outcomes/duration buckets, grouped error codes, approved numeric bundle locations, numeric Android exit reasons, and explicitly captured layout/cadence summaries. Report references are fresh per report. No telemetry or installation identifier is read or reused.

They exclude IP addresses, server addresses, request paths, headers/bodies, credentials, account/bookmark/folder IDs, email, article/title/selection/search/form text, clipboard contents, screenshots, raw native logs, unrestricted exception messages, and arbitrary class/thread names. Exact event dates, process IDs, and local wall-clock anchors are not exported. Native timing and session-start ages are approximate context, not proof that an incident belongs to a particular session.

The recording choice stays on the device and is not synced to an account. Evidence is private app storage, excluded from Android backup/device transfer. iOS evidence lives in the cache directory; the recording choice uses a device-only Keychain item. Web uses bounded browser storage, subject to browser/private-mode eviction. App-private storage is not a claim of encryption or forensic secure erasure.

Saving, copying, or explicitly sharing creates a copy outside Ordo's control. Local deletion cannot remove it. Export staging uses private cache with a content-free filename; completed Android Save As deletes staging immediately. A system share retains at most one pending staging file for up to 15 minutes of JS runtime, replaces it on the next export, and removes orphaned files on startup. OS suspension can delay the timer; startup cleanup covers process death. No broad storage or overlay permission is added.

Existing install telemetry is a separate feature; see [telemetry.md](telemetry.md). Diagnostics neither uploads through that pipeline nor changes its behavior.

## Coverage and cost limits

- Current plus two previous sessions; 256 breadcrumbs per session; 20 grouped errors; four measurement summaries; 72-hour retention, checked on access/startup/write. No expiry wakeup runs in the background.
- Routine events append in memory, with one dirty batch per second. Fatal JS recording writes a small sanitized marker before forwarding the original handler exactly once. Duplicate fatal categories do not rewrite the marker continuously. The native fatal journal uses five fixed code slots and a duplicate-write guard.
- Native recording policy is loaded before React starts. Incomplete/corrupt policy fails closed. Disable/delete advances a persisted cutoff and generation so older OS evidence and late capture results cannot restore deleted data.
- Android capture uses public exit metadata and bounded own-UID/PID/time-scoped log parsing. Raw bytes never cross into JS or reports. Recognized host exceptions are observed through Expo's public host handler, preserving the original exception and other Expo handlers.
- Cadence capture is explicit, at most 60 seconds, with a fixed histogram. It reads display Hz without changing refresh-rate settings. **Choreographer cadence is not presented FPS.** There is no GPU/compositor profiler or continuous JS-lag probe.
- Rendering capture reads at most 40 native nodes from a bounded queue, with fixed type enums and numeric geometry/visibility. It never reads labels, text, tags, test IDs, URLs, or pixels. It cannot prove what SurfaceFlinger displayed.
- Overlays are pointer-transparent, accessibility-hidden app views, with a stable root outside portal/focus bookkeeping. Hidden readouts do not clone the event ring; visible readouts update at most once per second. Performance shows an active measurement or a stopped last sample, not an invented live frame rate.
- Export is capped at 512 KiB; retained validated records are capped by count and a 700,000-byte serialized ceiling. MMKV is trimmed after deletion and if its allocated size exceeds 1 MiB. Actual device IO/memory budgets still require measurement.

Basic breadcrumbs cover startup, screen categories, app state, changelog/reader settings, shared overlay entrance/exit, API/auth-refresh results, library cache hit/miss, preference/credential write outcomes, update checks/downloads/apply requests, import upload, export/save, and observed Quick Save success. Native Quick Save failures, every cache lookup, arbitrary application state, and every OS event are not recorded. Generic native incidents remain explicitly unrecognized. Instrumentation does not inspect payloads to fill gaps.

Android offers the native collectors above on supported APIs/builds. iOS/web offer the typed recorder, JS errors, controls, reports and export; Android-only evidence is marked unavailable. No native iOS crash journal or equivalent timing collector is claimed. Basic mode never starts frame/hierarchy sampling. Background cancellation intentionally discards in-flight JS measurements, including native partial results from the stopped generation.

## Verification and release gates

Automated checks execute actual TypeScript recorder/facade/export sources and compile generated Kotlin plus the public Expo host hook against JVM fakes. They cover secret/getter inputs, schema filtering, 100,000-event floods, retention, failed/corrupt storage, fatal recovery, generations, off/delete during capture/export, exact selected report bytes, system handoff cancellation, share-cache lifetime, platform policy persistence, real padded log templates, histogram aggregation, lifecycle cancellation, and removal of queued UI collectors.

Commands:

```sh
pnpm --filter @ordo/mobile test:diagnostics
KOTLINC=/path/to/kotlinc pnpm --filter @ordo/mobile test:diagnostics-native
KOTLINC=/path/to/kotlinc pnpm --filter @ordo/mobile test:android-native
pnpm --filter @ordo/mobile typecheck
pnpm --filter @ordo/mobile lint
pnpm --filter @ordo/mobile test:animations
pnpm --filter @ordo/mobile test:reader-performance
pnpm --filter @ordo/mobile check:overlay-layout
```

CI installs a checksum-verified Kotlin 2.2.0 compiler for the native contract gates. Expo prebuild/autolinking additionally verifies startup policy installation, generated files, backup exclusions, and discovery of the local host-observer module. A real Android Gradle build is required for the native changes; they cannot be delivered by OTA alone.

**Still required on physical release builds:** observe the public Expo host-error hook during an actual runtime teardown; Android instrumentation of real Handler/Choreographer/logcat/exit-history lifecycle; system share/Save As URI behavior; TalkBack/VoiceOver, large fonts, keyboard/Back, portrait/landscape/wide layouts, light/dark and Standard/Expressive; iOS backup/Keychain/export behavior; and off/basic/detailed/overlay performance A/B runs plus a 30-minute lifecycle soak. JVM fakes and typechecking do not establish these results. No physical device was available during implementation, and no claim of perfect capture, presented FPS, or measured device overhead is made.

Implementation verification on 2026-10-26: the automated commands above passed, as did Android prebuild/autolinking and production web export. Android JavaScript export passed with `--no-bytecode`. The full local Hermes export failed with compiler exit 128 without an actionable error in this container; native/bytecode build validation remains with the APK CI run. No app runtime configuration was changed to work around this local compiler result.
