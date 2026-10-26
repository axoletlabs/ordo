# Production diagnostics plan

Status: implemented on the working branch; physical-device release gates remain outstanding. This is the original specification audited on 2026-10-26 at `bee0613`. See [diagnostics.md](diagnostics.md) for implemented coverage, privacy rules, test commands, and explicit limits.

Sections describing the “current implementation” below refer to that pre-feature baseline. The specification includes follow-up sources and device budgets that are not yet verified or enabled.

## 1. Product contract

Make troubleshooting usable from a phone in every release variant. A person should be able to reproduce a problem, inspect a readable explanation of the evidence, and deliberately export a useful report. It must work without a development build, ADB, an account, or a live server connection.

Recommended defaults:

- **Local diagnostics: on.** A small, bounded recorder of approved technical events and error categories. Explain this in Settings and the privacy policy. No uploading, extra network requests, or remote control.
- **Detailed recording: off.** An explicit foreground recording of up to five minutes, with a countdown, Stop action, and manual “Mark issue” button. It uses the same privacy rules as basic recording.
- **Information overlays: off.** Session-only, individually enabled, and automatically removed on backgrounding, screen lock, recording expiry, or restart.
- **Turning local diagnostics off stops collection and deletes app-managed history and pending exports.** Explain the deletion beside the switch. No configuration sync to an account. Existing copies saved or shared by the person are outside the app's control.

This is local technical evidence, not a recording of everything someone does. Avoid a raw-log mode, a hidden support override, automatic attachments, and automatic issue submission. Basic recording must be safe enough that forgetting it is enabled does not expose content or consume meaningful frame time.

These defaults are recommendations made for this plan; “on device by default” does not require unlimited or detailed recording by default.

## 2. What the current implementation establishes

| Existing piece | Keep or change |
| --- | --- |
| `src/lib/local-diagnostics.ts`: current/previous sessions, 24 events, error capture, error-handler chaining | Preserve the lifecycle/error-handling behavior; replace the free-form event payload and whole-report write on every action. |
| `plugins/diagnostics-kotlin.js`: own-UID/PID logcat, exit history, hierarchy metadata, bounded Choreographer samples | Reuse bounded collectors after adding native policy, cancellation, and structural filtering. Move interaction-triggered sampling out of basic mode. |
| `ErrorBoundary.tsx`: independent fallback outside app providers | Preserve independence. Use the same safe report serializer, including when settings/providers fail. |
| `settings/build-details.tsx`: report panel | Replace with a real Diagnostics destination; keep a link from Build details and the error fallback. |
| `import-export-file.ts`: system document save/share | Reuse the platform adapters, with diagnostics-specific cache expiry and cleanup. The existing fallback/iOS paths do not provide a complete diagnostics retention policy. |
| Android backup exclusions | Extend to every new diagnostics file, journal, preferences file, and export staging location; verify generated manifests/rules. |

The most recent phone report contains a native host exception caused by an invalid Reanimated color, followed by destruction of the React runtime without an OS process crash. That proves exit history and JS error boundaries alone are insufficient. It does **not** prove every historical blank has this cause.

Current privacy is insufficient for the proposed feature. A direct test of the actual `redactDiagnosticText` function passed through bare IPv4/IPv6 addresses, content URIs, local file paths, private hostnames, and arbitrary article text. Existing URL/email tests pass. Adding more regex replacements would still leave arbitrary text unsafe.

Existing stable-build cloud telemetry is a separate subsystem (`src/lib/telemetry.ts`, `telemetry-policy.ts`, `docs/telemetry.md`) with an install identifier and coarse counters. Diagnostics must never reuse that identifier or pipeline. Describe this feature as “diagnostic reports stay on your device until you export,” not “the app never sends anything.” A diagnostics switch must not silently change unrelated telemetry behavior.

## 3. Settings and reporting flow

Add **Settings → Help & troubleshooting → Diagnostics**, accessible before sign-in and while offline. An About/Build details shortcut leads to the same screen. Use `SettingsPage`, `SettingsGroup`, `SettingRow`, shared switches/buttons, Material typography/colors, and `ConfirmDialog`; no separate visual system.

The page contains:

1. **Recording:** master switch, what basic recording includes, retention/storage usage, and Delete history. Show unsupported collectors without suggesting the app is healthy.
2. **Record an issue:** Start detailed recording, remaining time, Mark issue, Stop, and an immediate Create report action. If detailed mode is unnecessary, a report can use existing basic evidence.
3. **Recent issues:** grouped categories, relative time, counts, and affected build. “No captured error” must not become “No problem found.” Group duplicate errors without losing first/last occurrence or dropped-event counts.
4. **Information overlays:** independent toggles and explanations of what each measurement actually means.
5. **Reports:** inspect a frozen report, include/exclude optional sections, save a file, copy sanitized technical text, or discard. No account connection required.

Report flow: **Create → collect bounded approved evidence → freeze a snapshot → review categories and readable timeline → choose sections → export the exact reviewed bytes.** Changing sections regenerates the preview and export together. Saving/copying does not collect a newer report behind the person's back. Export may identify the build, OS/API, and technical settings; make that visible before sharing.

Offer a short reproduction template (“What happened / What you expected / Steps”) separately. Do not persist typed descriptions in the recorder or insert them into the technical report. The person can add context at the issue destination. A fixed public support link opens only on explicit action, never with report data or tokens in its URL. No screenshot/video capture; attachments remain a separate choice.

If basic recording is off, explain that past evidence is unavailable. A clearly labeled **Create one-time report** may collect a sanitized build snapshot and explicitly selected current measurements without starting history or enabling persistent recording. No historical logcat/exit-history scan in this path. The error fallback may expose the same one-time sanitized details without turning recording back on.

## 4. Data contract: allowlist before storage

No caller can submit an arbitrary `detail: string` or spread a state/native response object into a report. Define a discriminated event union and validate it at runtime on **both** JS and native boundaries. Unknown properties/enum values are discarded and counted; oversized records are dropped. Do not call untrusted getters, `toJSON`, `toString`, or serialize arbitrary error objects. Use bounded parsers, not recursive object dumps.

| Area | Approved evidence | Never collect or export |
| --- | --- | --- |
| Build | Validated app/bundle versions, immutable commit, embedded/OTA origin, public update/build identifier, public dependency/patch versions, build variant, schema/policy version | Environment variables, custom build strings, installation/telemetry ID, signing secrets |
| Runtime | OS family/API/major version, app lifecycle enums, fresh local session sequence, monotonic event offsets | Device name, advertising/Android ID, serial, IMEI, account ID, exact location |
| Navigation | Reviewed screen/route-template enum, e.g. `reader`, `settings.appearance` | Resolved routes/params, bookmark/folder/tag IDs, search text, web URLs/history |
| Actions | Approved component/action enum; bounded reader font/spacing/theme enums; selection count bucket | Article text/titles, selected phrases, notes, form values, clipboard, folder/tag names, exact reading position |
| API/network | Explicit operation enum at the call site, duration bucket, status class, local outcome enum (`timeout`, `offline`, `cancelled`, `unauthorized`, `server_error`), bounded retry count | Scheme/host/path/query, IP/port, DNS results, SSID/BSSID, proxy/VPN details, headers/cookies/tokens, request/response bodies, server messages, query-cache keys |
| Errors | Approved error code/template ID, severity, module enum, validated numeric parameters, sanitized code frames | Arbitrary exception messages, error `details`/`cause` objects, user-supplied error class names, raw worklet output, unparsed stack text |
| Rendering | Approved view-class enum, report-local parent/index IDs, bounded dimensions/alpha/transforms/visibility, overlay count/lifecycle enum | Text, accessibility labels, test/native IDs containing content, pixels, native addresses, arbitrary class names |
| Performance | Duration histograms/counts, requested/current display Hz, event-loop-delay summary, process memory bucket when supported | Heap dumps, allocation contents, GPU/process-wide profiling dumps, exact device-wide free-memory/storage inventories |

Device manufacturer/model and exact viewport resolution are optional environment details, excluded from export by default. Do not read `Device.deviceName`. Treat even content-free technical evidence as potentially identifying when combined; avoid claiming anonymity.

Use monotonic offsets within sessions. Keep wall-clock anchors local for matching native/system evidence, but export session ordering and relative offsets by default. Native PIDs are local correlation fields; export per-report process aliases instead. Reports have no stable cross-report identifier. A random report ID is for that export only and is never registered remotely.

### Useful errors without unrestricted messages

Create a versioned registry of reviewed templates and a parser for each supported dependency error. For example, recognize the exact Reanimated invalid-color template and emit `reanimated.invalid_color` with approved numeric RGBA components/alpha, and `react.host_destroyed` with ordering information. Do not retain the original quoted string. Recognize Fabric mounting failures by fixed code/template and validated numeric indexes, counts, and report-local node aliases.

Sanitize stack traces into bounded frame records: known app/dependency symbol IDs or validated build-relative module identifiers, line/column/bytecode offsets, and native library/build IDs where available. A character regex is not a provenance check: names containing user text, unknown file/module strings, file/content/http URIs, absolute paths, and source snippets are omitted. If provenance cannot be established, keep a fixed `unknown_frame` count. Do not hash private text as a substitute for removing it. Symbolication is offline against build artifacts; no report upload to a symbolication service.

For unknown errors, preserve category, module, severity, bounded approved frames and sequence, with “Message omitted for privacy.” This knowingly loses some diagnosis detail. Extend the template registry after review rather than loosening the privacy boundary.

Raw native logcat and ANR text are **not report sections**. Parse a strictly bounded own-UID process/time slice on a worker into approved templates/frames; discard raw input immediately. ANR thread names and exit descriptions can contain data, so map known thread roles and public reason codes and omit other text. Unknown warning lines contribute only a count. A raw log, even from our UID, can include WebView URLs or library output.

Apply the same template/stack policy to JS, worklet, Java/Kotlin, and native errors, including error text displayed by the emergency fallback. For ANRs, retain recognized thread-role + approved symbol/offset frames and known lock-state enums; never raw arguments, thread names, or whole traces. Maintain golden fixtures for the actual invalid-color host teardown, known Fabric mount failures, timeouts, and unrecognized errors, using synthetic/private-data-free reproductions rather than checking in user reports. Parsers must preserve both privacy and useful incident ordering when dependency formats change.

Defensive text/IP detectors at the final export boundary are additional checks, not the primary privacy mechanism. An invalid section is withheld with an explicit privacy-filter status; never fall back to raw output after a parser/validator failure.

## 5. Recording states and lifecycle

| State | Work allowed | Exit behavior |
| --- | --- | --- |
| Off | Read the recording preference and static UI metadata only; no automatic event/error persistence or native diagnostic calls | Explicit enable or one-time report only |
| Basic | Typed discrete breadcrumbs, normalized errors, bounded lifecycle markers | User can disable; no automatic performance/hierarchy sampling |
| Detailed | Basic plus selected performance/hierarchy/API metadata collectors for at most five foreground minutes | Stop, background/lock, sign-out/server switch, expiry, runtime teardown, or restart ends it; no automatic resume |
| Preparing report | One bounded snapshot job, explicit collection progress/status | Cancel or deadline invalidates work and releases resources; already-approved partial results remain reviewable |

Overlay visibility is a subordinate session state, not a persistent logging mode. Memory/recording policy and cancellation must be shared with native collectors; hiding a React view does not stop a native callback.

Persist the minimal master preference separately from logs and make it available to native code before React starts. On existing installs initialize the documented basic default; never silently activate detailed mode. Missing first-run preferences use that default; corrupt/unreadable policy after initialization fails closed until recovered. No record may be queued while waiting for a policy read. The JS error handler can remain chained while off but must do no recording and must always forward the original failure exactly once.

Changing mode, deleting history, sign-out, or switching servers increments a shared generation before cancellation. Clear logs and native buffers on sign-out/server switch so a shared phone cannot export a prior account's activity. Keep the master preference, but stop detailed recording and overlays. Late promises, queued UI-thread jobs, worker completions, and exports must check generation/policy before reading, writing, or displaying data. After deletion, a fresh local time boundary prevents a subsequent native history/log scan from reimporting older evidence. Process-start identity must protect against historical PID reuse.

Invalidate already-open report previews and emergency-fallback report state on disable/delete too. Gate the error handler rather than attempting to restore an old handler over a newer library's handler. Native policy must cover every participating process/entry point (main activity and Quick Save/share workers), including when React has never started. Unsupported extensions record nothing; they cannot bypass consent. Deletion cannot clear Android-owned historical logs/exit records or unrelated dependency logging; it prevents their reimport and removes app-managed evidence.

## 6. Storage and bounded cost

Initial engineering limits below are acceptance targets, not measured device results:

| Resource | Basic | Detailed / explicit report |
| --- | --- | --- |
| Breadcrumb ring | 256 records per retained session, each at most 512 UTF-8 bytes, subject to the global byte cap | Same ring; aggregate repetitive events and retain suppression counts |
| Error records | Last 20 normalized groups across retained sessions, at most 8 KiB each | Same; no repeated stack copies per occurrence |
| Retention | Current plus two prior sessions, at most 72 hours | Same expiration; no indefinite incident pins |
| App-managed diagnostics storage | At most 1 MiB, including active ring/journal/native records; rotate before growth | At most one extra temporary export of 512 KiB; total at most 1.5 MiB |
| Persistence | Bounded pending batch; routine flush at most once per second, only when dirty | No raw per-frame writes; store window summaries |
| Native work | No automatic frame callback, view walk, logcat subprocess, periodic memory read, or watchdog | One shared collector job; no overlap or unbounded trailing captures |
| Hierarchy sample | None | Explicit snapshot or at most one per second during selected recording; at most 40 nodes and 8 KiB, no text |
| Performance window | None | Up to 60 seconds per user action, within the five-minute detailed session; aggregate natively |
| Report preparation | Static/basic snapshot | Eight-second total deadline, with tighter per-collector cancellation; no retries/polling |

Enforce limits in **UTF-8 bytes**, before serialization where possible, including metadata, truncation markers, files, and crash journals. Every exported section states complete/partial/unsupported/denied/timed-out/truncated plus capture interval and relevant drop counts. Expiry uses elapsed time within a process; persist a bounded wall-clock age policy across restarts, and expire conservatively if the clock jumps. No expiry timer that wakes a background app.

Use a dedicated bounded persistence adapter rather than rewriting the entire report for every tap. Benchmark a small capped journal and MMKV records before choosing the adapter; reuse MMKV only if it meets write/time bounds. Routine batching intentionally risks losing up to the last unflushed second on sudden death. Preserve a tiny synchronous sanitized fatal marker and bounded already-validated breadcrumbs before forwarding JS fatal handling; no JSON dump, native round trip, or full ring rewrite in the error callback.

Native file IO and log parsing run on a worker. The main thread only copies approved hierarchy values or aggregates fixed-size timing counters. A JS `Promise.race` is not cancellation: add actual cancellation tokens, remove callbacks/listeners/runnables, and destroy logcat subprocesses. Reject invalid durations and bound queue/record counts independently of elapsed timers. Repeated identical failures use bounded deduplication and a circuit breaker; diagnostics failure never records its own failure recursively.

The current 250–3,000 ms frame API stores individual intervals; do not increase its timeout to five minutes. Detailed recording is a five-minute **session**, with explicitly started, aggregate-only performance windows of at most 60 seconds. Implement fixed-size histograms and a small worst-gap ring natively; no unbounded interval array. Track display-mode epochs: summarize gaps per observed mode or omit mode-relative missed-callback estimates when the mode is uncertain, instead of applying the start refresh rate to the whole window. On memory-pressure/background callbacks stop optional collectors immediately; use thermal state only where a public supported API exists, otherwise report unavailable and do not add temperature polling.

Keep files private and excluded from Android cloud backup/device transfer and iOS backup. Do not claim encryption at rest just because storage is app-private. Raw secrets must never enter persistence. Export cache is private, has a safe filename (`ordo-diagnostics-<report-id>.json`), restrictive scoped sharing, no broad storage permissions, and no content-derived name. Delete temporary exports on cancellation and on startup/age expiry; allow at most 15 minutes for a pending system share recipient to read, replacing any prior pending export. Native Save As can delete its staging file immediately after the completed copy. Explain that explicitly saved/shared files cannot be revoked. Deletion removes app-managed records; it is not a forensic secure-erase guarantee for flash storage.

## 7. Crash and blank-screen coverage on a phone

Preserve the existing JS render/global-error capture, fatal-handler chaining, independent fallback, Android public exit-history APIs, and best-effort evidence semantics.

Add a small **native-owned sanitized incident journal** and a narrowly scoped observer for the installed React host exception/teardown path. It must normalize using the same reviewed template policy **before** native persistence, perform bounded IO off the main thread where the lifecycle permits, and forward the original exception/teardown behavior unchanged. Do not install a catch-all handler that swallows failures, reset Fabric mounting, restart automatically, or patch private RN internals without a separate version-specific review. First prove which supported lifecycle/error hook sees this app's bridgeless host exception; this is an implementation spike and release gate, not an assumed API.

On next launch, join native incident markers, normalized Android exit reasons, and prior JS session by process identity and monotonic/wall-clock correlation. Label different cases accurately: React render failure, native host exception/runtime destroyed, OS-reported crash, OS-reported ANR, memory termination, manual task removal, and unknown. Distinguish facts from inferred explanations.

Phone-only workflow: enable detailed recording and optional unobtrusive recording indicator → reproduce → Mark issue/Stop if UI remains usable → review/export; after a blank, close/reopen once and view the prior session. A native incident journal can survive React runtime destruction even when JS cannot save another record. No USB debugging or log-reading permission is required for this workflow.

Limits: a UI rendered by React cannot show an error or an overlay after that runtime is destroyed; a stalled main thread cannot render a replacement native screen either. No recorder guarantees a final write during SIGKILL/OOM/power loss. System exit/log evidence can be absent or evicted. A screenshot would contain user data and is not included. No always-on watchdog, shake gesture, floating system window, foreground service, or hardware-key interception is planned. Consider an independent native emergency UI only in a separately reviewed follow-up; it is not a prerequisite for the local diagnostics feature.

Own-UID capture cannot inspect `system_server`, SurfaceFlinger, or other apps, so this feature cannot promise to identify every OEM/compositor stall. If JS never started, Android exit metadata may be the only evidence: the report must work without a JS session record. Unsupported native-hook formats must show reduced coverage rather than claim a complete capture.

## 8. Information overlays

Use an app-owned root sibling with stable native parents, outside blocking modal/presence bookkeeping. No `SYSTEM_ALERT_WINDOW` or accessibility-service permission. The readout is noninteractive and pointer-transparent; controls live in Diagnostics. It must not take focus, handle Back, change layout/z-order/flattening during interaction, or hide content. Reserve safe-area space or offer fixed unobtrusive corners. Screen readers get a static labeled summary on the settings page, not an announcement every update.

| Overlay | Display | Interpretation |
| --- | --- | --- |
| Recording status | Basic/detailed mode, countdown, capture/drop status | Recording health; not an automatic bug detector |
| Performance | Current display mode Hz, requested Hz, main-thread callback p50/p95/max, event-loop-delay summary | Label “Main-thread cadence”; Choreographer callbacks are **not presented FPS**. JS lag is scheduler delay, not render time. |
| Rendering | App-owned active overlay count/lifecycle, latest bounded hierarchy summary (dimensions/visibility/alpha), time since sample | Structural clues only; a snapshot may precede a failure and cannot prove healthy pixels/composition. |
| Layout guides | Safe-area/content bounds for reviewed app containers | Ephemeral geometry only; no content inspection, screenshot, or persistence |

Start with status and performance; ship rendering summary/layout guides only after native tree and accessibility tests pass. Avoid per-component render counters across the whole app, raw console overlays, touch-coordinate trails, network inspectors, and GPU/heap tooling in v1. An OS FrameMetrics source could later supply rendering-duration evidence on supported Android versions; still do not call it compositor-presented FPS.

The status readout may display basic mode without starting sampling. Enabling a measurement overlay requires the same explicit detailed-session start; it cannot silently escalate basic mode. Its countdown stops with that session. When the bounded performance window ends, label the last sample with its age or show “Stopped”; never present old measurements as live. No idle polling is needed for a static basic-status readout.

All overlays share capture results, update visible text at most once per second, and subscribe only while visible. Do no React setState/bridge call per frame. Dispose immediately when hidden. Include a “measurement enabled” field in reports because measurement itself has overhead. Honor both Material modes, light/dark, reduced motion, font scaling, rotation, split-screen, keyboard, and native phrase selection. Do not force refresh rate to make an overlay look smoother.

## 9. Implementation boundaries and order

Proposed modules under `src/lib/diagnostics/`: `schema`, `policy`, `normalize-error`, `recorder`, `storage`, `collectors`, `report`, and platform adapters. Keep the error-path normalizer free of UI/provider/network dependencies. Add a narrowly subscribed local diagnostics store for controls; normal app roots must not subscribe to the event ring. Native policy/journal/collector ownership stays in a testable generated Kotlin module, following the existing plugin pattern. No new diagnostic service or backend.

Instrument explicit boundaries, not global console/fetch interception: startup stage outcome, API operation completion/retry, auth refresh category, cache hit/miss bucket (no query keys), persistence outcome, import/export/Quick Save result category, browser/reader surface lifecycle (no page data), update check/download/apply category, and shared overlay lifecycle. Each entry point needs its own schema fixture and recording-policy test. Avoid logging individual list rows, scrolling, keystrokes, layout callbacks, or per-frame events.

Platform coverage is explicit:

| Platform | v1 baseline | Optional or unavailable |
| --- | --- | --- |
| Android | Typed recorder, JS errors, reports, public exit reasons on API 30+, approved native journal if observation spike passes | Own-UID native log parsing/hierarchy/cadence subject to supported APIs; denial/eviction is normal |
| iOS | Typed recorder, JS errors, report/share flow, settings and backup exclusions | No Android exit/logcat equivalents; native incident/performance sources require a separate public-API adapter and validation, otherwise unavailable |
| Web | Typed recorder, JS errors, bounded local storage, download and controls | No device-native collectors; clear browser-storage lifetime/private-mode behavior; no server-side diagnostics storage |

Share the core schema and controls; do not silently map missing native measurements to zero or claim platform parity. Any platform adapter lacking the complete privacy/disable/export gates remains off on that platform until verified.

1. **Privacy/test spike, no feature UI:** establish fixtures and prohibited-field inventory; test normalization and schema rejection; prove the native host-error observation path and benchmark the persistence options. Preserve a synthetic regression of the invalid-color host failure. Do not deliberately crash a user's production session for testing.
2. **Safe recorder core:** implement validated schema, state machine, bounded retention/batching, fatal marker, shared native policy and cancellation; tests before each implementation slice. Purge legacy `report-v1` free-form history on upgrade rather than silently migrating/exporting it. Document this loss of old evidence. Preserve the user's recording choice through later upgrades.
3. **Phone-only incident capture:** approved native error templates/journal and exit reason mapping, partial evidence/status, startup recovery and independent fallback integration. No raw escape hatch.
4. **Reports and Settings:** real destination, issue timeline, frozen preview, section inclusion, save/copy/discard, delete/off behavior, privacy copy. Verify before-login navigation can reach it.
5. **Detailed recording and overlays:** lifecycle/cost caps first, then status/performance readouts; optional structural/layout views after validation. Turn off the current automatic interaction-time sampling when switching to the new policy.
6. **Release readiness:** platform test matrix, sustained soak and before/after performance runs, privacy-policy/help updates, independent privacy review. If an optional collector fails its gate, leave that collector unavailable with a clear status rather than weakening filtering.

Implementation status and differences from this specification are recorded in [diagnostics.md](diagnostics.md).

## 10. Test-first acceptance gates

“Test completely before making it” is implemented as executable contract/fixture tests before each slice, then integration and physical-device gates before release. A plan or mocked harness cannot prove future native UI behavior or actual frame presentation.

| Gate | Required checks and pass condition |
| --- | --- |
| Privacy at ingress | Seed URLs, bare/encoded IPv4/IPv6, credentials, email, private hostnames, content/file URIs, article/selection/form text, custom thread/class names, IDs and headers into every JS/native input and error/ANR/log path. Assert no fixture secret appears in memory records, persisted bytes, previews, clipboard/export staging bytes, or output. Enums/known numeric templates survive. |
| Adversarial schema/parser | Property/fuzz tests over strings/Unicode, multiline/escaped values, huge payloads, circular objects, malicious getters, prototype keys, NaN/Infinity, unknown enum values, malformed stacks, log floods, and version drift. Fixed memory/time limits; fail closed, never raw fallback or unsafe hashing. |
| Off and deletion | Across cold start, failed hydration, runtime/native startup ordering, rapid toggles, sign-out/server switch, clear-during-write/capture/export, backgrounding and process restart: zero new capture while off, no old history resurfacing, no late persistence/callback/export from a revoked generation. System-owned history is not erased, only excluded by policy/time boundary. |
| Failure survival | In internal builds inject render errors, JS event-handler failures, worklet/native host errors, controlled ANR/process death, disk full/read-only/corruption, missing module/denied logs. Verify original fatal handler once, native runtime-teardown evidence on restart where observable, no diagnostic recursion, recovery without app providers, and truthful absent/partial evidence. |
| Retention and bounds | 100,000-event flood, repeated unique/duplicate errors, clock changes, >72-hour expiry, three-session rotation, multibyte content, oversized ANR/log input, repeated export cancellation, simulated restart. All byte/queue/record/time caps hold, storage remains readable after interrupted writes. |
| Native lifecycle | Test generated Kotlin with focused JVM fakes **and** Android instrumentation for real handlers/loopers/processes: stop expiry/background/teardown removes callbacks/runnables/listeners, cancels logcat/IO, releases busy state; no queued expensive capture after cancellation. Reject new work immediately after stop and target teardown completion within 100 ms while the main thread is responsive; a blocked main thread cannot meet a wall-clock cleanup guarantee. Observe the exact installed bridgeless host failure path. |
| Export fidelity | Preview/export checksum identity for the selected frozen snapshot; same bytes after new events arrive; optional sections really absent; no hidden fields/truncated JSON; generation changes revoke export; Save As/share cancellation, URI permission scope/expiry, cache deletion and backups verified. |
| Network isolation | Static dependency check plus instrumented capture: enabling/recording/overlays/preview/export causes **zero diagnostic-origin HTTP/DNS requests**, no telemetry identifier access, no automatic submission. Distinguish existing app traffic/OS share destinations from diagnostics traffic. |
| UX/accessibility | Settings and error fallback before login/offline; portrait/landscape/tablet/wide web, light/dark and Standard/Expressive, large font/TalkBack/VoiceOver, keyboard/Back/reduced motion. Long report uses sections/virtualization rather than one giant Text. Overlays preserve hit testing, text selection, modal focus, screen privacy, and Back behavior. |
| Device performance | Release APK A/B with diagnostics off/basic/detailed/each overlay: long reader + rapid font/spacing/theme taps, changelog version churn, cold/warm menu opening and navigation. Same device/refresh mode/thermal conditions, alternating runs. Separate callback cadence, frame metrics and interaction latency; report samples/distributions. No claim of presented FPS from callback cadence. |

Proposed performance budgets: basic event append p95 <0.25 ms and p99 <1 ms without IO on that call; routine flush p95 <2 ms; no basic-mode diagnostic frame callbacks or native sampling; idle detailed-off creates no periodic diagnostic work. After initial setup, a no-events interval must perform zero diagnostic writes. Optional overlays refresh UI at most 1 Hz, have no render-driven event loops, and native sampling never exceeds the stated caps.

On the affected phone plus one lower-tier Android device, use at least five paired release runs per mode/scenario after warm-up. Require no consistent >5% regression in p95 interaction/frame-duration metrics; treat noise/thermal drift as inconclusive, repeat with controls rather than declaring success. Run a 30-minute detailed/on-off/background soak, assert zero listeners/jobs after stop, and ≤2 MiB retained-memory increase above the warmed baseline after cleanup; verify storage caps separately. These are proposed budgets to validate, not measurements already obtained. Emulator/JVM/host tests cannot satisfy the physical-device gate. No user-side computer is required, but automated release/instrumentation infrastructure and a physical-device performance run remain release requirements.

Use existing `test:diagnostics`, `test:animations`, `test:reader-performance`, and `test:android-native` harnesses as a base. Add a dedicated diagnostics privacy/property suite, cross-platform adapter tests, native instrumentation, and end-to-end frozen-export tests to CI. Require typecheck/lint and overlay layout checks for UI changes. Test parser compatibility when dependencies or OTA/runtime versions change; unknown versions degrade to reduced evidence, never unrestricted logs.

## 11. Evidence recorded during planning

Executed against current sources on 2026-10-26:

- `pnpm --filter @ordo/mobile test:diagnostics`: passed current error/report, bounded capture, previous/current process, timeout, restart, and clear-during-read invariants.
- `pnpm --filter @ordo/mobile test:animations`: passed lifecycle regression and 2,654 spring-tail/retarget values through the installed color processor.
- `pnpm --filter @ordo/mobile test:reader-performance`: passed current persistence/order/sidecar and native collector configuration checks.
- AST-extracted the actual `redactDiagnosticText` function and executed synthetic inputs: six private-data classes above passed through unchanged; known HTTP URL and email were redacted. This demonstrates a current gap; it does not exercise a proposed replacement.
- Executed the installed Expo Router route-info builder with a synthetic private bookmark ID: `segments` retained `(app)/reader/[id]`, while `pathname` contained the resolved ID. Existing template segments are not evidence of a current ID leak; the new screen enum remains a stricter boundary.

An independent GLM 5.3 Max review informed the cancellation, native aggregation, ANR-frame, template-corpus, and preview/export requirements. Two review claims were rejected after checking installed sources: `useSegments` does not normally resolve dynamic IDs, and Expo `Updates.updateId` identifies the running update, not an installation. The existing Kotlin harness also already tests native excerpt behavior with JVM fakes; real Android instrumentation remains additional work.

Implemented since this audit: production schema/privacy guards, native public Expo observer, recording policy/cancellation, controls/overlays, frozen reports/exports, bounded persistence, and automated privacy/lifecycle/export/native contract suites. Physical-device overhead, real Android instrumentation, iOS backup/export lifecycle, and the complete release matrix remain unverified; see [diagnostics.md](diagnostics.md).
