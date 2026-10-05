# Material UI audit and verification

Date: 2026-10-05. Target: `apps/mobile`, shared contracts, and `apps/server`.

This records the first pass. See the [Material/performance follow-up](material-performance-follow-up.md)
for the source inventory, later control corrections, additional browser branches
and performance evidence. The results below are historical, not exhaustive
release approval.

## Design decision

Ordo is a reading library, not a dashboard. Keep the teal Material role palette,
Roboto scale, left-aligned content, 16dp screen rail, and one constrained pane.
The unified search app bar remains the only library navigation chrome in both
orientations. Expressive changes component shape, grouped surfaces, emphasis,
and motion; it does not change the app's color identity.

This pass improves shared controls rather than adding another screen-specific
design system. Existing library/reader refinements in the worktree are preserved.

## Corrections and measurable comparisons

| Before | After |
| --- | --- |
| Sign-in recovery/account links measured 20px high at both test widths | Both links now measure 48px at both widths; browser matrix enforces the 48px minimum |
| Backup-code sign-in had 0 direct exit buttons | Every MFA mode provides 1 “Back to sign in” action |
| Validation could appear on display name/email regardless of the failing field | Field-owned validation, `aria-invalid`, associated supporting text, and form-wide failure announcements |
| Sign-in/register had no explicit Enter focus progression | Next-field progression and final-field submission; sign-in is exercised with a rejected server response |
| Selection menus lacked explicit radio/checkbox roles in several callers | Shared menu items expose checked state and appropriate selection roles |
| Move picker nested its virtualized list in the dialog scroll body | Picker owns list scrolling and busy/dismissal state; the credential fallback remains a scrollable form |
| Filter selection could move choices underneath the pointer | Stable catalogue order while changing tag/folder selection |
| Quick-tag creation errors were silently swallowed | Failure notification and retained input |
| Tag creation/editing depended on disappearing placeholder labels | Persistent “Tag name” labels and 8dp-based color-control spacing |
| Avatar hover/pressed feedback filled a padded rectangle | Feedback follows the circular 72dp avatar; spacing belongs outside its target |
| A newly typed server address reused the last successful probe until debounce fired | Connect stays disabled until that exact address is verified; invalid URLs and HTTP failures have field-owned errors |
| Account deletion did not state the full irreversible consequence in the form | Permanent deletion, export-first guidance, and explicit confirmation helper |

Server-dialog delayed focus now returns a timeout handle accepted by
`FloatingPanel`; its effect cancels that handle on dismissal/obscuring. No
additional timer mechanism is needed.

## Reproducible browser verification

`apps/mobile/tests/material-ui-smoke.mjs` tests the production Expo web export.
Run `pnpm --filter @ordo/mobile test:ui` against a static SPA server using
`ORDO_UI_URL`. It imports `playwright` by default; isolated environments may set
`PLAYWRIGHT_MODULE` and `PLAYWRIGHT_CHROMIUM`. Screenshots and results go to
`ORDO_UI_OUTPUT`. Optional `ORDO_UI_THEME` and `ORDO_UI_EXPRESSIVE` narrow the run.
`ORDO_UI_SKIP_SCREEN_MATRIX=1` is only for debugging overlay scenarios; it is
not the full screen matrix and was not used for the final full-run counts.

The matrix covers light/dark × Standard/Expressive, 390×844 portrait and
1280×800 landscape. Creation forms also run at 320×420; reduced-motion menus
run in every design/color combination. Captures assert nonblank content, no
error boundary, no page-level horizontal overflow, and authenticated content
on in-app routes.

### Screen inventory

- Auth: sign in, registration, forgot password, reset-password code entry,
  email verification, MFA code entry, backup-code mode and exit.
- Library: idle, active search, folder, tag manager, tag detail, and reader.
- Settings: root, account, display name, email change and its verification,
  password change, authenticator, sessions, appearance, controls, hosting,
  data, about, account deletion, and the current changelog sheet.
- The legacy `/search` page redirects to the unified library search. Navigation
  tests use that actual library control, not a separate search screen.
- The legacy changelog route is not counted as a separately verified page;
  About opens the current shared changelog sheet.

### Overlays and interactions

- Library menu: keyboard End navigation and Escape dismissal.
- Create menu, save form, nested folder selection and draft preservation.
- Folder creation, sibling icon picker, single active dialog and retained name.
- Folder actions, rename, lock-method menu, password entry, PIN confirmation/
  mismatch, pattern setup surface, and folder-deletion confirmation.
- Folder/bookmark sorting submenus and their 3/4 radio choices.
- Tag actions, creation/editing at portrait/wide/constrained sizes, and
  tag-deletion confirmation.
- Bookmark menu, move picker, tags, reminder menu and custom reminder dialog,
  destructive bookmark confirmation, search filters, and reader controls.
- Account picture menu, settings radio menu, revoke-session/sign-out dialogs.
- Authenticator setup and one-time backup-code dialog.
- Self-host responsibility gate, verified address, new-address invalidation,
  HTTP failure, invalid URL, and dismissal.
- Quick-tag failure announcement with retained query.
- Larger tag/folder filter catalogues, named query inputs, filtering, and
  unchanged catalogue order after selecting a tag.
- Library loading → empty, error → Retry → empty, and empty-state save action.

These are fixture-backed UI checks, **not** browser-to-real-server end-to-end
tests. Fixtures intentionally isolate presentation and routing. Authenticated
screens are reached using the app's navigation; full reloads lose the in-memory
fixture session because Expo SecureStore is native-only. Token storage was not
weakened to make the tests pass.

## Source audit assessment

Scores are source/browser review estimates, not an accessibility certification
or proof that every native interaction works.

| Category | Score / 10 | Assessment |
| --- | --- | --- |
| Color roles | 8 | Generated paired roles; component contrast regression coverage |
| Typography | 8 | Roboto Material scale; intentional mono for codes/server addresses |
| Shape | 8 | Shared tokens and mode-aware shapes |
| Elevation | 8 | Tonal hierarchy across menus, dialogs and settings |
| Components | 8 | Shared React Native primitives following Material anatomy |
| Layout | 8 | One constrained pane; compact, wide and constrained browser checks |
| Navigation | 8 | Unified library search, full-screen reader and preserved Back path |
| Motion | 7 | Shared spatial/effects schemes; reduced-motion browser smoke check |
| Accessibility | 7 | Targets, validation associations, selection semantics and keyboard checks; screen-reader/device verification remains |
| Theming | 8 | Both modes/schemes; Android Material You requires a real device |

Overall: **78/100**, provisional for the reviewed implementation.

Component contrast tests cover six seed families, both schemes and three
contrast levels (36 cases), including all tonal surfaces, supporting text,
field boundaries and focus indicators. The existing role tests additionally
cover role pairs. The normal-text assertion uses 4.45:1 to allow integer RGB
rounding near Material's 4.5:1 target; it is not strict WCAG certification.

## Executed checks

| Check | Result |
| --- | --- |
| Mobile interaction + unit tests | 378 passed (32 + 346) |
| Material role + component contrast tests | 118 passed (82 + 36) |
| Server unit tests | 271 passed across 35 suites |
| Server end-to-end tests | 178 passed across 8 suites |
| Shared contract tests | 35 passed |
| Workspace typecheck and lint | Both passed, 4 workspace tasks each |
| Server production build | Passed |
| Expo web export | Passed |
| Android + iOS JavaScript exports (`--no-bytecode`) | Both passed |
| Full browser matrix | 412 screen/state captures and 60 interaction groups passed; 0 uncaught page errors |

Total: **980 automated tests**, before counting browser smoke assertions.

Each color scheme completed 206 captures and 30 interaction groups, including
both design modes. Counts describe repeated screen/state captures, not 412
unique screens. Constrained tag forms additionally verify that the final color
choice scrolls into view, remains selectable, and retains the name draft.

Generate the Prisma client (`pnpm --filter @ordo/server db:generate`) before
backend checks in a fresh checkout. The initial missing-client failure was a
build setup issue, not a tested API defect. Server end-to-end suites cover auth/
recovery, MFA/avatars, bookmarks/folders/tags/reminders/search, protected-folder
visibility, encryption, import, cookies/CORS/CSRF, rate limits and telemetry.

Example browser run after exporting the latest app:

```sh
# From apps/mobile; serve this directory with an index.html SPA fallback.
pnpm exec expo export --platform web --output-dir /tmp/opencode/ordo-comprehensive-after
ORDO_UI_URL=http://127.0.0.1:8235 pnpm test:ui
```

## Verification limits and follow-up

- No connected Android/iOS device: IME animation/Back, autofill, TalkBack/
  VoiceOver, haptic feel, biometrics, notifications, native WebView, sharing,
  filesystem import/export, installer and real Material You remain unverified.
- Android/iOS JavaScript export is a bundle check, not a native application
  build or device test. Hermes bytecode export is blocked on this ARM host:
  the bundled x86-64 compiler exits 128 even for its version command.
- Browser scenarios do not exhaust every server error, timeout, encryption/
  protected-folder state, role/permission combination, very large catalogue,
  legal webpage, password-reset second stage, or MFA recovery/rotation branch.
  Browser zoom/large-type and assistive-technology passes remain release gates.
- Pattern setup is visually checked, not gesture-completed. Device lock and
  protected-folder unlock/removal still need real credential/device scenarios.
  Bulk-selection/add-tags, import completion, cloud/server-switch confirmation,
  and every destructive mutation/undo branch are not fully exercised here.
- Backend unit/end-to-end suites independently verify server behavior. They
  do not prove all UI and production delivery integrations work together.
- No production deployment was performed. Do not interpret this audit as
  “zero bugs” or exhaustive release approval.

Next release gate: run the native device matrix, then real-client/server flows
for authentication/recovery, protected folders, import/export, and notification
delivery with representative data and failed network responses.

## Official guidance used

- [Color roles](https://m3.material.io/styles/color/roles),
  [contrast](https://m3.material.io/styles/color/system/contrast),
  [typography](https://m3.material.io/styles/typography/overview), and
  [shape](https://m3.material.io/styles/shape/overview).
- [Buttons](https://m3.material.io/components/buttons/guidelines),
  [button groups](https://m3.material.io/components/button-groups/guidelines),
  [menus](https://m3.material.io/components/menus/guidelines),
  [lists](https://m3.material.io/components/lists/guidelines), and
  [search](https://m3.material.io/components/search/guidelines).
- [Text-field anatomy/specs](https://m3.material.io/components/text-fields/specs),
  [text-field accessibility](https://m3.material.io/components/text-fields/accessibility),
  [dialogs](https://m3.material.io/components/dialogs/guidelines), and
  [accessible design](https://m3.material.io/foundations/accessible-design/overview).
- [Motion](https://m3.material.io/styles/motion/overview) and
  [transitions](https://m3.material.io/styles/motion/transitions/transition-patterns).
- [Material for web](https://m3.material.io/develop/web): Material Web is in
  maintenance mode and does not implement M3 Expressive. Ordo's custom React
  Native controls are spec-aligned, not an official Expressive web library.
