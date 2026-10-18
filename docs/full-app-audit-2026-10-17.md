# App-wide performance, Material 3, and motion audit

> Historical report. All test runners and saved audit artifacts have been removed from the current repository. Counts below describe past runs, not currently available suites or CI gates.

The [reader, folder, and pop-up contention follow-up](#reader-folder-and-pop-up-contention-follow-up) records the 2026-10-18 source changes and their narrower, static/build-only validation. Earlier browser measurements do not validate this follow-up.

The [scrolling and dialog continuation](#scrolling-and-dialog-continuation) adds measured dialog improvements and lower-overhead scroll bookkeeping. The [session-isolation continuation](#session-isolation-smtp-and-encrypted-library-continuation) retains the earlier real SMTP, two-server switching, and encrypted-library evidence. Earlier results remain historical evidence, not freshly executed checks for later changes. **This is not exhaustive release approval.** Native verification is explicitly deferred; first-dialog main-thread stalls are reduced, not eliminated.

## Scope and confidence

Date: 2026-10-17. Baseline: `01af889` (`perf(mobile): eliminate contents menu mounting stalls`).
Target: the Expo/React Native app, its shared UI/data paths, and server bookmark-list queries.

The historical source inventory covered **343 TypeScript files and 30 route/layout files**, including exact line, JSX interaction-site, and motion-call totals. It recorded paths and source hashes; it was an inventory, **not proof that every branch was executed**.

This is an implementation and fixture-backed verification pass, not a claim of complete Material certification or device-level smoothness. No Android device was attached. Web screenshots, DOM geometry, CPU-throttled browser long tasks, and cache microbenchmarks cannot establish native FPS, battery use, TalkBack behavior, or IME correctness.

Preserved product constraints: one constrained pane, unified library/search app bar, full-screen reader, existing teal Material identity, Roboto UI scale, real Android Material You integration, and the persisted Standard/Expressive switch. No new navigation system, screen-specific component family, dependency, or decorative animation was added.

## Findings and implemented corrections

### Performance and data correctness

| Finding | Correction | Main files |
| --- | --- | --- |
| Moving a selection walked and sorted every cached list once per bookmark and published individual folder-count updates | Batch membership changes, destination sorting, reminder reconciliation, count deltas, and rollback insertion. Detail bodies survive list updates; rollback preserves unrelated concurrent moves | `src/lib/cache-helpers.ts`, `src/hooks/use-bookmarks.ts` |
| Cold-cache launch could wait up to 3.5 seconds for library requests, in addition to local bootstrap | Only local restoration/fonts/session gate launch; library/server-info requests and connectivity initialization continue asynchronously. Existing skeleton/error/Retry states remain responsible for network feedback | `src/lib/query-cache.ts`, `app/_layout.tsx` |
| Extraction completion could invalidate/refetch all loaded global catalogue pages | Exclude `library-index` at the initial invalidation predicate, including falling pending counts; refreshed detail/list copies still update search metadata | `src/lib/extraction-sync.ts` |
| Bottom-of-article scrolls repeatedly crossed an unconditional completion trigger; overlapping responses could restore old progress | Trigger completion on crossing the threshold. A resource-keyed queue serializes/coalesces writes and only reconciles progress-owned fields from the latest response, preserving concurrent folder/tag edits. The queue survives reader unmount/reopen; ownership is captured before outgoing-reader cleanup and checked before optimistic updates, sending, and committing | `src/lib/latest-write-queue.ts`, `src/lib/reading-progress.ts`, `src/components/reader/ReaderPane.tsx` |
| Reader chrome re-renders repeatedly scanned the entire loaded bookmark cache for first-paint data | Memoize the initial cache fallback by bookmark ID; the live detail query remains authoritative | `src/components/reader/ReaderPane.tsx` |
| Unopened feature trees subscribed to queries/hooks on launch and list screens | First-use `LazyMount`, retaining the feature after activation for subsequent opens and exit/draft preservation | Save, move, add-tags, folder creation/actions, search filters, reader settings |
| Large folder/tag search menus mounted the entire catalogue | Bounded virtualized lists; search/back controls remain within each list's measured header; menu owns no competing outer scroll body. Exact scaled single-line row geometry supports distant scroll targets. Data-aware web Home/End and arrow wrapping scroll and focus rows beyond the mounted window; complete names remain in accessibility labels | `src/components/bookmarks/SearchFilterMenu.tsx`, `src/hooks/use-overlay-focus.ts` |
| List cursor orders could require temporary database sorting | Versioned SQLite indexes for folder date+ID, global date+ID, and folder title+ID; replace the redundant shorter date index. Reuse an `Intl.Collator` for decrypted-title sorting | `apps/server/prisma/schema.prisma`, `20261017120000_bookmark_sort_indexes/migration.sql`, `bookmarks.service.ts` |

The new indexes add storage/write maintenance; query-plan tests verify their read-side benefit, not a production database latency or write-throughput guarantee. No existing migration was rewritten and no bookmark data is deleted.

### Material hierarchy, geometry, and interaction

- **Menus:** baseline `surfaceContainer`, Expressive `surfaceContainerLow`; Expressive selected `tertiaryContainer/onTertiaryContainer`; inactive icons use `onSurfaceVariant`. Existing page transitions, placement retention, dismissal, and focus isolation are retained.
- **Dialogs:** shared 28dp shape, 16dp title-to-body interval, horizontal safe-area subtraction, and a fit-content minimum bounded by the available viewport. Short-window/keyboard scrolling remains shared rather than patched per screen.
- **Outlined actions:** mode-appropriate foreground/outline roles, including disabled icon-button boundaries.
- **Fields:** reserve scaled floating-label space and scale filled-field top padding. Supporting text and counters retain a 16dp separation. Native large-font rendering still requires device checks.
- **Bookmark rows:** tagged rows reserve **120dp**, not 96dp, to contain their actual 48dp inline tag action; plain rows remain 72dp and metadata-only rows 96dp. This keeps virtual-list offsets aligned with rendered content.
- **FAB labels:** round measured width upward with a small safety allowance. Fractional browser layout previously turned “Save bookmark” into an ellipsis despite sufficient screen space.
- **Connected selectors:** account for the check slot, borders, and measured labels. Keep equal widths while horizontal; use the existing vertical presentation when narrow space/large labels cannot fit. Increase visual height for scaled fonts. Selection never borrows width from adjacent buttons; standard button groups retain their existing 15% press expansion.
- **Native list focus:** paint the Material focused state for keyboard/D-pad focus, not only web `:focus-visible`; keep CSS focus outlines web-only.

### Motion lifecycle and hot paths

- Shared foreground subscription pauses repeating spinner, wave, skeleton, OTP loading, and OTP-caret animations when the app/browser is inactive.
- Overlay and page activity contexts stop repeating work behind blocking surfaces and on unfocused pages; exit trees and drafts remain mounted as before.
- A bookmark skeleton region shares one pulse clock instead of starting a repeat per placeholder. Reduced motion produces static placeholders.
- Selection mailbox frame callbacks are dormant outside selection and on web/background; the existing latest-pointer/coalescing behavior is retained.
- Scrollbar reveal/hide uses one idle timer chain instead of restarting timing animation/timer on each scroll event; web skips custom scrollbar updates entirely.
- FAB expansion checks its known target rather than synchronously reading UI-thread shared values from JavaScript.
- Root navigation fades, reader heading jumps, and highlight-menu scrolling honor reduced motion. Existing spatial/effects schemes remain the source of component motion.

## Material review

These are qualitative source/web review scores, not independent certification. **82/100** reflects good shared architecture with important unverified native behavior.

| Category | Score / 10 | Assessment |
| --- | ---: | --- |
| Color roles | 9 | Generated tonal roles; corrected menu pairs; 336 generated-palette text-pair contrast assertions |
| Typography | 8 | Shared Roboto Material scale; clipped action labels corrected; native large-font pass outstanding |
| Shape | 9 | Shared controls and dialog geometry; Expressive-specific shape mapping retained |
| Elevation | 9 | Tonal surfaces and centralized shadows, not screen-specific card layering |
| Components | 8 | Spec-aligned React Native primitives; not a claim of official Compose implementation parity |
| Layout | 8 | Constrained phone/wide panes and safe-area-aware dialogs; physical insets/foldables outstanding |
| Navigation | 8 | Existing unified search/reader return model retained; native Back/predictive-Back/IME outstanding |
| Motion | 8 | Shared schemes, reduced motion, and repeating-work lifecycle improved; native frame traces outstanding |
| Accessibility | 7 | Keyboard/focus, role-based target geometry, and generated-pair contrast checks; no TalkBack certification |
| Theming | 8 | Standard/Expressive, light/dark, AMOLED/contrast palette tests; real Android wallpaper palettes outstanding |

Minimalism is maintained through shared rails, typography, tonal grouping, bounded menus, and fewer hidden subscriptions—not by introducing additional cards, navigation chrome, or animation on every element.

## Verification and measurements

The new regression suite exercises real TanStack Query operations, not a reimplementation of the batching algorithm. Cases cover destination/source/search/index membership, duplicate reconciliation, detail retention, mixed/root moves, reminder rollback, concurrent independent moves, row geometry, extraction invalidation, progress-threshold behavior, serialized/coalesced writes, failed-write recovery, and tonal contrast.

Initial browser results were collected against production Expo exports with synthetic API/session fixtures. No real user's account, folder, bookmark, authentication setting, or session was modified. The follow-up additionally uses newly created disposable accounts on an isolated loopback server. The screen helper waits for a visible route marker and splash dismissal before capture; early captures taken before that readiness fix were discarded.

The historical verification manifest recorded export fingerprints and the following passing results:

| Suite | Captures | Checks | Result |
| --- | ---: | ---: | --- |
| Routes: 25 destinations × light/dark × Standard/Expressive × phone/wide | 200 | 801 | Pass |
| Phone overlays | 60 | 253 | Pass |
| Wide overlays | 60 | 253 | Pass |
| Narrow/empty/error/Retry states | 34 | 145 | Pass |
| Final interactions, 200-tag keyboard navigation, and reduced-motion landscape | 43 | 210 | Pass |
| **Total** | **397** | **1,662** | **0 issues, 0 uncaught browser errors** |

These are staged runs: the layout matrices use the `final2` export; the final `final5` interaction run covers the subsequent reader-progress and virtualized-menu keyboard/geometry corrections. The manifest labels those revisions rather than presenting them as one identical-binary run.

- **26 mobile tests passed**, including 336 generated-palette text contrast assertions across light/dark, Standard/Expressive, AMOLED, and three contrast settings.
- **3 SQLite tests passed**, exercising the complete migration chain, repeat application of the new index migration, and indexed date/title orders in both directions.
- Prisma generation, workspace typecheck/lint, server build, production web export, and Android JS export passed.
- The production dependency audit exits successfully under the repository's existing ignore policy, but reports **9 moderate vulnerabilities and 2 ignored high vulnerabilities**. No dependency versions were changed in this pass; this is not a vulnerability-free dependency certification.
- With home-library responses delayed **5,000ms**, web launch reached a visible search field with the splash dismissed in **913.3ms**. This starts at browser navigation with a fixture session, not native process launch.
- A 200-tag catalogue is bounded on mount; End reaches the final initially-unmounted option, Home returns to Back, and arrow wrapping retains menu focus in all six interaction configurations.
- Captured enabled/disabled controls with button/radio/checkbox/switch/menu-item roles meet the 48px DOM target check; this is not a blanket claim about every native gesture region or text link. FAB/connected-selector labels are separately checked for clipping.

**Residual performance finding:** cold save-dialog opening still produces 2–3 browser long tasks under 4× CPU throttling (largest **229–261ms**); cold contents opening produces one **131–139ms** task. These first-open costs are not eliminated and no statistically significant first-dialog improvement is claimed. Action-and-settle times include Playwright waiting and an explicit 350ms settle period. Native traces remain the release gate for any “smooth at 60/120Hz” claim.

### Cache benchmark

`cache-move-benchmark.cjs` loads the baseline cache-helper source from Git and the working implementation against identical current query/sort dependencies. Both runs move 500 of 1,000 bookmarks across five initialized caches, with one unmeasured warm-up and five measured samples. No browser/build workload was running during the final comparison.

| Implementation | Median synchronous cache work | Cache update notifications |
| --- | ---: | ---: |
| `01af889` | 1,561.92ms | 5,000 |
| Working tree | 5.98ms | 8 |

This measures cache work only, not server mutation latency or complete UI transition time. The larger regression fixture additionally contains detail and reminder caches and publishes 11 updates; its CI invariant is bounded notifications, not a hardware-specific wall-clock threshold.

Five samples per implementation and a separately labeled baseline browser summary were recorded at the time; those artifacts are no longer retained.

### Representative captures

- Standard and Expressive appearance: complete contrast labels at 390px.
- Narrow save dialog: 320px viewport, persistent field labels, and visible actions.
- Dark authenticator QR dialog: modal hierarchy and contained QR geometry.

These were synthetic-fixture browser screenshots, not Android screenshots; they are no longer retained.

## Follow-up workflow and policy audit

The continuation starts from published commit `e6616d4`. Its historical verification manifest recorded the production export fingerprints, exact suite totals, and complete result files. Earlier failing experiments are not counted as passes.

The updated historical source inventory contained **344 TypeScript files, 30 route/layout files, 41,435 lines, 603 interaction sites, and 115 motion calls**. These are source counts, not dynamic coverage percentages.

All eight primary follow-up suites use the same `final3` production web export:

| Suite | Captures | Checks | Result |
| --- | ---: | ---: | --- |
| Routes | 200 | 801 | Pass |
| Phone overlays | 60 | 253 | Pass |
| Wide overlays | 60 | 253 | Pass |
| Narrow/empty/error/Retry states | 34 | 145 | Pass |
| Delayed/rejected mutations and OTP workflows | 24 | 185 | Pass |
| Account/server policy branches | 48 | 233 | Pass |
| Actual loopback-server workflows | 5 | 31 | Pass |
| Isolated interactions, timing, and held transition | 43 | 215 | Pass |
| **Total** | **474** | **2,116** | **0 issues, 0 uncaught browser errors** |

The quick suite's first invocation found the static server stopped (`ERR_CONNECTION_REFUSED`) and executed no checks. It was rerun after restarting the identical export; the passing rerun above is the packaged result, not a counted pass for the failed invocation.

### Additional findings and corrections

| Finding | Correction |
| --- | --- |
| Rapid folder creation followed by reload could restore an older, still-"fresh" empty snapshot | Flush pending persistence on `pagehide`; remove the second deferred storage-write timer; restore disk snapshots as invalidated so mounted queries revalidate without blocking cached first paint. Retain the same account/server keys and private-content filtering |
| Folder password/PIN/pattern setup lacked an in-flight guard; folder editing could change pages or dismiss while pending | Guard lock submission synchronously, show pending state, disable affected inputs/options/actions, and prevent Back/scrim/Escape dismissal while the mutation owns the surface. Errors retain drafts and re-enable explicit retry |
| Save/create forms and import previews allowed changing request options while pending | Add shared disabled behavior to picker fields, icon grids, and setting rows; disable save destinations/tags, folder icons, and import duplicate/atomic/advanced controls during the request |
| Removing a password lock on web also called native-only SecureStore cleanup, raising an uncaught error | Platform-guard device credential access and make post-success cleanup failures handled. Native device-lock creation remains unavailable on web; no fallback secret is stored there |
| Six OTP/PIN cells could shrink below 48dp in narrow dialogs | Split narrow codes into ordered groups, preserve editing/focus across group-layout changes, and scale cell height with system font scale. Extend DOM target checks to text inputs, not only role-based controls |
| Mandatory MFA enrollment visually covered the library but left its controls keyboard/assistive-technology reachable on web | Keep navigation mounted, but make the background inert, hide its accessibility subtree, block pointer events, and suspend its repeating animation activity. Enrollment owns web focus; its QR/backup-code overlays still use the shared portal |
| Incoming web slide transitions could temporarily widen the root scroller | Clip at the scene viewport rather than at the constrained content column. A held-mid-transition regression checks containment, rather than relying on capture timing; native stack motion is unchanged |
| Bulk delete/Undo still republished list/count/reminder data per selected bookmark | Batch insertions, aggregated count deltas, detail removals, and reminder reconciliation. A real QueryClient regression deletes/restores 500 of 1,000 bookmarks while another deletion stays pending; Undo publishes six success/data updates in that fixture and retains article bodies, search/index membership, counts, and reminders |
| Newly mounted controls started springs already at their settled target, and reduced-motion snapshots created repeated media queries | Reuse the shared media-query object; skip redundant initial springs in switch, eye toggle, connected-selector label, and standard button-group consumers. Actual state/preference changes still animate or settle according to the shared motion scheme |

### Executed workflow coverage

- **Delayed/rejected fixture mutations:** lock and rename drafts, one request in flight, disabled fields/pickers, non-dismissible pending surfaces, retry, and pending-save options across both themes and both design modes. Six-digit PIN targets at 320px, orientation regrouping with value **and keyboard focus** retained, live reduced-motion changes, and dismissal without a retained blocker.
- **Account/server policy fixtures:** registration disabled; mandatory MFA blocking the background and owning keyboard focus; mandatory-enrollment QR open/close; backup-code editing; no-SMTP recovery presentation; and unavailable device keys on web. Checked at 320px and 1280px in light/dark and Standard/Expressive.
- **Actual loopback server:** registration mismatch/success; nested folder creation and bookmark save; immediate reload consistency; password-lock setup/mismatch; rejected/successful unlock; account-password recovery; CSV preview/commit; delayed import option locking; duplicate and malformed-file handling; JSON/HTML/CSV browser downloads containing committed data; TOTP enrollment; logout; incorrect MFA rejection; backup-code sign-in; and account-deletion step-up/cancellation/completion. Only the freshly created `example.test` account is deleted. This uses real server/auth/database requests, not fixture mutation responses.
- **Deterministic checks:** 31 mobile tests, including actual TanStack hydration/background revalidation, persistence, device-lock web guards, OTP layout, batched delete/Undo, existing move/progress/autofill regressions, and 336 palette assertions. Workspace typecheck/lint, SQLite tests, server build, and both production web and Android JS exports are rerun.

The local server has its own `/tmp/opencode` SQLite database, test-only secrets, no SMTP, and no existing account credentials. Native file pickers, share sheets, installation, real biometric prompts, TalkBack, physical frame timing, display/font scaling, and OEM wallpaper palettes are **not** verified by these browser workflows. The app's backend-enforced MFA policy is distinct from the corrected background accessibility behavior; this finding is not a claim that server authorization was bypassed.

### Residual performance and release status

The added `profile-dialogs.mjs` records cold/warm save opens with a CPU sampler, optional timeline trace, 4× CPU throttling, and synthetic data. Three pre-change cold samples had largest long tasks of **290–298ms**; three intermediate follow-up samples had **279–288ms**. Warm samples also overlapped (**203–235ms** versus **206–230ms**). These small, instrumented samples do **not** establish a statistically significant cold-dialog improvement and are not directly comparable to the earlier unsampled browser timings. The summaries are retained separately. React commit/focus/layout work remains a diagnostic lead, not an eliminated bottleneck or a native FPS result.

The isolated final3 quick run still records largest cold-save long tasks of **243–275ms** across five normal-motion configurations and **213ms** in reduced-motion landscape. Cold contents records **140–146ms** normally and **133ms** with reduced motion. These results reinforce the unresolved first-open finding; correctness checks passing does not mean the timing costs meet a native frame budget.

The initial [development APK workflow](https://github.com/axoletlabs/ordo/actions/runs/39040664088) completed successfully, including the APK build, package/signing checks, and `ordo-apk-development` artifact upload. That artifact belongs to `e6616d4`, not the follow-up source. A newly dispatched workflow is reported separately when the follow-up is published. `adb devices` still reports no attached device; this host also has no configured Android SDK/emulator or KVM device.

**Open work at the follow-up publication:** the native release checklist below; SMTP delivery/reset/email-change integration; broader account/server switching and offline race testing; native protected/encrypted-library and WebView workflows; and further cold-dialog profiling/remediation. The continuation below executes the SMTP and non-native isolation workflows; native verification and cold-dialog costs remain open. The source inventory and executed matrices are not an assertion that every possible validation, permission, account, and OS branch has been executed.

## Session isolation, SMTP, and encrypted-library continuation

This continuation starts from `8b621581b547feb943e78dacb039e20f3d572ede`, on the same audit branch. Native Android device verification is intentionally excluded as requested. The historical verification manifest identified the exact web/Android JS export fingerprints, test-script/server-source hashes, results, and curated screenshots. Its source inventory covered **347 TypeScript files, 30 routes/layouts, 41,612 lines, 603 interaction sites, and 115 motion calls**; these remain source counts, not executed-branch percentages.

### Corrections

- **Account/server ownership:** requests pin their originating server and runtime session generation. Late responses, refresh rejection/success, and network failures cannot replace/clear the next account, replay on its host, mark its server offline, or publish its predecessor's data. A replacement account starts its own refresh flight. A newer Quick Save token rotation also wins against an older in-flight refresh.
- **Mutation lifecycles:** bookmark/folder/tag/auth/import/export/server mutations share per-execution ownership guards. Superseded success/rollback/settled callbacks are suppressed; stale successful `mutateAsync` executions reject instead of running caller success continuations. Serialized queued mutations cannot send using a later account. Multi-chunk writes and async cache-reconciliation callbacks recheck ownership across awaits.
- **Cache and deferred work:** synchronous auth/settings subscriptions clear shared query data before another account/host can observe it, stop outgoing persistence, and clear folder unlock tokens. Snapshot restoration checks ownership **before hydration**, not after stale data has already entered the cache. Reader progress queues, Undo callbacks, and durable delete replays also retain their original runtime ownership, including signing back into the same account.
- **Logout:** session removal uses idempotent `deleteMany` rather than logging a missing-record Prisma error when another path already removed it. Real-server logout workflows pass without that error.
- **Avoidable web work:** web scrollers no longer attach unused native-scrollbar layout/content callbacks; web panels rely on viewport/CSS geometry rather than unused keyboard/gesture measurements. Input labels skip already-settled initial timing work. Overlay focus enumerates controls once at opening, avoids scrolling the page to the initial field, and does not measure controls on unrelated typing keys. Native scrollbar/keyboard paths and actual preference/state animations remain intact. These are bounded work reductions, **not a measured cold-dialog speedup**.

### Final-export results

All nine suites below use the same `stage3-final` production web export. Light/dark, Standard/Expressive, phone/wide, narrow/landscape, keyboard, and reduced-motion coverage is retained from the full shared-UI matrices.

| Suite | Captures | Checks | Result |
| --- | ---: | ---: | --- |
| Routes | 200 | 801 | Pass |
| Phone overlays | 60 | 253 | Pass |
| Wide overlays | 60 | 253 | Pass |
| Narrow/empty/error/Retry states | 34 | 145 | Pass |
| Delayed/rejected mutations and OTP workflows | 24 | 185 | Pass |
| Account/server policy fixtures | 48 | 233 | Pass |
| Actual loopback-server workflows | 5 | 31 | Pass |
| Isolated interactions, timing, held transition | 43 | 215 | Pass |
| SMTP, encrypted library, account/server/offline integration | 5 | 35 | Pass |
| **Total** | **479** | **2,151** | **0 issues, 0 uncaught browser errors** |

The first route invocation exceeded its 240-second harness deadline after 152 captures. The separately recorded complete run above uses a longer deadline; the partial run is not counted as passing. An initial local-server assertion raced React's pending-state render; the runner now waits for the disabled control while holding the commit request, then checks all pending options. Only the complete passing rerun is packaged. Test-runner corrections do not change the production export.

**New actual integrations:** `extended-server-audit.mjs` launches two fresh loopback Nest/SQLite servers and an in-process SMTP sink, using only disposable `example.test` accounts. It verifies SMTP-required signup does not authenticate early; wrong/correct verification codes; multipart plaintext/HTML/logo mail; email-change verification and the original-mailbox security notice; reset-form mismatch/retry; one-use password reset; token refresh; TOTP enrollment and SMTP MFA recovery while retaining MFA; ciphertext at rest for bookmark URLs/titles, folder names, and tag names; encrypted-library readability after password reset, refresh, and MFA recovery; server-down focus isolation/session retention/Retry; logout/login into a second account and reload without the first library; the actual signed-in hosting probe/confirmation/restart into another server with independent accounts and no inherited library; and an intentionally rejected SMTP delivery. No real SMTP service, mailbox, credentials, or existing database participates.

**Deterministic/build checks:** all **44 mobile tests** pass (including 336 palette assertions), as do workspace typecheck/lint, three SQLite migration/query-plan tests, server build, production web export, and Android JS export. Held-network and actual TanStack tests cover stale refreshes, independent refresh flights, stale responses/errors, mutation success/rollback, queued writes, offline retry, synchronous cache clearing, and an already-awaiting stale snapshot restore. Delete/Undo regression coverage also verifies old callbacks cannot restore or dispatch after a new login.

Historical captures showed the encrypted library on the local server and the offline gate retaining the session; those captures have been removed.

### Remaining performance finding and APK status

The isolated quick run records largest cold-save long tasks of **246–253ms** in five normal-motion configurations and **228ms** in reduced-motion landscape; cold contents records **138–147ms** normally and **141ms** with reduced motion, all at 4× browser CPU throttling. In comparable three-sample CPU/timeline profiles, the published final3 baseline cold maxima are **306/307/306ms**, versus **299/320/305ms** for this final export. Warm maxima are **230/221/204ms** versus **227/232/214ms**. These overlapping ranges do **not** establish meaningful improvement. The baseline trace contains a roughly 305ms function task, including about 50ms of layout-tree work; CPU samples point to RN-web offset measurement, React rendering, and focus/layout work. Raw diagnostic traces/profiles stay in `/tmp/opencode/ordo-stage3-{profile-baseline,final-profile}`; compact sample summaries are packaged. A broader overlay/render architecture change would need its own comparable validation; the unresolved stall must not be relabeled as complete or inferred to be native FPS.

The [follow-up APK workflow](https://github.com/axoletlabs/ordo/actions/runs/39058584135) **succeeded** for `8b62158`; its non-expired `ordo-apk-development` artifact was confirmed (ID `12110349604`, 19,474,091 bytes). It does not include this continuation. A fresh development APK workflow is dispatched for the newly published continuation commit and reported with the handoff. Neither artifact is device verification.

The requested non-native workflow expansion and regression reruns above are complete, but **cold-dialog performance remains an open non-native finding**. Native Back/IME, OS accessibility services, biometrics, WebView, installation/share/update flows, real wallpaper palettes/scaling, and physical frame/battery measurements remain explicitly deferred. No claim of exhaustive branch execution or Material certification is made.

## Scrolling and dialog continuation

This continuation starts from `1a07f56a71aacdfefbd9ddf73fa8b434fc4bd2a2`. It changes shared primitives without adding dependencies or changing Material geometry, colors, navigation, or motion schemes.

- **Dialog opening:** web `Input` delegates autofocus to the dialog's existing post-publication focus owner. It no longer forces layout/focus during an incomplete portal commit; the dialog establishes focus after attachment. Native autofocus is unchanged. This changes focus timing, not a claim that every baseline opening called `focus()` twice.
- **Browser scrolling:** ordinary scroll surfaces no longer allocate unused native-scrollbar shared values/effects or register Reanimated scroll handlers. Reader scroll animation retains its composed handler.
- **Native scrolling:** scrollbar offset/size updates run in the UI-thread scroll handler. App-owned JS bookkeeping is sampled every 80ms, with unconditional drag/momentum endpoint reports. The deterministic 60/120Hz simulation emits 10–13 periodic reports per second rather than one per frame. This does not eliminate React Native's own virtualization bookkeeping or establish native frame times. Ordinary lists use an event-only animated wrapper, not additional layout-animation cells; pickers retain their existing optional item transitions.
- **Idle motion/focus work:** panels avoid redundant initial obscuring/zero-lift animations. Browser keyboard-lift work is omitted. A content update with intact focus no longer schedules a repair frame. Closing a nested menu can restore its parent trigger immediately instead of polling the full 600ms deadline merely because the parent dialog remains open.

### Comparable isolated profiles

Both control and final exports use the same pointer-driven `profile-dialogs.mjs`, three fresh contexts, Expressive/light/390px, 4× CPU throttling, and CPU/timeline recording. Runs were sequential without competing browser/build workloads. These are small diagnostic samples, not a statistical/native performance guarantee.

| Metric | Control `1a07f56` | Final runtime |
| --- | --- | --- |
| Cold maximum long tasks, three runs | 289 / 311 / 306ms | 224 / 221 / 208ms |
| Cold median maximum long task | 306ms | 221ms (**28% lower**) |
| Cold total long-task time, three runs | 504 / 535 / 459ms | 374 / 364 / 342ms |
| Warm maximum long tasks, three runs | 225 / 223 / 235ms | 187 / 158 / 162ms |

**Cold-dialog stalls remain open:** 208–224ms is still a substantial browser main-thread task, not “smooth at 60/120Hz.” An intermediate focus-only sample reached 213–226ms; the final results above, rather than that intermediate export or earlier summaries, identify the published runtime. Action-and-settle time includes automation overhead and explicit waiting.

### Memory/lifecycle confidence and limits

`motion-lifecycle-audit.mjs` passed **120 checks** across light/dark, Standard/Expressive, wide, and reduced-motion landscape. It executes 15 open/edit/close cycles in each of six contexts (90 total), checks a single focus call per open, verifies nested-menu draft preservation/trigger restoration, and scrolls a synthetic 1,000-bookmark library with real wheel input. Only **18–30 matching bookmark rows** remain mounted after scrolling. Running the same script against the control export fails the nested-menu trigger-restoration deadline (1,000ms); that expected control failure is retained separately and is not counted as a passing suite.

After a three-cycle warmup versus cycle 15, listener counts are unchanged in all six contexts; DOM node counts are unchanged in five and increase by four in reduced-motion landscape. Post-GC JS heap grows by roughly 0.6–1.9MB over that interval; this is diagnostic, **not a proof of a heap plateau, absence of leaks, or reduced native RAM**. No direct battery improvement is claimed. Existing foreground/overlay activity gates continue to pause repeating indicators; native battery, allocation, and frame traces remain deferred.

The historical continuation manifest recorded exact export/source fingerprints and the regression results. Earlier real-server suites are historical evidence and are not counted again for this UI-only continuation. The first quick invocation used a static server without SPA fallback and stopped at reader navigation; that infrastructure failure is excluded from passing totals. The complete rerun used SPA fallback and the identical export.

| Newly executed suite | Captures | Checks |
| --- | ---: | ---: |
| Route matrix | 200 | 801 |
| Phone overlays | 60 | 253 |
| Wide overlays | 60 | 253 |
| Narrow/loading/error states | 34 | 145 |
| Quick interactions and reduced motion | 43 | 215 |
| Form/draft workflows | 24 | 185 |
| Account/server policy fixtures | 48 | 233 |
| Focus, repeated dialogs, and large-list lifecycle | 0 | 120 |
| **Total — zero issues/uncaught browser errors** | **469** | **2,205** |

The source inventory now fingerprints **348 TypeScript files and 30 routes/layouts**; it is not executed-branch coverage. The source-comment explanation of autofocus was corrected after the initial export; rebuilding both platforms produced byte-for-byte identical exports, recorded in `source-equivalence.json`. Raw isolated CPU profiles/timelines are included in `isolated-profiles.tar.gz`, with compact summaries and curated screenshots beside the manifest.

Local validation includes **46 mobile tests**, workspace typecheck/lint, production web export, and Android JS export (`--no-bytecode`, not a local native/Hermes build). Besides the sampling predicate, inert hook/event adapters execute the actual production scroll bridge to check all UI updates, custom-handler composition, sampled JS reports, and exact drag/momentum endpoints. This is not a native integration test. The previous commit's [APK workflow](https://github.com/axoletlabs/ordo/actions/runs/39063109078) completed successfully; artifact `ordo-apk-development` was confirmed non-expired (ID `12112547426`, 19,475,500 bytes). A new APK is dispatched for this continuation's published commit; neither build constitutes device verification.

## Menu dismissal and control-motion follow-up

This follow-up starts from `038175e721c390bf7323a961d27bdcbd983fb258` and addresses the reported lingering row indicator without adding animation work to virtualized rows.

- **Concurrent dismissal:** bookmark/folder menu ownership now releases in the dismissal commit. The existing row fade runs alongside the overlay exit instead of waiting for `onExited` and then starting another fade. Nested pages/dialogs retain ownership while the overall action session remains visible. Owner tokens still prevent an older screen's cleanup from clearing a newer screen's highlight. Bookmark action handoffs still wait for the menu to leave the host.
- **Overlay continuity:** existing shared presence springs, opacity timings, retained exit contents, interrupt/reopen guards, and reduced-motion handling remain. The indicator fix changes ownership timing rather than shortening/removing the menu's exit animation.
- **Missing state transitions:** settings and form dropdowns share an interruptible rotating disclosure arrow; checkbox marks crossfade/settle without delaying checked semantics; newly mounted form-wide errors fade in without retaining cleared alerts. All use shared motion preferences/tokens, skip unnecessary mount springs, and stop on unmount. Bulk-list selection remains immediate.
- **Cold-path restraint:** unopened disclosure arrows remain static icons with no Reanimated graph or motion subscriptions. Animation initializes on first expansion and stays mounted for interruptible reversal. An eager-initialization version and experimental overlay retiming were rejected during profiling; the final runtime retains the original presence parameters.
- **Dropdown blue:** Expressive selected menu items deliberately pair `tertiaryContainer` with `onTertiaryContainer`; the complementary role can be blue in a teal theme. Standard menus retain `surfaceContainerHighest`/`onSurface`. No hardcoded blue or color-role change was introduced.

The previous [APK workflow](https://github.com/axoletlabs/ordo/actions/runs/39065317921) succeeded for `038175e`; its non-expired development APK artifact was confirmed (ID `12112699499`, 19,475,818 bytes). It does not include this follow-up. Native Android verification remains excluded, and the earlier cold-dialog main-thread finding remains open.

### Follow-up verification

The historical follow-up manifest fingerprinted the exact final runtime, Android JS export, source inventory, regression runners, results and raw standalone CPU profiles. The menu-motion suite passed **291 checks in 10 configurations**: both themes and design modes at phone/wide widths, plus reduced-motion portrait/landscape. It checked bookmark/folder dismissals, nested surfaces, rapid reopen, dropdown reversal, checkbox feedback, and synthetic login failure alerts.

Sequential browser rAF sampling detects the row fade below 95% opacity **19–33ms after dismissal**, versus **229–250ms** for the previous export. The final row clears below 1% in **122–138ms**, before menu removal at **212–235ms**; the old row takes **346–365ms** to clear. Both reduced-motion configurations clear in the first sampled dismissal frame. The identical regression detects **32 expected failed latency checks** in the control, with no uncaught errors; that control run is not passing verification. These are synthetic browser observations, not native timing/FPS.

Standalone three-sample, 4×-CPU-throttled profiles record cold maximum tasks of **218/208/203ms**, compared with control **216/211/205ms** and a repeated control **203/215/205ms**. Warm maxima are **182/161/166ms**, versus **175/160/154ms** and repeated control **171/162/171ms**. These small overlapping ranges do not establish an overall dialog speedup or guarantee absence of performance regressions. The demonstrated improvement is dismissal feedback latency; cold-dialog stalls remain open. Broad correctness suites ran concurrently, so their embedded quick-run timing figures are explicitly **not** comparable performance evidence.

| Newly executed final-runtime suite | Captures | Checks |
| --- | ---: | ---: |
| Menu/control motion regression | 20 | 291 |
| Quick interactions and reduced motion | 43 | 215 |
| Phone overlays | 60 | 253 |
| Wide overlays | 60 | 253 |
| Narrow/empty/error states | 34 | 145 |
| Repeated-dialog and large-list lifecycle | 0 | 120 |
| **Total — zero issues/uncaught browser errors** | **217** | **1,277** |

All **49 mobile tests**, workspace typecheck/lint, production web export, and Android JS export pass. Inert adapters execute the production highlight hook's dismissal, nested-session, owner-token and rapid-reopen logic, plus disclosure lazy activation, spring reversal, reduced-motion settlement and cancellation. They are not native integration tests. The lifecycle suite again runs 90 dialog cycles and a 1,000-bookmark fixture: DOM/listeners do not increase, and 18–30 matching rows remain mounted after scrolling. Post-GC heap still grows about 0.6–1.8MiB; no leak-free or native-memory/battery claim follows. Historical route/real-server suites are not counted as freshly executed here. The first two development invocations of the new runner had selector/sampling/consent-link targeting mistakes; their failed results are retained separately and excluded from passing totals.

## Reader, folder, and pop-up contention follow-up

Date: 2026-10-18. Baseline: `63847717edd76014e441e9edab915bcbeaaaeb3d`.

The source review traced the reader's scroll/progress/render/Contents paths, shared list mounting and row offsets, selection tools, native-stack scene lifecycle, and shared panel/menu/portal/presence/focus behavior. Existing launch/cache, native text-selection, protected-folder access, and reduced-motion policies remain in place. This is not a new exhaustive route execution or native frame-time audit.

| Contention found in source | Change |
| --- | --- |
| App bar waited for 48dp hysteresis then chased a spring, while scroll progress crossed JS at the sampled bookkeeping rate | App bar now follows clamped user-scroll deltas on the UI thread, with a bounded settle on release. FAB hysteresis remains separate. Reading-progress fraction is computed in the UI scroll handler; accessibility labels and persistence retain sampled JS bookkeeping. Programmatic heading jumps do not arm user momentum |
| Progress segments animated `left` and `width`, requiring layout-affecting updates during scrolling/download animation | Fixed segment geometry with translation/scaling; progress no longer animates Yoga width/position. Wave rendering, palette roles, and reduced-motion behavior remain |
| Idle JS callbacks could append native article sections while the native scroller was flinging | Per-reader cancellable scheduler pauses optional section/Contents work until 180ms after scroll activity. Expansion resumes within two viewports of the mounted end to avoid starving fast readers. Overlay/background activity also cancels optional preparation; mounted article trees remain stable |
| Cold reader engine/content and populated folder lists could mount during the native push | A scene-readiness context waits for the native stack's opening `transitionEnd`, with an animation-duration-plus-150ms fallback for restored/deep-linked scenes. Only cold list/article content waits; navigation chrome paints immediately. Web, instant navigation, and reduced motion bypass the wait. Ready content is not unmounted on blur or return |
| List geometry eagerly allocated offsets for every loaded row, and unused selection tools built a second item index on list entry | Cache row offsets by requested prefix; retain existing exact normal-font geometry and intrinsic accessibility-font sizing. Selection tools use the existing first-use `LazyMount` pattern and remain mounted after activation |
| Native dialog animation could elapse during its first layout, and ordinary dialogs allocated unused sheet gesture worklets | Wait for a positive panel layout before native entrance/autofocus callbacks; retained Contents surfaces reuse their layout. Sheet gesture creation lives in the sheet handle only and is memoized. Header/action/body partitioning is cached across local layout updates |
| Contents heading measurement and scrolling began while its exit was still animating | Hand off selection from the panel's `onExited`; reopening cancels an obsolete pending jump. Exit content, Back/keyboard dismissal, focus restoration, and retained prepared cells are preserved |

Validation completed without adding or running repository-owned tests:

- `pnpm -r typecheck` and `pnpm -r lint`.
- Production web export and Android JavaScript export with `--no-bytecode`.
- `git diff --check`; repository-owned test paths, runner imports, and package commands remain absent.

The prior [development APK run](https://github.com/axoletlabs/ordo/actions/runs/39075917981) succeeded, including native compilation, package verification, and APK upload, for **`6384771` only**. It does not validate the source changes above.

**Limits and residual work:** the desktop browser is disconnected, so no fresh phone/wide, theme/design-mode, keyboard, reduced-motion visual, or timing matrix was executed. Native Android device verification is explicitly excluded. There is no new measured FPS, latency, overall speedup, or leak-free claim. Whole-document HTML/highlight preprocessing remains synchronous; oversized indivisible blocks still mount together, and complete articles still retain their native text views to preserve selection/heading behavior. Cold first-use form rendering, native keyboard behavior, and frame pacing on older devices remain unverified. Global experimental Reanimated/Fabric flags were not enabled: several affect hit testing or require additional native feature-level configuration.

Official references reviewed through the agent-reach web-reader route (2026-10-18):

- [React Native performance](https://reactnative.dev/docs/performance): separate JS/UI frame budgets, avoid heavy work during transitions, prefer transform-based native animation, measure production builds.
- [FlatList configuration](https://reactnative.dev/docs/optimizing-flatlist-configuration): balance bounded batches/windows against blank areas and responsiveness; preserve accurate `getItemLayout` where geometry is known.
- [Reanimated performance](https://docs.swmansion.com/react-native-reanimated/docs/guides/performance/) and [feature flags](https://docs.swmansion.com/react-native-reanimated/docs/guides/feature-flags/): avoid layout animation on scroll hot paths; account for flag-specific touch/runtime caveats rather than enabling every flag blindly.
- [Native-stack navigation](https://reactnavigation.org/docs/native-stack-navigator/): defer nonessential cold content until the opening transition ends while preserving the native navigator's motion.

## Coverage and remaining device checks

| Area | Source/fixture coverage in this pass |
| --- | --- |
| Auth | Sign in, registration, recovery, reset code, email verification, MFA challenge routes; shared inputs/OTP/autofill policy tests |
| Library | Home, folder, tag manager/detail, unified search/filter/sort menus, tagged-row geometry, save/move/edit-tags/delete surfaces |
| Folder workflows | Rename, icon picker, delete confirmation, pattern/PIN/password setup, accessible pattern buttons, nested creation and retained parent/child drafts; follow-up adds delayed mutation checks and actual password-lock/unlock/recovery requests |
| Reader | Article, contents, preferences, reminder presets/custom date/calendar, reduced-motion landscape interaction checks; progress queue unit tests |
| Settings | Root, account, name, email/verification, password, security, sessions, appearance, controls, server, data, about, account deletion routes |
| Settings overlays | Theme keyboard navigation, enlarged authenticator QR, revoke-session and sign-out confirmation; follow-up adds actual import/export, authenticator enrollment/sign-in, and account-deletion step-up |
| Loading and failure | Cold-cache skeleton with delayed network, empty-library save action, server error and successful Retry recovery |
| Shared UI | Buttons, icon actions, fields, selectors, lists, menu/dialog focus and dismissal, spinner/progress/skeleton/OTP lifecycle, scrollbars, root/page motion |

“Route coverage” is not every possible account/server/permission combination. The continuation adds the specific SMTP, encrypted-library, account/server-switching, and offline integrations listed above; it does not verify native file pickers, OS share/update/install flows, biometric unlock, every encrypted-library/server scenario, native WebView selection/scrolling, or every validation/error branch. Existing historical reports are not counted as newly executed verification.

Before native release approval:

1. Install the generated development APK on a low/mid-range Android phone and a tablet; trace cold/warm launch, 1,000+ item scrolling, 500-item moves, first-open overlays/contents, and reader text selection with Perfetto/FrameMetrics. Check both 60Hz and higher-refresh hardware; do not infer native frame times from browser long tasks.
2. Verify Android Back and predictive Back, search IME dismissal/restoration, short-window dialog headers/actions, rotation and edge-to-edge/system insets.
3. Run TalkBack/Switch Access/D-pad through all list, form, OTP, pattern, menu, and confirmation workflows; verify virtualized catalogue navigation beyond initially mounted rows, including Home/End behavior.
4. Verify system font scales through 200%, display scaling, Android 12+ real wallpaper palettes, AMOLED, and all contrast levels. Generated static palette checks do not validate OEM palette extraction or text over every image.
5. Profile background/foreground and obscured overlays on native to confirm repeating-work/battery improvements; check interrupted transitions and preference changes during animation.
6. Extend the loopback end-to-end mutations with account/server switching during progress writes, database upgrade on a backed-up production-like database, offline reconnect, and native encrypted/protected-folder access. The executed loopback subset is not approval of every server/OS workflow.

## Build and static checks

Test reproduction commands were removed with the suites. CI retains typecheck, lint, dependency/security checks, and build/release tooling, but runs no tests.

```sh
pnpm db:generate
pnpm --filter @ordo/shared build
pnpm -r typecheck
pnpm -r lint
pnpm --filter @ordo/server build

pnpm --filter @ordo/mobile exec expo export --platform web --output-dir /tmp/opencode/ordo-audit-web
pnpm --filter @ordo/mobile exec expo export --platform android --no-bytecode --output-dir /tmp/opencode/ordo-audit-android
```

The Android `--no-bytecode` export validates native JS bundling only. This ARM64 environment's supplied Hermes compiler is x86-64; actual Hermes/native APK compilation belongs to GitHub's Android build, not a claimed local native build.

## Official guidance

Reviewed official Material guidance (retrieved 2026-10-17); React Native implementations are custom spec-aligned controls:

- [Color roles](https://m3.material.io/styles/color/roles), [type-scale tokens](https://m3.material.io/styles/typography/type-scale-tokens)
- [Buttons](https://m3.material.io/components/buttons/specs), [icon buttons](https://m3.material.io/components/icon-buttons/specs), [button groups](https://m3.material.io/components/button-groups/guidelines)
- [Menus](https://m3.material.io/components/menus/specs), [lists](https://m3.material.io/components/lists/specs), [search](https://m3.material.io/components/search/specs)
- [Dialogs](https://m3.material.io/components/dialogs/specs), [bottom sheets](https://m3.material.io/components/bottom-sheets/specs), [text fields](https://m3.material.io/components/text-fields/specs)
- [Chips](https://m3.material.io/components/chips/specs), [snackbars](https://m3.material.io/components/snackbar/specs), [tooltips](https://m3.material.io/components/tooltips/specs)
- [Progress indicators](https://m3.material.io/components/progress-indicators/specs), [loading indicator](https://m3.material.io/components/loading-indicator/specs)
- [Spring-based motion](https://m3.material.io/styles/motion/spring-based), [motion overview](https://m3.material.io/styles/motion/overview/how-it-works)
- [Interaction states](https://m3.material.io/foundations/interaction/states/overview), [accessibility basics](https://m3.material.io/foundations/accessible-design/accessibility-basics)
