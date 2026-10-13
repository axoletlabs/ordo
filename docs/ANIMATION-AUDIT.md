# Animation polish audit

## Scope and traceability

The source ledger includes **all 30 routes/layouts, 136 UI source files, and
1,650 JSX occurrences in the initial snapshot**, including conditional elements.
Regenerate it with `node apps/mobile/tests/ui-inventory.mjs`. The ledger records
each occurrence's file, line, props and file hash, rather than only visible
controls. `animation-coverage.test.mjs` prevents a screen being omitted from
the route fixture matrix or a new raw interaction bypassing shared primitives.

Static text, icons, images, badges and containers do not need gratuitous motion.
The review follows their containing row, page or overlay through state changes.
Actions use shared state layers; lists retain the lightweight RN Animated driver.
Shape morphs remain Expressive-only. Hover never resizes interaction targets.

## Screen coverage

The full `material-ui-smoke.mjs` route matrix covers each screen below at
390×844 and 1280×800, in light/dark and Standard/Expressive modes. Additional
flows cover error, loading, empty, nested-picker and reduced-motion states.

| Screen / route | Interaction paths reviewed |
| --- | --- |
| Library `/` | Search activation/exit, filters, sort, overflow, account, create FAB, row hover/hold, multi-selection, drag, action toolbar, loading/error/empty/retry |
| `/search` | Compatibility redirect into the library's search state, query/clear/back, status/tag/folder filters and nested menu handoffs |
| `/folder/[id]` | Row selection/actions, sort, create, folder actions, protected-folder unlock |
| `/tags` | Tag hover/hold/actions, create/edit/color/delete |
| `/tags/[id]` | Bookmark selection/actions, create, tag actions |
| `/reader/[id]` | Navigation, article/website loading, reader controls, typography/theme toggles, contents, highlights, tag/reminder actions |
| `/settings` | Navigation rows, account, sign-out confirmation |
| `/settings/account` | Avatar action menu, account navigation |
| `/settings/display-name` | Field focus/label, validation, save/loading |
| `/settings/email` | Fields, visibility toggle, submit/loading, step-up authentication |
| `/settings/password` | Fields, visibility toggles, submit/loading, step-up authentication |
| `/settings/verify-email` | OTP entry, completion, error/success/loading, resend |
| `/settings/security` | Enrollment, step-up, authenticator setup, backup codes |
| `/settings/sessions` | Session list, revoke confirmation |
| `/settings/appearance` | Theme/menu selections, segmented contrast, switches, transition preference changes |
| `/settings/controls` | Picker menus and switches |
| `/settings/server` | Hosting forms, probes, sibling dialogs, confirmations |
| `/settings/data` | Export selection, import progress/preview/error/complete, duplicate settings, protected-folder unlock |
| `/settings/about` | Changelog/version dialogs, copy feedback, update controls |
| `/settings/delete-account` | Fields, visibility toggle, disabled/loading/destructive action, step-up |
| `/login` | Field progression, password visibility, submit/loading/error, server connection, responsibility gate |
| `/register` | Field progression, password visibility, checkbox, validation/loading |
| `/forgot-password` | Field focus, submission, validation/loading |
| `/reset-password` | OTP and password stages, focus progression, validation/server errors |
| `/verify-email` | OTP, resend/back and error/success/loading feedback |
| `/mfa` | OTP/backup-code modes, verification, sign-in exit |
| Root, auth, app and library layouts | Launch/auth boundaries, navigation policy, focus preservation and live reduced-motion subscription |

The shared-component review includes every action, list, field, checkbox,
switch, segmented control, picker, tooltip, dialog/menu, snackbar, progress,
skeleton, scrollbar, FAB, selection indicator and navigation wrapper in the
ledger. Gesture-driven pattern entry, selection dragging, native text selection
and embedded website content are explicit boundaries, not converted to generic
press animations.

## Corrections

| Problem | Correction |
| --- | --- |
| Menu entrance consumed while waiting for layout | Shared overlay readiness gate: measure and place invisibly, then start spatial/effects motion |
| Selected/highlighted row relaxes on release | Selection holds the pressed corner target, including virtualized rows mounted already selected |
| Trigger highlight arrives after the popup | Publish menu ownership in a layout effect; depend on identity, not changing DTO objects |
| State layer clears its ink before fading | Retain the last nonzero tint throughout exit; use non-overshooting effects for animated feedback |
| Expressive switch remounts shape-aware controls | Stable pressable implementation across design-mode changes; cancel queued release on blur |
| Full-radius chip/time-button springs use a 9,999dp target | Animate the actual half-height corner, so the whole morph is visible rather than only its final frames |
| Segmented check disappears and label jumps | Keep the check mounted; animate its slot and opacity during selection/deselection |
| Loading action shrinks to spinner width | Preserve hidden label/icon geometry beneath an overlaid spinner |
| Obscured parent dialog can collapse after restoration | Resolve the stale-callback check on JS, not a captured ref in a UI worklet; settle live reduced motion |
| Tooltip enters before its final size is known | Gate first entrance on measured size and retain copy through exit |
| Hover/focus restarts snackbar exit | Separate entrance from timeout lifecycle; only finished animations remove the toast |
| OTP shake/bounce persists after state changes | Cancel interrupted sequences, isolate success bounce, retain deleted digits through fade, avoid restored-value mount pops |
| Password icon crossfade uses overshooting spatial spring | Use the non-overshooting effects scheme for the crossfade |
| Field hover snaps in/out | Use the shared retained state layer |
| Native stacks/scrollbars ignore a live accessibility change | Subscribe to current reduced-motion preference and settle animations; auth stack honors it too |
| Changing page-transition settings replays the current page | Read preference at the next focus event; cancel active motion when switching to reduced/instant |
| Dismissing an overlay in reduced motion waits for a callback | Remove it synchronously; retain cancellation/generation guards for normal interrupted exits |

## Verification

Measured before/after using the same fixture data:

| Regression | Before | After |
| --- | ---: | ---: |
| Delayed-layout entrances starting fully opaque | 16/16 | 0/16 |
| Selected inner corner after pointer release | 4px | 20px |
| Loading Save-button width drift | 15.41px | 0px |
| Current-page entrance replay on preference change | 1 | 0 |
| Native/web selected-row driver regressions failing | 6/15 | 0/15 |

The full built-web matrix passed **444 screen/state captures, 72 interaction
flows, 3,712 state-layer silhouette checks, and zero page errors**. The unit
suite passed **585 tests**. TypeScript and lint passed. Android and iOS JS bundle
exports passed. The targeted temporal matrix also exercises interrupted exits
and nested pages; its screenshots show identical dark-mode selection state in
portrait and wide layouts.

The 1,000-bookmark selection fixture completed 20 toggles with 0px toolbar
anchor drift, a 16.8ms p95 frame interval and no long tasks. This is a built-web
fixture measurement, not a native-device frame-rate guarantee.

- `animation-polish.mjs`: frame-samples bookmark/folder long presses with a
  deliberately delayed first layout, both layouts/themes/design modes; checks
  entrance continuity, reopen during exit, dismissal during page handoff,
  persistent selection, keyboard selection, live reduced motion, stable loading
  button width, segmented exit retention and no current-page transition replay.
- `motion-lifecycle.test.mjs`: executes the actual shared hook/component source
  with deterministic commit/completion scheduling. Checks readiness, stale close
  callbacks, live reduced motion and retained feedback ink. Not a device emulator.
- `row-animation-driver.test.mjs`: actual React Native Animated graph/driver guard
  on Android/iOS/web, plus selected shape and already-selected mount regressions.
- Full built-web smoke matrix, TypeScript, lint, unit tests, and Android/iOS bundle
  export. Screenshots are fixture-based, not production-account/backend tests.

**Limits:** all source occurrences and screen routes are accounted for; fixture
flows are not proof of every possible server response, OS keyboard, native
selection menu, browser website or hardware timing. Native visual confirmation
on a physical device is still needed; bundle export and driver tests alone do
not establish frame-by-frame device behavior.
