# Android popup rendering investigation

The reported symptoms are delayed reader overflow/settings openings and very
choppy changelog sheet resizes in the installed APK, despite smooth web previews.
The affected phone is an iQOO Neo 7 running Android 16. The user reproduces the
problem on both current development and preview APKs, on most repeated openings.
The older 0.2.0 stable APK has slower menu opening but lacks the pronounced jank.

## What differs between the two builds

The Android UI is React Native 0.86.3 with Fabric and Reanimated 4.5.1, not the web
preview packaged inside a WebView. React Native Web uses the browser's layout and
compositor; Android uses native view mounting, Yoga layout, and Fabric shadow-tree
commits. Website content has a WebView, but the menu and dialog chrome does not.
A smooth desktop/browser recording cannot establish Android performance.

CI builds the APK with `assembleRelease`; EAS stable/preview also request APK
release builds. Hermes compilation retains `-O`. The app already requests high
refresh rates. None of these findings proves which artifact is on the affected
phone, but they rule out assuming that the repository always ships debug code or
simply needs a higher refresh-rate setting. At 120 Hz the frame budget is about
8.3 ms, compared with 16.7 ms at 60 Hz.

## Comparison with the smooth 0.2.0 stable release

The `v0.2.0` tag and current lockfile use the same resolved Expo 57.0.22,
React 19.2.3, React Native 0.86.3, Reanimated 4.5.1, Worklets 0.10.1, and Gesture
Handler 2.32.0. The EAS profiles are unchanged, preview extends stable, and neither
profile explicitly requests a debug Gradle variant. CI builds development variants
with `assembleRelease` too: the app's development identity does not imply an RN
debug build. R8/resource shrinking was added since 0.2.0, but is shared across
release variants. The evidence favors an application rendering regression over
a special optimization only available to stable builds; it does not establish a
particular device trace or exclude every build-related cause.

Two substantial changes are directly relevant: central background/overlay
blocking introduced in commit `8080709`, and adaptive/per-frame geometry changes
in the changelog and shared panels. The older menu used the same Reanimated
opacity/translation entrance and did not have these new hierarchy/resize paths.

## Confirmed structural defect: blocking toggled native view flattening

The new `OverlayBackground` wrapper defaults to a flattenable layout-only view.
Opening an overlay changes its `pointerEvents` from `auto` to `none`,
`accessibilityElementsHidden` from false to true, and
`importantForAccessibility` from `auto` to `no-hide-descendants`. In the installed
RN 0.86.3 `ViewShadowNode::initialize`, each of those active blocking properties
forces a native view / stacking context. Closing restores the flattenable state.
The same transition exists on each retained overlay layer when it becomes covered.

Fabric's `Differentiator.cpp` handles a change in the flattened state by
flattening/unflattening and reparenting native children. This can add mounting
work to every popup opening, closing, and sibling handoff, even when React keeps
the article fibers unchanged. This path did not exist in the 0.2.0 overlay host.

The fix sets `collapsable={false}` on the background and layer boundaries, matching
the existing non-collapsible overlay host. This retains one native parent across
blocking/coverage changes, while preserving pointer blocking, accessibility
isolation, retained exits, and paused background work. It does not disable view
flattening throughout the app or force every descendant to become a native view.

A second temporary component harness (`/tmp/ordo-overlay-boundary-regression.cjs`)
renders the actual host source and checks its props against the relevant installed
RN trait predicates. Baseline background/layer stacking contexts change
false → true → false; the modified boundaries remain true → true → true. It also
checks that input/a11y blocking lasts through exit and releases afterward. This
verifies the hierarchy boundary fix, not a native mounting duration or FPS gain.

## Confirmed code defect: resize frames re-entered React

`FloatingPanelSurface` used native `onLayout` on its animated outer surface to
call `setPanelHeight` for every intermediate height. That state was used to
calculate keyboard lift, including for bottom sheets where the calculation did
not need the panel height at all.

The changelog uses an adaptive bottom sheet. Selecting another release measures
new notes and springs the sheet height. Every changed native height then caused
a React render of the panel, new portal children, and another registry publication
through `OverlayPortal`. Those React commits competed with the next animation
frame. Web explicitly omits this `onLayout` handler, explaining a concrete
platform difference in the reported resizing path.

The fix removes `panelHeight` from React state. Sheets detach the outer size
listener after their initial ready measurement. Dialogs store size in a shared
value and derive keyboard lift on the UI runtime. Initial measurement, retained
exit contents, adaptive sizing, keyboard avoidance, and reduced motion remain
supported. The existing spring animation remains enabled.

A temporary React/DOM harness ran the actual baseline and modified panel source
with Android/Reanimated host mocks. After initial measurement, 60 simulated resize
reports produced these counts:

- Baseline adaptive sheet: 60 additional portal publications.
- Modified adaptive sheet: zero additional portal publications.
- Baseline dialog: 60 additional portal publications.
- Modified dialog: zero additional portal publications.

The harness also checks reduced motion, the web path, and dialog keyboard
appearance/dismissal. These are component regression results, **not native frame
times or measured FPS**. The harness is temporary (`/tmp/ordo-panel-regression.cjs`)
and does not introduce another test framework into the project.

## Reader menus: additional native costs requiring a trace

Reader actions and controls already own isolated open state, reuse prepared
content, and mount in the same-window overlay host. Opening them does not require
re-rendering the entire article in React. Nevertheless, native rendering can be
expensive even with memoized React components:

- Reanimated's default Android path sends animated styles through Fabric commits.
  The installed package defaults `ANDROID_SYNCHRONOUSLY_UPDATE_UI_PROPS` to false.
  Opacity/translation animations can therefore compete with layout and React
  commits on a large native article tree.
- Layout styles such as `height` and `width` require layout calculation per frame;
  running a worklet on the UI runtime does not remove that cost. The resize fix
  removes redundant React work but does not eliminate native layout work.
- A cold overflow waits for its body's measurement, placement publication, and
  the portal host's presentation acknowledgement before entrance begins. Native
  layout/measure callbacks are asynchronous. Prepared content reduces mounting
  costs, but does not guarantee that these commits fit a phone's frame budget.

These are additional hypotheses for the reader opening lag, not a device-trace
diagnosis. The native boundary and changelog defects are established from the
code independently; the relative contribution of each to phone frame times
remains to be measured.

## Feature flags checked against the installed versions

Upstream recommends the synchronous Android props path for non-layout animations.
It can bypass shadow-tree commits for opacity, transforms, colors, and radii.
However, it does **not** bypass layout for height/width, and upstream documents
incorrect React Native Pressable hit detection beneath transformed ancestors.
Our controls use RN Pressable by default; `nativeGesture` is a limited opt-in.
Enabling the flag globally without testing touches is therefore not the first fix.
A follow-up experiment should migrate/test the affected interaction surfaces and
compare an APK built with the flag against the same baseline device/build.

`USE_COMMIT_HOOK_ONLY_FOR_REACT_COMMITS` and
`FORCE_REACT_RENDER_FOR_SETTLED_ANIMATIONS` are already true by default in 4.5.1.
Adding them to app config would not introduce an optimization.
`DISABLE_COMMIT_PAUSING_MECHANISM` requires RN's matching
`preventShadowTreeCommitExhaustion` flag, which is false in the installed stable
RN defaults. Do not enable just the Reanimated half. Experimental animation backend
and broad experimental RN release levels are separate changes with wider scope.

Static flag changes require a rebuilt APK; an OTA JS update cannot change native
compiled flags. The current patch changes JS/worklet behavior and native view props only; it
does not enable a new compiled native feature flag.

## Device validation needed before calling the issue resolved

No Android device or emulator was attached during this investigation. The
component check, TypeScript/lint checks, and Android production JavaScript export
cannot establish the improvement on the affected phone. Typecheck and lint pass;
the Android export passes with `--no-bytecode`. The initial full Hermes export
failed with compiler exit 128, so a complete APK build has not been verified.

Use a release APK built from this change. Record the phone/model, Android version,
APK variant, app commit shown in About, active OTA commit if present, display
refresh rate, battery saver state, and Standard/Expressive mode. Compare the
baseline and changed build on the **same phone** with the same article and notes.

For each interaction, capture first use separately from ten repeated uses:

1. Open reader overflow, dismiss, and reopen on both a short and a long article.
2. Open reader settings and dismiss; change text size and theme; verify touches.
3. Switch changelog releases with short and long notes. Check both resize
   directions, release selector taps, scrolling, and handle dismissal.
4. Repeat with reduced motion and both design modes/color schemes. Test a dialog
   input with the keyboard visible and dismiss the keyboard before closing it.

For a focused native frame sample, open the target screen, substitute the installed
package below (stable is `com.axolet.ordo`; preview/development use their suffix),
reset counters, perform **only one** scenario, then collect the report:

```sh
ORDO_ANDROID_PACKAGE=com.axolet.ordo
adb shell dumpsys package "$ORDO_ANDROID_PACKAGE" > /tmp/ordo-package.txt
adb shell dumpsys gfxinfo "$ORDO_ANDROID_PACKAGE" reset
# Perform the selected scenario repeatedly on the phone.
adb shell dumpsys gfxinfo "$ORDO_ANDROID_PACKAGE" framestats > /tmp/ordo-frames.txt
```

Use Android Studio System Trace/Perfetto for the same scenario and inspect
FrameTimeline, the app main thread, RenderThread, JS thread, and native layout /
Reanimated commit sections. Distinguish tap-to-first-visible latency from dropped
frames after the entrance starts. Compare p95/p99 frame duration and missed-frame
counts, not only average FPS. The next experiment should follow whichever track
is actually blocking frames (JS, Fabric/layout, or GPU/rendering).

## Primary sources

- [Reanimated performance guidance](https://docs.swmansion.com/react-native-reanimated/docs/guides/performance/): Fabric regressions, layout animation costs, release builds, and synchronous shared-value reads.
- [Reanimated feature flags](https://docs.swmansion.com/react-native-reanimated/docs/guides/feature-flags/): fast-path scope, touch detection limitations, defaults, and rebuild requirements. Current docs include versions newer than our app; defaults and available flags above were verified in installed 4.5.1 sources and its Android Gradle configuration.
- [React Native view flattening](https://reactnative.dev/architecture/view-flattening): why layout-only views are omitted from the native hierarchy. The precise triggering props and reparenting behavior were checked in installed RN 0.86.3 `ViewShadowNode.cpp` and `Differentiator.cpp`.
- [React Native performance overview](https://reactnative.dev/docs/performance): JS versus UI frame rates and release-mode measurement.
- [Android slow rendering guidance](https://developer.android.com/topic/performance/vitals/render): frame budgets, release inspection, and Perfetto FrameTimeline.

The agent-reach CLI and Exa backend were unavailable. Its documented Jina reader
timed out; the official documentation was retrieved directly over HTTPS instead.

## Follow-up: blank screens and remaining Android motion (October 25)

The user confirmed that the first APK substantially reduced popup lag. Their
15.18-second recording still shows text stepping vertically as changelog releases
resize, then an entirely blank app background. They also report choppy native
page slides and blank screens after repeated reader overflow taps. The blankness
is on the physical phone, occurs without recording, and requires restarting the
app. This rules out a recording-only privacy mask as the explanation.

### Reproduced dependency defect: React 19 screen freezing

The installed React 19.2.3 and `react-freeze` 1.0.4 match the affected versions in
[react-native-screens#5053](https://github.com/software-mansion/react-native-screens/issues/5053)
and [react-freeze#44](https://github.com/software-mansion/react-freeze/issues/44).
Two frozen Suspense boundaries updated in separate renders can continuously hand
retry lanes to each other because the library throws a thenable that never
resolves. The upstream report measured hundreds of commits per second and zero
frames drawn in a three-second Android sample. The app enabled freezing twice
globally, and explicitly enabled it on both its tabs and native stack: it has the
configuration needed for this defect.

The linked [standalone upstream reproduction](https://gist.github.com/mauricedoepke/7a30499fa955e943a574329c72fcc32e)
was run locally with React/test-renderer 19.2.3 and react-freeze 1.0.4 in an isolated
temporary directory. It entered a sustained loop on round three: **153 commits in
100 ms without another application update**. Running the same reproduction with
`freeze={false}` settled at one commit per update in all 12 rounds.

The fix explicitly calls `enableFreeze(false)` once at the root, removes the
second enabling call, and sets both navigator `freezeOnBlur` options to false.
Retained screens keep their state; existing focus/activity scopes continue to
pause optional background work. The tradeoff is that retained screens can
reconcile normally instead of suspending their React trees.

This reproduces a real dependency failure and removes the vulnerable app
configuration. **It does not prove that this was the execution path on the user's
phone**, or that every possible source of blank screens is eliminated. If the
failure recurs in this build, capture logcat, JS CPU activity, and a Perfetto trace
rather than inferring the next cause from a recording alone. A synchronous
infinite loop also cannot be fixed by adding a JS timeout.

### Required page readiness now has a real deadline

`PageTransition` previously sent both transition completion and its fallback
through `scheduleIdleWork`, then a low-priority React transition. If idle work
never ran, the fallback never made reader/list content ready. The deadline now
cancels pending idle work and calls `setReady(true)` directly. Normal transition
completion can still use idle time.

An actual-source component harness (`/tmp/ordo-page-ready-regression.cjs`) withheld
idle callbacks. Both with and without `transitionEnd`, the baseline stayed
unready after its 450 ms fallback; the changed component became ready and
cancelled queued work. Unmount cleanup was checked. A blocked JS runtime must
still recover before any timer can run.

### Adaptive Android sheets use transforms instead of per-frame layout

The remaining changelog path still animated the native sheet's height. Bottom
anchoring therefore repositioned header/text through Yoga each frame and resized
the scroll viewport at the same time. Moving that spring to the UI runtime did
not remove native layout work or pixel-rounded text repositioning.

For Android adaptive sheets with pinned chrome, the native surface now has a
constant `heightLimit`. Its transform is offset by `heightLimit - adaptiveHeight`;
the unused lower part remains below the window. The body viewport receives its
new measured target height once. The absolute action row receives the opposite
transform, `adaptiveHeight - heightLimit`, keeping it anchored to the bottom.
Text moves through the surface transform without scaling fonts or updating text
layout each frame. The entrance, keyboard shift, and drag offset still compose
with that translation. Tiny/keyboard windows retain their existing all-content
scrolling path. Web, iOS, ordinary dialogs, and other sheet sizing modes retain
their prior geometry behavior.

Release changes also reset the existing scroll view after the portal commits
instead of changing its React key. This preserves native scroller identity,
scrollbar worklets, and compatible text instances. The existing release-content
fade remains enabled, including same-height release switches.

The actual-source harness (`/tmp/ordo-adaptive-regression.cjs`) verified:

- Android native surface layout remains 720 dp while the spring extent moves
  448 → 700 → 448 dp; body viewport stays at its 228 dp target.
- Container/action transforms cancel exactly, keeping the footer anchored.
- Spring samples cause no React portal publications.
- Three release selections mount one scroll view and perform three position
  resets, compared with three scroll-view mounts in the baseline.
- Reduced motion, compact Android, web, and iOS geometry paths remain supported.

These are structural/component checks, not Android FPS measurements. In the web
app, 24 rapid release switches also retained the identical DOM scroller, reset
its position to zero, finished visibly on the selected release, and preserved
modal background isolation. Mobile and wide viewports, light/dark themes and
Standard/Expressive modes were checked separately. Compact landscape scrolling,
reduced-motion swaps, dismissal and the active page's isolation release passed.
A separate Yoga layout model checked both fitted and capped sheet sizes with the
footer remaining at the viewport bottom through the sampled spring extents.

### Android helper no longer performs work on every draw

`ScreenSharePrivacy` previously reflected `WindowManagerGlobal.mViews` on every
`OnPreDraw`, and recursively scanned each native window on every global layout.
That runs on Android's main thread, including during unrelated animations, and
its cost grows with the article/view tree. This helper also existed in 0.2.0;
its presence alone cannot explain the regression.

The helper now caches reflection access once and scans on global-layout events,
coalesced to at most once per 250 ms with a guaranteed trailing scan. Transform
and opacity draws schedule no scanning. The existing blanket sensitivity opt-out
is retained, and the public activity decor is a fallback if an OEM blocks the
hidden-API reflection. Newly sensitive fields can remain redacted in a recording
until the next scan, up to roughly 250 ms plus main-thread scheduling. This
helper cannot explain physical-screen blankness; it is a separate overhead fix.

The **generated Kotlin**, not a reimplementation, was compiled with Kotlin 2.2.0
against a temporary Android API/scheduler stub harness. Under 600 draw passes and
60 layout events on a 1,000-view tree, baseline reflection lookup count was 602;
the changed helper's was one. Sensitivity reads fell from 62,128 to 7,018 for the
whole scenario, including new-window and trailing-scan checks. API <35, later
input insertion, discovered-window listeners, no periodic polling, and reflection
failure with a usable decor fallback were checked. This validates generated
syntax and scheduling, not Android framework integration or native build lint.
A rebuilt APK is required for this Kotlin change.

[AOSP Android 16 View.java](https://android.googlesource.com/platform/frameworks/base/+/refs/tags/android-16.0.0_r1/core/java/android/view/View.java),
[TextView.java](https://android.googlesource.com/platform/frameworks/base/+/refs/tags/android-16.0.0_r1/core/java/android/widget/TextView.java),
and the [Android sensitivity API](https://developer.android.com/reference/android/view/View#setContentSensitivity(int))
explain autofill-derived sensitivity and whole-window projection redaction.
Patching npm's `ReactEditText.kt` was rejected: this Expo Android build consumes a
prebuilt RN AAR, so that source edit would not reach the APK.

### Validation and remaining device work

Mobile TypeScript and ESLint checks passed, as did the Android production JS
export with `--no-bytecode`. No phone/emulator is attached. The Kotlin stub
compile and JS export are not a full Android APK build. The earlier local Hermes
compiler failure remains a host/build limitation to distinguish from CI results.

On the rebuilt release APK, prioritize 20 rapid long/short/same-height release
switches (including after scrolling), 20 reader overflow open/close cycles,
native page slides, rotate and drag-dismiss during resizing, reduced motion,
both design modes, and compact landscape. Check footer hits, notes links, Copy,
Back, keyboard dismissal, and return to the library. Verify password-field
recording behavior after the native helper change. Compare gfxinfo/Perfetto frame
durations with the prior APK on the same phone; a smooth web check cannot replace
this. No synchronous-props or experimental Fabric flags were enabled.

## Follow-up: first-selection blank screen and reportable failures (October 25)

The phone also goes blank on the physical display, sometimes on the first
changelog selection, and needs an app restart. It is not an intentional error
screen. The user subsequently confirmed this occurrence was on the new f6b74fa
APK (run 40186823795), with freezing already disabled. The freeze fix alone is
therefore insufficient; do not attribute this recurrence to the old freeze
configuration. The original dependency reproduction remains valid, but does not
establish the cause of this post-fix failure.
There is still no attached Android device or device trace for this occurrence.

### First-interaction audit

A second actual-source harness exercised ChangelogList, FloatingPanel,
useOverlayPresence, Segmented, and the parser with nine published release bodies:
cold open with data arriving mid-entrance; immediate first selection; empty notes;
a refresh removing the selected tag; interrupted selections; and unmount with
pending measurement microtasks. No render exception, invalid geometry, or
unbounded publication loop reproduced. The result was one scroller mount, six
resets, twelve portal publications, and 27 finite spring targets. Native/layout
APIs were mocked; this does not clear Android's renderer. The announcement host
opens once per build and persists its seen key, so a cold first opening and a
subsequent manual opening also differ in data/launch timing.

### Native stale-event guard

Installed Reanimated 4.5.1 dereferences EventTarget's InstanceHandle while reading
an event's tag. An event arriving after unmount can have a non-null target with a
null InstanceHandle. Upstream reproduced the resulting native crash and shipped
a guard in 4.5.4: read the tag from the retained ShadowNodeFamily, dropping the
event if that family has expired. RN 0.87 fixes the underlying dispatch race;
this app is on RN 0.86.3.

Backported the exact guard through pnpm's existing patchedDependencies mechanism,
keeping Expo's Reanimated/worklets versions. Reanimated compiles this C++ from
node_modules, so the patch reaches a rebuilt APK. It cannot be deployed as an OTA
fix. A compiled extracted-source harness checked live, null, expired-family,
and null-InstanceHandle targets, with both RN 86 and 87 preprocessor branches.
This confirms the guard's behavior, not that the phone hit this crash.

Sources: [Reanimated #9926](https://github.com/software-mansion/react-native-reanimated/pull/9926),
[4.5 backport #10208](https://github.com/software-mansion/react-native-reanimated/pull/10208),
[RN #56763](https://github.com/facebook/react-native/pull/56763).
The larger settled-animation registry change in Reanimated #9987 was initially
deferred; the later source-level reproductions and coherent backport are recorded
below. No experimental renderer/animation flags were enabled.

### Error screen and local evidence

The root error boundary now wraps the app providers. Its emergency screen uses
RN controls and a guarded palette snapshot, without the normal theme provider,
portal, gesture, or animation rendering paths. It supports Retry, report details,
and Copy report. Reload explicitly explains that it applies a downloaded update.
The old fallback reused theme/settings/update hooks, and could itself throw;
provider failures above its old placement were also outside its protection.
These were real coverage gaps, not a reproduced explanation of the phone blank.

Local diagnostics retain the previous session's last 24 discrete events and the
last captured error with bounded JS/component stacks and build/OTA metadata.
Route labels use useSegments file templates, not resolved reader IDs or URL
parameters. Changelog open/close and release selection are recorded; nothing runs
per animation/layout frame. ErrorUtils observation saves synchronously and
forwards to React Native's existing handler; it never swallows fatal handling.
Errors before this module loads, C++ exceptions, worklet-runtime errors, rejected
promises outside this handler, and blocked threads are not guaranteed captured.

About → Build details → Local diagnostics remains available after restarting.
The Android native module reads up to five system process-exit records (API30+),
with crash/ANR reason and timestamp. It reads at most 16,000 characters per ANR
trace and closes the stream. Native tombstone streams are binary and deliberately
not decoded as text. Missing/evicted history is allowed; a three-second JS deadline
keeps report collection usable when the native queue does not respond. It installs
neither a native exception handler nor a background watchdog.

[Android ApplicationExitInfo](https://developer.android.com/reference/android/app/ApplicationExitInfo)
uses public getReason/getDescription/getTraceInputStream APIs; getSubReason and
getTraceFile are hidden and not used. A live JS spin may produce no crash or ANR
record. Even a fatal record may be evicted by Android. Empty diagnostics cannot
prove that nothing failed, and a custom JS screen cannot draw during a deadlock
or after process termination.

Reports stay local until explicitly copied. URL, common credential, bearer/JWT,
and email patterns are removed; other exception text may contain personal data,
so the UI asks users to review before sharing. The MMKV file and CRC are excluded
from Android cloud backup and device transfer. The on-screen preview is capped;
Copy report collects the full report, including native history even on an
immediate tap. Clearing local history does not erase Android's system history.
Build metadata now resolves git from the config's own directory: evaluating Expo
config from another checkout previously could stamp an unrelated commit/branch.

### Validation

- Mobile TypeScript, ESLint, and Android production JS export passed.
- `pnpm --filter @ordo/mobile test:diagnostics` runs in CI: bounded retention and
  preview, redaction, previous-handler forwarding once, persistence across a new
  runtime, native history/rejection/timeout, clearing, and corrupt/unavailable/full
  storage. It compiles the actual TypeScript module with mocked platform services.
- Generated Kotlin compiled and ran against Android/bridge stubs: API29 fallback,
  API36 history, bounded/closed ANR stream, null description, binary-trace exclusion,
  and unavailable history. Full APK CI for de8e071 subsequently passed, including
  analyze, supply-chain, and build_apk (run 40190128666). This verifies the native
  build integration, not resolution of the phone's intermittent failure.
- Injected a real ThemeProvider render failure in the live web app (injection then
  removed): the outer fallback appeared, redacted details and commit were visible,
  Copy report succeeded, and Retry restored login. Verified 412px and 1280px layouts;
  mobile actions were 48px tall with no horizontal overflow. Build-details report
  opening, copy, and clearing also passed. Web UI checks do not validate the Neo7.

On the new APK, retry cold changelog opening/first selection as well as the prior
rapid-tap matrix. If blankness recurs, restart once and copy Local diagnostics
before repeatedly relaunching; compare current/previous commit, recorded actions,
error stack, exit reason, and timestamp. If it remains a live stall with no useful
record, obtain logcat/Perfetto rather than attributing it to a render exception.

## Recurrence on de8e071: live navigation after the first blank

The supplied report identifies a clean release APK at de8e071 on SDK36. The user
places the first blank during changelog version switching, and recovered by
swiping the task away and reopening. After the selections, the same JS session
still recorded changelog dismissal, several settings routes, a background/active
cycle, library, and reader navigation. The user subsequently confirmed the
display stayed blank throughout: these were blind taps and Back presses. Thus a
sustained global JS infinite loop cannot explain that interval. Navigation was
responsive beneath a persistently blank display; route events alone still do
not establish whether the failure was mounting, drawing, or a covering view.

`lastError` was null. The newest exit record was 11:26 UTC, whereas this session
ran at 13:51–13:52 UTC; the background low-memory records do **not** diagnose this
incident. Missing history also cannot prove the absence of a native failure.
Task removal does not always kill the app process, so subsequent reports now
include PID, process start elapsed time, and estimated process-start wall time in
each saved JS session. Exit entries include PID and process name, distinguishing
the app from isolated helper processes.

### Independent permanent-invisibility defect: settled animation syncing

The 4.5.1 collector registers nested animated wrappers once per native tag but
decrements its separate counter for each unmount. An actual-source JS harness
demonstrated a mounted view with no running sync timer after a nested view was
removed. This is relevant to the sheet's GestureDetector/animated-control nesting.
The committed regression checks timer restart, continuing delivery to surviving
views, duplicate removals, and repeated cycles without leaked timers.

The C++ registry also erases settled values older than two seconds **before**
returning them to React. A pause or delayed JS tick can therefore lose the final
value permanently; later React commits can restore the initial opacity or
transform while the shared value still holds the intended target. Re-animation
also leaves already-synced snapshots stale until a later settled sync.

Backported the complete coherent runtime/build change from
[Reanimated #9987](https://github.com/software-mansion/react-native-reanimated/pull/9987),
the 4.5-stable cherry-pick of [#9527](https://github.com/software-mansion/react-native-reanimated/pull/9527).
The existing #10208 guard remains included. No dependency versions or renderer
flags changed. The native fix requires a rebuilt APK.

A temporary C++ harness compiled the **actual** old and patched registry sources
against minimal JSI/registry-service stubs. At the first sync after five seconds,
old code returned zero values; patched code returned the final value. Patched
checks also covered one delivery per settled value, eviction after delivery,
re-animation invalidation, a pending batch not yet flushed, and unmount cleanup.
This validates registry bookkeeping, not Android mounting or actual frame times.

This is a confirmed defect in the installed dependency, **not a proven explanation
of the entire blank display**. The native navigation/root/overlay host ancestors
are ordinary views, so losing a changelog opacity cannot alone make every route
invisible. The independent research likewise found no animated root carrier that
establishes that explanation.

### Native mounting remains a separate investigation

Upstream [RN #57690](https://github.com/react/react-native/issues/57690) reports
native frames remaining stale across sibling changes on Expo57/RN0.86, despite
correct layout elsewhere; removing a particular flattened wrapper worked around
that reproduction. [#57800](https://github.com/react/react-native/issues/57800)
reports wrong-parent mount removals even with a previous differ fix enabled.
These establish relevant upstream failure classes, not their occurrence here.
Do not generalize the wrapper workaround to the entire app or swallow mount
exceptions: either can leave a different inconsistent hierarchy behind.

The installed `FabricUIManager` disables future mounting after a frame-dispatch
exception; it logs the exception before forwarding it. Such native failures are
outside a React render boundary. A custom error screen cannot repair a disabled
renderer, and a null JS error record does not exclude this path.

Explicit diagnostic collection now also requests the last 100 error-priority
logcat lines visible to the app's own UID. It requests no cross-app log permission
and runs no listener, polling loop, or per-frame work. Reading drains the command
pipe concurrently, caps output at 24,000 characters, times out after one second,
and destroys the subprocess; JavaScript redacts the returned strings. Logcat may
be unavailable, empty, or overwritten after restart; absence is inconclusive.
This can expose native mounting errors missed by JS and exit history. Generated
Kotlin passed process-identity/API checks, capped large-output and empty-output
checks, and a blocked-command timeout using Android/bridge stubs and a fake logcat.

If the rebuilt APK still fails, collect this report immediately after one
restart. Where ADB is available, capture while blank **before** restarting:
`adb shell dumpsys activity top`, app logcat, and `dumpsys gfxinfo`/Perfetto. Compare
the native hierarchy and frames with the expected route; accessibility alone
cannot establish correct background-only view frames. Logs mentioning mount
inconsistency narrow the investigation, but benign view-command warnings alone
do not identify a particular differ bug.

## Reader-settings recurrence on 86b4367

The user then reproduced the persistent physical blank in reader settings while
changing spacing (the control labels the relaxed line-spacing option "Wide").
Both saved sessions identify 86b4367. The affected session was PID27603; the next
launch was PID28812 with a new process start time. Android explicitly attributes
PID27603's exit to `REASON_USER_REQUESTED` / remove-task at 14:36:40 UTC, after
the reader route at 14:36:23. No matching crash or ANR is recorded. This is
stronger evidence of a live failure terminated by the user's task swipe; it does
not tell whether that session's JS/main/render thread was stalled at the end.
The earlier confirmation of blind navigation still establishes that rendering
can fail while JavaScript remains responsive.

The #9987 backport did not eliminate the whole-screen failure. It must not be
presented as its established cause or resolution. No new dependency or feature-
flag experiment follows solely from this recurrence.

### Correcting the missing log evidence

The report's native log result timed out. The previous collector kept its entire
result inside a future until EOF, discarding already-read output on a timeout.
The collector now retains a synchronized, bounded byte buffer as chunks arrive,
reports partial output plus timeout/unavailable status and byte count, explicitly
filters to the app UID, and allows 1.5 seconds. It still destroys the subprocess
on completion/timeout and requires no cross-app log permission. A fake logcat
that prints an error then hangs verifies that the error now survives the timeout.
Zero bytes on a timeout remains inconclusive, including on an OEM-restricted build.
The current filter also includes warnings, so Fabric's repeated
`Not flushing pending UI operations: exception was previously thrown` can
identify disabled mounting even after the original error has left the buffer.
Collection remains limited to 100 lines and 24,000 bytes. A report collected
after restart may still lack the previous process's log messages.

### Preserving native state before restart

Route, changelog, reader-controls, and reader-preference interactions schedule a
coalesced one-shot native hierarchy sample after 650 ms. There is at most one
pending/in-flight sample, with a two-second JS deadline. There is no recurring
heartbeat, draw/layout listener, pixel readback, or automatic recovery action.
The last two samples are retained in each JS session and survive restarting.

The native read runs on the main thread and includes window focus/alpha and up
to 40 view nodes: class, native tag, parent index, dimensions, visibility,
attachment, alpha, translation, scale, and elevation. It visits at most eight
children per sampled parent (first four and last four) with a bounded queue, so
late overlay siblings are sampled without walking a whole article. Native tags
are renderer identifiers, not article IDs. It never reads text/input contents,
accessibility labels, URLs, or screenshots. Samples can be truncated, and a
healthy sampled hierarchy alone cannot establish correct pixel output.
Normal visibility/alpha/transform values are omitted with their defaults stated
once per snapshot, keeping persistence work and copied reports compact.

Reader open/close and preference selections now also record enum/boolean changes
so the incident can be aligned with the native state. The old report only knew
that the reader route opened. Clearing diagnostics cancels pending sampling and
invalidates an in-flight result. Regression checks cover interaction coalescing,
retention limits, restart persistence, timeout without retry polling, and clearing
during a read; generated Kotlin checks cover broad trees, late siblings, invisible
root alpha, and an absent activity. These are harness checks, not phone validation.

### Narrow reader mitigation and feature-flag decision

The retained browser used `zIndex: -1` while parked behind the article.
[RN #58648](https://github.com/react/react-native/pull/58648) fixes incorrect
create/delete mutations during nested flatten/unflatten changes involving
negative stacking order; this fix is absent from RN 0.86.3. The parked browser
is already the first sibling and is hidden with opacity, pointer-event and
accessibility gates, so it can retain its position without a negative zIndex.
Remove that value while retaining the browser and those gates. This value also
existed in v0.2.0: removing an upstream defect ingredient is a robustness change,
not proof of a regression's origin or a fix for the changelog/global blank.
Device checks must cover article → website → article, then spacing changes,
and verify the parked browser stays invisible and untouchable.

RN 0.86.3 contains `fixDifferentiatorParentTagForUnflattenCase`, default false;
later RN versions enable it. It does not address every reported differ failure
(#57800 reproduces with it enabled). The generated application entry point
calls `DefaultNewArchitectureEntryPoint.load()`, which installs the stable
feature-flag provider itself. A normal additional `override()` conflicts with
that initialization. The suggested post-load `dangerouslyForceOverride()`
resets cached flags and explicitly warns about consistency issues; the custom
`loadWithFeatureFlags()` entry point is internal. Leave these startup APIs
unchanged instead of introducing a second flag-provider installation without
a supported integration. No native mount errors are swallowed or reset.

## Attached b16f51b report (2026-10-26, 02:24 UTC)

The attached report identifies affected PID20476 and replacement PID21058, both
running b16f51b. The last 24 actions show rapid typeface changes, then compact /
default / relaxed line spacing, then system / light / dark reader themes. The
user was tapping rapidly and cannot locate the first blank frame in that
sequence. Do not identify the final Dark selection as the established trigger.

The two retained native samples were captured at 02:24:29.305 and
02:24:30.351 UTC. Both have a focused, visible, hardware-accelerated 1080×2400
window with alpha 1. Sampled root ancestors have normal dimensions, visibility,
alpha and transforms; the elevated overlay branch contains a popup-sized tree.
Both samples are truncated at 40 nodes. The main thread completed these reads,
but neither a truncated hierarchy nor unchanged geometry establishes correct
pixels, healthy native mounting, or whether blanking had begun. The final
recorded theme selection was at 02:24:30.507; there is no later saved sample.
PID20476 exited at 02:24:49.666 with remove-task / user-requested stop. No matching
crash or ANR is recorded, and `lastError` is null.

The log collector succeeded (`timedOut:false`, `unavailable:false`, 23,996
bytes), but every returned app line is from the replacement PID21058. UTC
session times and the local log timestamps differ by +05:30. The buffer is
dominated by OEM `/proc/fas/render` ioctl denials, with image-load 404s, a detached
image-controller warning, and one invalid-resource-ID message. None supplies a
Fabric mount exception, disabled-mounting warning, native fatal, or ANR for
PID20476. These messages do not establish the blank-screen cause. In particular,
a failed image request in the replacement process cannot explain the previous
process's full-screen failure.

### Confirmed capture gaps and follow-up

A deterministic test reproduces a dropped final interaction: a preference tap
arrives while a previous native snapshot promise is still in flight; it updates
the event ring but requests no subsequent sample. One trailing, coalesced sample
now runs if an interaction arrives during a read. No new interaction means no
retry or polling. Clearing diagnostics also cancels the trailing request. This
is a confirmed diagnostics defect; it is not proof of what happened to the
phone's unsampled Dark selection.

Explicit report collection now prefers the previous session's PID and labels the
requested PID in the result, falling back to the current PID when no previous
identity exists. The native command retains its own-UID restriction, adds the
requested PID filter, and looks back up to 1,000 lines instead of 100. It includes
all errors and selected renderer/runtime warnings, including both the runtime
(R8-renamed) FabricUIManager tag and its `unknown:` logging-delegate variant.
Unrelated OEM warnings no longer consume the returned text budget. Reads remain
capped at 24,000 bytes / 1.5 seconds and preserve partial output. Older native
builds retain their original collector fallback. Android may still evict or deny
historical logs; an empty result is inconclusive. No renderer flag or recovery
behavior is changed in response to this report.

## Attached 2b8245c report and performance audit (2026-10-26)

The next report identifies affected PID9516 (JS start 02:44:18.987 UTC) and
replacement PID13059 (02:45:07.699), both running 2b8245c. The retained events
show rapid typeface changes. Samples at 02:44:44.345 and 02:44:45.057 have a
focused, hardware-accelerated 1080×2400 window with alpha 1; both are truncated
at 40 nodes. Some local retained popup/chrome branches have alpha 0, which does
not establish a hidden full-screen ancestor. The process and its WebView
sandbox exited on remove-task at 02:45:05, with no matching crash/ANR and no
recorded JS error. This remains a live-rendering failure of unknown cause.

### Correct the rejected native log command

The report's entire native log was:

```text
logcat: Invalid filter expression 'unknown:MountItemDispatcher:W'.
```

The earlier collector constructed tag filters containing `unknown:`. Android
splits a filter at its first colon, so this was an invalid command, not evidence
that the renderer logged no errors. The earlier stub test checked argument
presence without checking Android's filter grammar and missed this defect.

Use the valid `*:W` filter with the existing own-UID and requested-PID limits,
then filter irrelevant warning lines in Kotlin. Keep all errors and renderer /
runtime warnings, including the literal disabled-mounting warning regardless of
R8 tag names. Scan at most 256,000 bytes / 1.5 seconds and return at most 24,000
bytes after filtering; preserve partial output on timeout and mark command-error
text unavailable. Expose scan size/truncation. A permanent regression checks the
filter grammar and generated Kotlin newline escaping. Compiling and executing
the generated Kotlin against Android/RN stubs also covers a noisy-warning flood,
historical PID and own-UID arguments, command failure, timeout, and byte limits.
These checks do not replace execution on the phone.

### Measured work behind reader-setting and popup delays

The source audit used the actual ArticleHtml/native-html engine, preference
mutation/store, and overlay sources in disposable host harnesses. A 41 KB article
with 36 staged sections and 1,331 nodes reparsed all 36 sections on each isolated
typography change; host React render durations were approximately 165–202 ms.
Theme changes avoided reparsing but still reconciled the article. Only typography
was deferred; reader palette changes propagated urgently through theme context.
These are host JavaScript measurements, not phone frame timings or achieved FPS.

Preference changes also rewrote the token-only Quick Save sidecar and the full
secure auth snapshot. Server acknowledgements repeated the work. The background
library header subscribed to the entire user object. Reader controls/actions
preparation waited for all article sections, leaving an avoidable cold-open
window even after the first section was usable.

Changes:

- Keep selected controls and reader chrome immediate. Apply article typography
  and palette together after a 150 ms quiet window, at deferred React priority.
  A nested palette provider keeps an immediate chrome/theme update from walking
  the article underneath it. The article's own background uses the same delayed
  palette, preserving text/background contrast. Preview intentionally trails a
  tap by at least the quiet window; persistence and selection remain immediate.
- Serialize secure auth writes and retain only the latest waiting snapshot.
  Deletion uses the same queue so an old save cannot restore logged-out auth;
  signing in during deletion saves the new account afterward. Preference/profile
  updates skip the Quick Save sidecar because it contains no user preferences.
  There is no storage debounce: when writes finish between taps, each tap still
  saves. Credential/session changes still start immediately when the queue is idle.
- Prepare reader controls/actions after the first committed article section.
  Full readiness, progress restoration, heading refs, and Contents preparation
  still wait for the complete staged article. No article sections are virtualized
  away, preserving native text selection.
- Subscribe the library header to avatar-relevant primitives instead of the
  whole user object. Keep synchronous diagnostic event persistence so a failure
  does not lose its final interactions.

The updated actual-source harness staged all 36 sections, then applied nine
font/palette choices 25 ms apart: zero article parses during the burst and 36
after the final choice settled, with the final preferences/palette retained.
The first-usable callback ran after one parse; full readiness ran after 36.
The same deferred-only comparison still parsed during the burst. This verifies
coalescing and earlier preparation, not an Android FPS improvement. Separate
controllable-storage tests verify write coalescing, failure recovery, refreshed
tokens with newest preferences, logout ordering, and sign-in during deletion.

### Refresh configuration and remaining device checks

The existing Android plugin requests the display's highest same-resolution mode
on activity create/resume/attach. No new refresh policy or renderer feature flag
is introduced. Native snapshots now include requested refresh rate/mode and the
display's reported refresh rate/mode. These facts can reveal an OS-selected 60 Hz
mode; they cannot establish how many application frames were presented. The OS
can still clamp refresh under its display, battery, thermal, or OEM policies.

After installing the rebuilt APK, compare isolated and rapid font/spacing/theme
changes in a long article, then cold/warm three-dot and controls opens. Check
final server-synced preferences, logout/relaunch, article text selection, and
light/dark contrast. Repeat changelog switching separately. If blanking recurs,
restart once and copy diagnostics immediately: the corrected collector targets
the affected prior PID. Buffer eviction or empty logs remain inconclusive.
The global blank is not established as fixed, and it is not a confirmed React
error screen; a React fallback cannot render through disabled native mounting
or a compositor failure.

Validation after merging main's 56bb2c5: mobile typecheck/lint, persistence and
diagnostics regression tests, 16 Yoga popup layouts, animation-registry tests,
and the Android JavaScript export pass. Generated diagnostics Kotlin compiles
and passes the stub harness. Local Hermes bytecode compilation exits 128 for
both the new bundle and a pre-change exported bundle, despite emitting bytecode;
this ARM host is executing the packaged x86-64 compiler. Do not count that as a
passing bytecode check. The APK CI build must verify the production compiler and
real Android APIs; phone rendering/FPS checks remain outstanding.

## Attached d4bedbf report: the display runs the app at 60 Hz (2026-10-26, 06:16 UTC)

The first report from the d4bedbf APK (run 40265278314) adds measured display
configuration, a clean logcat result, and a new exit reason.

### The requested/actual refresh-rate mismatch is now measured, not inferred

Both retained native samples report `requestedRefreshRateHz` 120.0000076 with
`requestedDisplayModeId` 1 (our high-refresh request is installed and visible),
while the display's active `displayModeId` is 3 at 60 Hz (`displayRefreshRateHz`
and `modeRefreshRateHz` both 60) on the vivo I2214. So the app asks for the
panel's peak same-resolution mode and the OS serves a 60 Hz mode. At 60 Hz the
budget is 16.7 ms and every animation renders half the steps the user sees in
other apps on the same phone; that is a plausible, concrete component of "the
app feels slow" and "animations look low-framerate" without any code defect.

The plugin already applies the request on create/resume/attach, and neither
`preferredRefreshRate` nor `preferredDisplayModeId` can override OEM display
policy (user 60 Hz lock, "smart switching", battery saver, thermal limits). Two
static samples cannot distinguish an always-60 policy from a boost-during-motion
policy. The user can check Settings → Display & brightness → Screen refresh
rate on the phone: a fixed 120 Hz selection (rather than Smart/60) is the
fastest external confirmation.

### New frame-cadence instrumentation

The diagnostics module now also has `captureFrameStats(durationMs)`: a bounded
Choreographer window (clamped 250–3000 ms, used at 1400 ms) started at the same
discrete interaction triggers that schedule hierarchy samples (route,
changelog/reader interactions, resume). For each window it records frame count,
frame-interval percentiles/histogram (8.5/12/17/25/34/50/100 ms buckets),
missed-frame estimate against the start mode, the first 16 raw intervals, and
the active display mode at start/end plus mid-capture mode changes, along with
the still-requested rate/mode. One capture runs at a time (a concurrent request
resolves `busy` immediately); a Handler deadline guarantees resolution even if
vsync pauses; nothing per-frame runs outside the window. The last two captures
per session are retained across restarts like render samples. This turns
"does the OS ever grant 120 Hz during motion" and "does the three-dot
entrance drop frames at 60 Hz" into measurable report facts.

The generated Kotlin was compiled with Kotlin 2.2.0 against Android/bridge
stubs and executed through simulated vsync: steady 60 Hz delivery reports
18 frames in 300 ms with p50 16.7 ms and zero missed frames; a 200 ms stall
reports max 216.7 ms, the over-100 ms bucket, and 12 missed frames; a mid-window
mode switch is recorded as `change +240ms mode 1 120.0Hz`; busy, timeout, and
post-timeout reuse were checked. This validates generated code, not phone
behavior.

### Exit history adds a low-memory kill; logcat for the dead PID is empty

The system exit history shows PID 13059 was killed for **low memory** at 05:38
UTC while backgrounded, before the two tested sessions. That explains some
fresh restarts users can read as crashes, but not a mid-session blank. PID 16299
(the tested session) exited by user remove-task at 06:16:19 with no crash/ANR
record, and its replacement launched 3 seconds later and navigated normally.

The corrected prior-PID logcat collector ran successfully
(`timedOut:false, unavailable:false`) and returned zero bytes. The b16f51b
report already proved this device returns own-UID warning lines when present,
so the empty result means the dead session's final moments logged no
W/E-priority lines still in the buffer — consistent with the silent
renderer-stop class, and not with a logged native crash. Because buffer
eviction and clean swipes can both produce zero bytes, explicit collection now
also fetches the current process's log in that case and attaches it as
`androidErrorLogCurrent`, so live renderer warnings (for example disabled
mounting) still reach the next report.

### First d4bedbf burst observation

The tested session performed 24 typeface selections within ~3 seconds (the
historical blank-screen trigger pattern) plus controls open/close, then ended by
a normal user swipe with no blank, no crash, no ANR, and no logged native
warning. One clean session cannot establish that the blank is fixed; it is the
first post-coalescing datapoint. The frame captures above will show whether the
settled reparse still stalls the main thread at 60 Hz.

## Attached 1f1fffd report: cadence measured; the OS never grants 120 Hz (2026-10-26, 09:00 UTC)

The first report with callback captures measures the selected display mode and
main-thread Choreographer cadence on the vivo I2214. It does not measure actual
application frame presentation.

### The 60 Hz policy holds during real motion

Every retained capture (two reader-controls openings, changelog close, settings
route) starts and stays in mode 3 at 60 Hz with `modeNotes` showing no change,
while `preferredRefreshRateHz` 120.0000076 / `preferredDisplayModeId` 1 remain
installed for the whole window. The earlier static samples could not exclude a
boost-during-motion policy; these windows cover the exact interactions in
question and exclude it. With current phone settings, this app is served a flat
60 Hz. App code cannot override that; the user-side check is Settings → Display
& brightness → Screen refresh rate (choose a fixed 120 Hz rather than Smart/60)
and repeat the same test. If the OS then grants mode 1, the next report's
captures will show it directly, and the perceived slowness should drop.

### Controls-open callback cadence stays near 60 Hz

Reader-controls openings measured 82 of 83 intervals at 12–17 ms with p95
16.84 ms and at most a single 33.5 ms missed frame in one window (zero in the
other); the changelog close and route windows measured similarly (81/82 at
16.8 ms and 83/83). During these windows the sampled main-thread callbacks keep
a near-60 Hz cadence. This does not prove that every animation frame is drawn
or presented; RenderThread, mounting, or compositor failures remain possible.
The separately audited measurement/placement publication handshake is another
source of pre-entrance delay.

### Second clean trigger-pattern session; collection regression found and fixed

The prior session ran eleven rapid changelog release switches, three controls
open/close cycles, and a rapid typeface burst with no blank, no crash, and no
JS error; it ended by a user swipe during a trailing capture (the last stored
captures are the two controls openings, exactly what the retention window
predicts).

That report's native section was lost to a regression: `androidExitHistory`
returned "Native diagnostics timed out". The added current-process logcat scan
ran concurrently with the prior-process scan, and two concurrent scans over
this OEM-flooded buffer breached the previous three-second budget; the race
then discarded the already-settled exit history. Explicit collection now runs
the current-process scan only after the prior scan settles, uses a 5.5-second
budget, and keeps whatever results already settled when the deadline fires
(missing sections are labeled as timed out). Regression tests cover the
sequential order, deadline salvage of settled history, the empty/non-empty
fallback decision, and late settlement.

## Blank recurrence on 1f1fffd and incident protocol (2026-10-26)

The user reports the blank screen recurred on 1f1fffd, with no captured error
(no report from the affected session has been supplied yet). Past incidents
established that JS navigation stays responsive under the blank, so blind taps
still record route/reader events — and on current builds they also record frame
captures and hierarchy samples during the blank. The incident protocol for the
next occurrence, with a screen recording running:

1. Note the time (or the recording timestamp) when the screen goes blank.
2. Blind-tap through several interactions: open/close the reader three-dot,
   change one reader setting, navigate back and into another screen. Each fires
   events, frame captures, and view-tree samples during the blank.
3. If reachable blind: Settings → About → Build details → Copy report **while
   the screen is still blank**. Collection now always includes this process's
   log (labelled `androidErrorLogCurrent`) alongside the prior-PID scan, so a
   during-incident collection captures the affected process's live renderer
   warnings (for example Fabric's disabled-mounting message) without a restart.
4. Otherwise swipe the app away, reopen, and copy the report; the corrected
   collector then targets the affected prior PID first and keeps partial
   results on a deadline.

Interpretation limit: normal Choreographer callback cadence during a blank
would show that those main-thread callbacks still run. It would not establish
successful drawing/presentation or distinguish mounting from a compositor
failure. A timeout or zero callbacks also needs lifecycle and thread evidence;
it does not by itself prove Surface loss. The earlier incident guidance
overstated how decisively this measurement could distinguish those failures.

## b9034cd recording and native warning evidence (2026-10-26)

The supplied 28.255-second recording shows the article, overflow menu, and
reader controls, then rapid typeface switching. Frame 208 at PTS 5.333 still
contains the reader UI. Frame 209 at **PTS 5.358** is the first black app frame;
the Android status bar and recording indicator remain visible. App pixels stay
black through the end. Video frame rate/PTS are recording metadata, not a
measurement of presented application FPS. The recording has no seconds-level
wall-clock overlay, so exact alignment to UTC event times is approximate.

The report identifies affected PID13055 and replacement PID14723, both on
b9034cd. The affected session ends with rapid typeface events through
09:34:51.251 UTC. Its retained callback captures start at 09:34:48.271 and
09:34:49.766, lasting 1465 and 1410 ms; both report mode 3 / 60 Hz and regular
~16.76 ms callbacks against a requested 120 Hz. The retained hierarchy reads
are at 09:34:49.931 and 09:34:50.668, with normal sampled root dimensions and
alpha, truncated at 40 nodes. None establishes a post-blank native state. The
absence of later persisted callbacks/samples could reflect JS/runtime failure
or other interruption; this report cannot assume JS continued after blanking.
The process exited only on user remove-task at 09:35:44.833, with no matching
crash/ANR and `lastError: null`. A live process and a null JS error do not prove
the React runtime/surface remained healthy.

### Confirmed stale-view synchronous updates; earlier exclusion was wrong

The affected process log contains this exception:

```text
15:03:27.892 W Reanimated: synchronouslyUpdateUIProps failed for tag 1268
java.lang.reflect.InvocationTargetException
Caused by: RetryableMountingLayerException:
Unable to find SurfaceMountingManager for tag: [1268]
```

Its stack runs from react-native-screens' legacy draw animation/event dispatch
through `NodesManager.performOperationsRespectingDrawPass`,
`performNonLayoutOperations`, and `NativeProxy.synchronouslyUpdateUIProps`.
Local time here is UTC+05:30. This warning is at 09:33:27 UTC, about 80 seconds
before the recorded interaction burst, while the UI remained usable. It is a
confirmed defect, not proof of the later whole-app blank.

Earlier audits excluded this path because
`ANDROID_SYNCHRONOUSLY_UPDATE_UI_PROPS=false`. That exclusion was incorrect:
the flag gates normal `performOperations` updates, but the draw-time
`performNonLayoutOperations` path calls `applySynchronousUpdates` unconditionally.
The actual phone stack independently confirms that reachability.

[Reanimated #10435](https://github.com/software-mansion/react-native-reanimated/pull/10435)
fixes precisely the logged stale-tag failure. Backport its existence guard and
concise unexpected-error logging into the existing 4.5.1 pnpm patch, retaining
the RN-before-0.86 branch. Check existence on each update, not once per tag;
skip only the immediate native write when the view is absent. Props remain in
the registry for normal shadow-tree commits. Unexpected reflection failures
remain visible, without formatting a complete throwable on the UI thread.
Reanimated's consumer ProGuard rules already keep the Fabric methods used by
reflection. No feature flag, Expo pin, animation timing, or renderer recovery
behavior is changed.

The same older log includes `BLASTBufferQueue` acquired-buffer-limit errors and
an OEM `Surface.setFlingType` error at 09:33:25 UTC. These precede a minute of
visible UI, so they do not identify the black-frame cause. Similar buffer
messages are reported without visible failures in other Android apps; do not
apply Flutter/Impeller workarounds to this React Native application.

### Native log retention concealed later evidence

The collector timed out after reading 131,072 bytes, returning the first 24,000
bytes. Both `unavailable:false` and `scanTruncated:false` coexist with a partial
read and truncated output. Repeated, full Reanimated stacks filled that output
with 09:33:27 messages, so it contains no incident-time log. A successful partial
read is not evidence of silence after the returned timestamp.

Request the last 300 matching log lines instead of 1000 to reduce read volume
under the same 1.5-second deadline. When filtered output exceeds 24 KB, retain
the opening ~6 KB and recent ~18 KB with an explicit middle-omitted marker;
report `outputTruncated` separately from `scanTruncated`. Retention describes
the bytes actually read, not a guarantee that the system buffer was exhausted.
Own-UID/PID filtering, redaction, read bounds, and partial-result salvage remain.

### Validation and remaining uncertainty

`test:android-native` extracts the installed NativeProxy implementation and
generated Kotlin excerpt rather than duplicating their logic. It compiles and
executes them with JVM fakes, checking mixed live/stale batches, unmount between
calls, unexpected live failures, older lookup/API compatibility, recent-error
retention under a stack flood, and the UTF-8 byte bound. Run it with a Kotlin CLI
compiler and Java, for example:

```sh
KOTLINC=/path/to/kotlinc pnpm --filter @ordo/mobile test:android-native
```

The full generated diagnostics module also compiles against the existing
Android/RN stubs and passes cadence/mode/timeout checks. Mobile lint/typecheck,
diagnostics, persistence, and animation-registry regressions pass. These verify
the guard and capture changes; they do not reproduce the phone's whole-app
black state. A rebuilt APK is required. The global blank remains unresolved
until the narrower fix is exercised on the phone and incident-time evidence
identifies the actual native/runtime failure. No additional USB capture is
required to collect the corrected on-device report.

## 2ad9662 phone report: invalid animated color destroys the React runtime

The subsequent report identifies affected PID 21284 and replacement PID 24219,
both on 2ad9662. Its previous session ends with rapid typeface selections through
11:51:20.131 UTC. At **11:51:20.308 UTC** (17:21:20.308 phone-local), the affected
process logs the first direct failure linking the interaction to runtime teardown:

```text
W unknown:BridgelessReact: ReactHost{0}.handleHostException(message =
  "[Reanimated] Invalid color value: \"rgba(28,53,49,4.2036685545777925e-7)\"")
W unknown:BridgelessReact: ReactHost{0}.getOrCreateDestroyTask():
  Starting React Native destruction
```

The stack runs through Reanimated's `processColor`, props builder,
`styleUpdater`, and UI-runtime mapper queue. The teardown starts four milliseconds
after the exception. Later callbacks are dropped on a finished thread; at
11:51:47.928, a window-focus callback reports that the React context is not ready.
Android records process removal only when the user swipes the task away at
11:51:49.362. Thus `lastError: null` and no process crash/ANR do not mean no fatal
runtime error occurred. A React error boundary cannot show its fallback after
the native host has destroyed the React runtime.

The shared shaped-control feedback in `PressableScale` constructs an RGBA string
from the raw spring intensity. Small positive release-tail values stringify in
scientific notation. The installed Reanimated `Colors.ts` NUMBER matcher accepts
decimal notation only; its native style processor throws on the exact report
value. `Segmented` uses this feedback in both design modes, including changelog
versions and reader preferences. The fault is in the feedback paint rather than
the selected font, article parser, or preference persistence.

Round the clamped alpha to three decimal places before constructing the color,
matching the installed Reanimated `rgbaColor` helper's precision. This ensures
all finite spring values yield decimal alpha in [0, 1], including fully
transparent release, without changing spring timing, reduced motion, element
opacity, or rounded-clip behavior. Other RGBA generation in the app is static;
the other Reanimated controls use `interpolateColor`, whose RGBA helper already
rounds alpha.

The existing `test:animations` check now extracts and executes the actual
`layerStyle` callback through the installed Android color processor. Before the
fix, it fails with the exact on-device color exception. After the fix, it passes
2,654 release-tail, interrupted-fade, subnormal, endpoint, and overshoot values,
checking RGB preservation, fully transparent release, and alpha accuracy within
native 8-bit precision. It runs in CI alongside the registry regressions.

This report's log scan completed without timeout or raw scan truncation. Its
head/tail excerpt retained both the initiating exception and later teardown
aftermath despite output truncation. No stale-tag update warning appears in the
retained text; that alone does not prove none occurred in omitted lines.

This is a confirmed failure mechanism for this occurrence and a source-level
reproduction of its exact exception. It is not retrospective proof that every
earlier blank had the same cause. Phone validation of the corrected feedback is
still needed. The sampled display mode remains 60 Hz despite a 120 Hz request;
that separate observation does not explain the runtime destruction or establish
presented application FPS.
