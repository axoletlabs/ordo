# App-wide performance, Material 3, and motion audit

The [follow-up pass](#follow-up-workflow-and-policy-audit) extends the initial results below with real-server workflows, delayed/rejected mutations, narrow OTP fields, and mandatory-MFA accessibility. **This is still not exhaustive native release approval.** Native/device checks and the documented first-dialog main-thread costs remain open.

## Scope and confidence

Date: 2026-10-17. Baseline: `01af889` (`perf(mobile): eliminate contents menu mounting stalls`).
Target: the Expo/React Native app, its shared UI/data paths, and server bookmark-list queries.

The [source inventory](full-app-audit-2026-10-17/source-inventory.json) covers **343 TypeScript files and 30 route/layout files**, including exact line, JSX interaction-site, and motion-call totals. It records paths and source hashes; it is an inventory, **not proof that every branch was executed**. The scanner can also emit individual handlers and motion call locations.

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

The [verification manifest](full-app-audit-2026-10-17/verification.json) records export fingerprints and links the complete passing result files:

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

[All five samples per implementation](full-app-audit-2026-10-17/cache-benchmark.json) are retained, alongside a separately labeled [baseline browser summary](full-app-audit-2026-10-17/baseline-browser-summary.json).

### Representative captures

- [Standard appearance](full-app-audit-2026-10-17/appearance-standard.png) and [Expressive appearance](full-app-audit-2026-10-17/appearance-expressive.png): complete contrast labels at 390px.
- [Narrow save dialog](full-app-audit-2026-10-17/save-narrow.png): 320px viewport, persistent field labels, and visible actions.
- [Dark authenticator QR dialog](full-app-audit-2026-10-17/authenticator-dark.png): modal hierarchy and contained QR geometry.

These are synthetic-fixture browser screenshots, not Android screenshots.

## Follow-up workflow and policy audit

The continuation starts from published commit `e6616d4`, keeping the original evidence above as historical results. Its separate [verification manifest](full-app-audit-2026-10-17/follow-up/verification.json) records the production export fingerprints, exact suite totals, and complete result files. Earlier failing experiments are not counted as passes.

The updated [source inventory](full-app-audit-2026-10-17/follow-up/source-inventory.json) contains **344 TypeScript files, 30 route/layout files, 41,435 lines, 603 interaction sites, and 115 motion calls**. These are source counts, not dynamic coverage percentages.

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

**Open work:** the native release checklist below; SMTP delivery/reset/email-change integration; broader account/server switching and offline race testing; native protected/encrypted-library and WebView workflows; and further cold-dialog profiling/remediation. The source inventory and executed matrices are not an assertion that every possible validation, permission, account, and OS branch has been executed.

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

“Route coverage” is not every possible account/server/permission combination. The follow-up completes the specific actual authentication/import/export/protected-folder workflows listed above, but not SMTP delivery, native file pickers, OS share/update/install flows, biometric unlock, every encrypted-library/server scenario, native WebView selection/scrolling, or every validation/error branch. Existing historical reports are not counted as newly executed verification.

Before native release approval:

1. Install the generated development APK on a low/mid-range Android phone and a tablet; trace cold/warm launch, 1,000+ item scrolling, 500-item moves, first-open overlays/contents, and reader text selection with Perfetto/FrameMetrics. Check both 60Hz and higher-refresh hardware; do not infer native frame times from browser long tasks.
2. Verify Android Back and predictive Back, search IME dismissal/restoration, short-window dialog headers/actions, rotation and edge-to-edge/system insets.
3. Run TalkBack/Switch Access/D-pad through all list, form, OTP, pattern, menu, and confirmation workflows; verify virtualized catalogue navigation beyond initially mounted rows, including Home/End behavior.
4. Verify system font scales through 200%, display scaling, Android 12+ real wallpaper palettes, AMOLED, and all contrast levels. Generated static palette checks do not validate OEM palette extraction or text over every image.
5. Profile background/foreground and obscured overlays on native to confirm repeating-work/battery improvements; check interrupted transitions and preference changes during animation.
6. Extend the loopback end-to-end mutations with account/server switching during progress writes, database upgrade on a backed-up production-like database, offline reconnect, and native encrypted/protected-folder access. The executed loopback subset is not approval of every server/OS workflow.

## Reproduction

```sh
pnpm db:generate
pnpm --filter @ordo/shared build
pnpm --filter @ordo/mobile test
python3 apps/server/scripts/query-plan-test.py
pnpm -r typecheck
pnpm -r lint
pnpm --filter @ordo/server build

node apps/mobile/scripts/audit-inventory.mjs /tmp/opencode/ordo-source-inventory.json
node --expose-gc apps/mobile/scripts/cache-move-benchmark.cjs 01af889

pnpm --filter @ordo/mobile exec expo export --platform web --output-dir /tmp/opencode/ordo-audit-web
pnpm --filter @ordo/mobile exec expo export --platform android --no-bytecode --output-dir /tmp/opencode/ordo-audit-android
```

Serve the web export with a static **SPA-fallback** server. Install Playwright separately or provide an existing installation; it is deliberately not a new runtime dependency. Configure `ORDO_UI_URL`, `ORDO_UI_OUTPUT`, optional `PLAYWRIGHT_MODULE` (module path), and `PLAYWRIGHT_CHROMIUM` (executable), then run:

```sh
node apps/mobile/scripts/ui-audit.mjs --routes-only
node apps/mobile/scripts/ui-audit.mjs --overlays-only
node apps/mobile/scripts/ui-audit.mjs --overlays-only --wide-overlays
node apps/mobile/scripts/ui-audit.mjs --states-only
node apps/mobile/scripts/ui-audit.mjs --quick
node apps/mobile/scripts/workflow-audit.mjs
node apps/mobile/scripts/auth-policy-audit.mjs
node apps/mobile/scripts/profile-dialogs.mjs
```

For actual server workflows, start a **new disposable loopback server**, never a normal local/remote installation. Build the server first, use a new database path each time, and keep secrets test-only:

```sh
NODE_ENV=test PORT=8260 LISTEN_HOST=127.0.0.1 \
DATABASE_URL="file:/tmp/opencode/ordo-audit-$(date +%s).db" \
JWT_SECRET="$(node -e 'console.log(require("node:crypto").randomBytes(32).toString("hex"))')" \
LIBRARY_KEK="$(node -e 'console.log(require("node:crypto").randomBytes(32).toString("hex"))')" \
REGISTRATION_ENABLED=true EMAIL_VERIFICATION_REQUIRED=false SMTP_URL= SMTP_REQUIRED=false \
RATE_LIMIT_ENABLED=false pnpm --filter @ordo/server start
```

In a separate terminal, with the exported web app served and the same Playwright environment configured:

```sh
ORDO_AUDIT_API=http://127.0.0.1:8260 node apps/mobile/scripts/local-server-audit.mjs
```

The local-server runner refuses non-loopback endpoints, creates its own account, and deletes that account after the successful end-to-end run. Failed runs can leave disposable accounts in the disposable database; do not point this runner at real data. Give each script its own `ORDO_UI_OUTPUT`. Run timing comparisons **without** the other browser/build processes; parallel layout matrices are only correctness evidence.

Use a different output directory per invocation. Run `--quick` without competing browser/build workloads when comparing timings. `--baseline` records known baseline findings without failing. Timing includes Playwright actionability and an explicit settle window; it is **not an animation duration or FPS measurement**. CI runs deterministic mobile regressions and SQLite migration/query-plan tests; browser export testing remains opt-in.

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
