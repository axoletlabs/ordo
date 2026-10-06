# Material and performance audit: follow-up

Date: 2026-10-05. Branch: `material-3-redesign`.

This continues [the first audit](material-comprehensive-audit.md). It is not a
claim that every runtime state is perfect, WCAG-certified, or free of dropped
frames. Native-device and production integration gates remain open.

## Exhaustive source inventory, bounded verification

`apps/mobile/tests/ui-inventory.mjs` uses the TypeScript JSX AST, not a filename
guess or a regular-expression list. It enumerates every JSX occurrence and
label-bearing attribute/option-object property in `app/` and `src/components/`, with source line,
properties, conditional elements, and a SHA-256 hash for each file. Dynamic
labels are retained as expressions; the tool does not claim to evaluate every
possible value. Imported native/OS UI and legal websites are outside this JSX
inventory. There is no `apps/web` package in this checkout: Expo serves web.

```sh
cd apps/mobile
node tests/ui-inventory.mjs   # writes the inventory JSON to stdout
```

The inventory covers **137 files, 31 routes/layouts, 1,617 JSX occurrences and
873 label occurrences**. These are source counts, not unique rendered screens.
The seven raw-control flags are shared implementation boundaries: menu/dialog
backdrops, `Input`, the hidden OTP editor/activation surface, `ListPressable`
and `PressableScale`. The bookmark browser action no longer bypasses the list
primitive. An empty flag list would still not prove spec compliance.

### Surface ledger

| Surface family | Verification and remaining branches |
| --- | --- |
| Root/auth/app/tab layouts | Enumerated; browser provider/routing path exercised; native splash, safe areas and navigation transitions require devices |
| Library and search alias | Browser loading, empty, failure/retry, search/filter/catalogue states; large real-library scrolling and native IME/Back remain |
| Folder and tag lists/details | Browser routes and action/picker overlays; real protected-token expiry and bulk selection remain |
| Reader route and controls | Browser reader, four text-size choices, font group, theme menu and preference update fixtures; native HTML/WebView/selection remain |
| Settings home/account | Browser routes, avatar action/feedback, sign-out confirmation; real image upload/delivery remains |
| Display name/email/verify email/password/delete account | Browser forms and confirmations; real delivery and destructive mutations remain |
| Appearance/controls | Browser themes/modes, selection semantics and pressed switch geometry; real dynamic color, font scaling and hardware motion remain |
| Security/sessions | Browser enrollment/backup-code presentation and revoke dialog; recovery, rotation, revocation completion and MFA step-up combinations remain |
| Data/import/export | Browser format/folder selection, import preview/completion/failure and protected-folder sibling prompt; native document picker/files/sharing and real transfers remain |
| Server/self-host | Browser responsibility gate, exact-address verification and failures; real server-switch confirmations/integration remain |
| About/changelog | Browser routes/overlay; APK installer, OTA restart and platform permission UI remain |
| Login/register/forgot/reset/verify/MFA | Browser routes, form failures, reset second stage/keyboard/error ownership and backup exit; real autofill, delivery and complete recovery combinations remain |
| Shared menus/dialogs/toasts/fields/buttons/lists | Shared-source corrections and browser keyboard/reduced-motion checks; screen readers, live native gestures and all mutation/undo combinations remain |
| Pattern/device lock, incoming share, connectivity, updates | Enumerated custom/native boundaries; not declared device-verified |

## Spec corrections

- **Segmented buttons:** Standard now has the specified 1dp outline and
  boundaries; selected options in all group lengths have a check. Accessible
  group names cover every current use. Expressive remains connected,
  shape-changing toggles, without pressed-width expansion or palette changes.
- **Reader controls:** size abbreviations expose full accessible names. Four
  potentially long theme labels use the shared radio menu rather than cramped
  segments. The account preference fixture now returns the actual updated
  `UserDto`, rather than accidentally replacing preferences with `{success}`.
  Import fixtures issue a distinct job ID for every upload, as the real API
  does; reusing IDs incorrectly kept the first preview in the query cache.
- **Switch:** keeps the 52×32dp track and 48dp target, adds the 28dp pressed
  handle and handle-centred state layer, and uses disabled Material roles.
  Transparent feedback is safe for Android ripple color parsing.
- **Lists:** hover/press feedback is an overlay rather than replacement of a
  selected container. It stays lightweight (no Reanimated spring per list
  action). The bookmark external-browser action uses this shared primitive,
  not opacity-only feedback.
- **Custom reminder:** full spoken dates, shared action state layers and
  separated 48dp calendar targets. Below 416dp, use validated local-calendar
  text entry rather than squeezed dates or overlapping hitSlop. The common
  dialog owns scrolling; its header/actions remain outside the scroll body.
  This custom date/time composition is not an official Material picker SDK.
- **Password reset:** new-password validation belongs to that field,
  confirmation mismatch to confirmation, and server failure to a form alert.
  Enter advances to confirmation. Backend errors no longer falsely mark the
  confirmation input invalid.
- **Data:** export selection exposes checked radio/checkbox state. Import
  preview normalization is memoized; its parent is obscured during a sibling
  folder-unlock prompt without losing the preview.

## Performance corrections and methodology

1. **Avoid eager article indexing.** Metadata warming and short primary-field
   queries no longer read/tokenize reader-detail bodies. Eligible secondary
   matching lazily indexes the body once per immutable bookmark object. The
   WeakMap stays in memory; no global protected index is persisted.
2. **Reduce per-record work.** Indexing no longer case-folds an already folded
   field again. Matching accumulates token ranks without intermediate arrays;
   unfiltered local searches do not normalize tags or construct an unnecessary
   cached-ID tuple array/map. Ranking behavior is preserved.
3. **Remove unused bundled font faces.** Import only the ten actually loaded
   faces, not Google-font package barrels. The export still includes one
   required icon font. Typography and the reader's chosen faces are unchanged.

The initial deterministic 1,000-reader-detail workload (~72KB body per detail)
took **2,046.77ms and 1,000 body reads before**, versus **25.39ms and zero body
reads** in the first follow-up run. These are ARM-host Node timings, not native
frame traces. Tests check lazy reads/cache/replacement and **76,800 before/after
rank comparisons were identical**, including fuzzy, omitted-tag and secondary
field options.

Web font assets changed **47 → 11**, or **7,378,632 → 1,859,768 bytes** (74.8%
less exported font data). This reduces distribution/cache footprint; it is not
a measured 74.8% startup improvement, since unused faces were not all loaded.

`pnpm --filter @ordo/mobile test:performance` runs five warmed 10,000-bookmark
searches and the cold reader-detail workload. Warm median/p95 are reported,
not asserted against fragile wall-clock thresholds. Ordering is verified
outside the timed region. Broad warmed-search speedups are not claimed: the
initial runs were mixed/noisy, and still exceeded a 16.7ms frame budget for
some workloads.

The final timing-only run (assertions outside the timed region) reported:

| Warm 10k-bookmark query | Median | p95 |
| --- | --- | --- |
| `mat` | 11.52ms | 12.35ms |
| `material design` | 22.06ms | 25.32ms |
| `reading` | 14.76ms | 17.88ms |
| `missing` | 11.09ms | 11.93ms |
| `materail` (fuzzy) | 14.76ms | 15.52ms |

Its cold reader-detail sample was **11.51ms, zero body reads**. Do not compare
the warm values directly with the initial assertion-inclusive measurements.

The production-export UI suite collects requestAnimationFrame intervals and
Long Task entries around library-menu, reader-controls and font-size actions.
This fixture uses one bookmark, records host/browser scheduling rather than
native compositor frames, and does not establish zero lag across the app. The
full light/dark matrices run concurrently on this four-core host, so their
frame samples include cross-process contention, not just app work.

The completed matrix's **12 samples** reported **16.7–16.8ms p95 frame
intervals**, **16.8ms maximum interval** (rounded), and **zero Long Tasks**.
These are limited approximately half-second samples of three interactions in
four theme/mode combinations, not an app-wide frame pacing guarantee.

## Release gates

- `adb devices -l` returned **zero devices**. Release-native p50/p95/p99 frame
  pacing, startup, memory, scrolling, reader parsing and gesture/keyboard traces
  are required on low/mid/high-end Android and iOS, at both 60Hz and high refresh.
- Test real 10k+ catalogues, long articles, cold and warm caches, protected-folder
  token changes and failed network responses; compare traces, not perceived
  smoothness. Eligible long-body searches can still require expensive indexing.
- Large type, browser zoom, TalkBack/VoiceOver, autofill, biometrics, WebView,
  notifications, sharing/files, installer and Material You remain unverified.
- JavaScript exports are not native release builds. The first pass's Hermes
  compiler/ARM-host incompatibility remains unresolved.
- Exercise remaining ledger branches against a real server and representative
  accounts. Independent server suites do not replace a real-client integration
  pass. No production deployment or exhaustive release approval is implied.
- Profile real server request p95/p99 and database queries with representative
  large libraries and concurrent imports/searches. Passing server correctness
  suites is not backend latency or throughput certification.

## Executed automated/build checks

| Check | Result |
| --- | --- |
| Mobile interaction/unit suites | 378 passed |
| Calendar-input regression tests | 2 passed |
| Material role/component contrast | 118 passed |
| Shared search/contract tests | 38 passed |
| Server unit suites | 271 passed, 35 suites |
| Server end-to-end suites | 178 passed, 8 suites |
| Workspace typecheck/lint | Both passed, 4 tasks each |
| Server production build | Passed |
| Web production export | Passed |
| Android/iOS/web JavaScript export (`all --no-bytecode`) | Passed; not a native binary build |
| Full light/dark × Standard/Expressive browser matrix | 452 captures, 72 interaction groups passed; 0 uncaught page errors |
| Small-fixture browser performance samples | 12 recorded; p95 16.7–16.8ms, 0 Long Tasks |

Total: **985 automated tests**, plus browser assertions and the separate rank
parity experiment. Run artifacts were ephemeral and are not kept in the repo.

Each scheme completed **226 captures and 36 interaction groups**, including
both design modes. Compared with the first pass: **412 → 452 captures** and
**60 → 72 interaction groups**. They include repeated screen/state captures,
not 452 unique screens, and do not cover every branch in the ledger. Final
matrix results were reviewed at run time (final dark/light `results.json`);
debug runs used the
`ORDO_UI_SKIP_SCREEN_MATRIX` shortcut, but these final runs did not.

## Additional official references

- [Segmented-button anatomy/outline/measurements](https://m3.material.io/components/segmented-buttons/specs)
- [Switch track, handle and state anatomy](https://m3.material.io/components/switch/specs)
- [Date-picker input variants](https://m3.material.io/components/date-pickers/specs)
- [Snackbar anatomy](https://m3.material.io/components/snackbar/specs)

The first audit contains the broader color, shape, typography, motion,
accessibility and Expressive references. The frontend direction remains Ordo's
quiet teal reading library, not a new screen-specific visual system.
