# App-wide performance, Material 3, and motion audit

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

Browser results are collected against production Expo exports with synthetic API/session fixtures. No real account is used and no real folder, bookmark, authentication setting, or session is modified. The screen helper waits for a visible route marker and splash dismissal before capture; early captures taken before that readiness fix were discarded.

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

## Coverage and remaining device checks

| Area | Source/fixture coverage in this pass |
| --- | --- |
| Auth | Sign in, registration, recovery, reset code, email verification, MFA challenge routes; shared inputs/OTP/autofill policy tests |
| Library | Home, folder, tag manager/detail, unified search/filter/sort menus, tagged-row geometry, save/move/edit-tags/delete surfaces |
| Folder workflows | Rename, icon picker, delete confirmation, pattern/PIN/password setup, accessible pattern buttons, nested creation and retained parent/child drafts |
| Reader | Article, contents, preferences, reminder presets/custom date/calendar, reduced-motion landscape interaction checks; progress queue unit tests |
| Settings | Root, account, name, email/verification, password, security, sessions, appearance, controls, server, data, about, account deletion routes |
| Settings overlays | Theme keyboard navigation, enlarged authenticator QR, revoke-session and sign-out confirmation |
| Loading and failure | Cold-cache skeleton with delayed network, empty-library save action, server error and successful Retry recovery |
| Shared UI | Buttons, icon actions, fields, selectors, lists, menu/dialog focus and dismissal, spinner/progress/skeleton/OTP lifecycle, scrollbars, root/page motion |

“Route coverage” is not every possible account/server/permission combination. Not dynamically completed here: real authentication/SMTP, import/export/native file pickers, OS share/update/install flows, biometric unlock, persisted encrypted-library/server integration, native WebView selection/scrolling, or every validation/error branch. Existing historical reports are not counted as newly executed verification.

Before native release approval:

1. Install the generated development APK on a low/mid-range Android phone and a tablet; trace cold/warm launch, 1,000+ item scrolling, 500-item moves, first-open overlays/contents, and reader text selection with Perfetto/FrameMetrics. Check both 60Hz and higher-refresh hardware; do not infer native frame times from browser long tasks.
2. Verify Android Back and predictive Back, search IME dismissal/restoration, short-window dialog headers/actions, rotation and edge-to-edge/system insets.
3. Run TalkBack/Switch Access/D-pad through all list, form, OTP, pattern, menu, and confirmation workflows; verify virtualized catalogue navigation beyond initially mounted rows, including Home/End behavior.
4. Verify system font scales through 200%, display scaling, Android 12+ real wallpaper palettes, AMOLED, and all contrast levels. Generated static palette checks do not validate OEM palette extraction or text over every image.
5. Profile background/foreground and obscured overlays on native to confirm repeating-work/battery improvements; check interrupted transitions and preference changes during animation.
6. Exercise real-server mutations, account/server switching during progress writes, database upgrade on a backed-up production-like database, offline reconnect, and encrypted/protected-folder access. Fixture success is not server end-to-end validation.

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
```

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
