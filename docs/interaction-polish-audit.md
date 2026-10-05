# Hover, selection and app-bar polish

## Direction and review

Ordo is a reading library, not a dashboard. Keep saved titles and folder names left aligned; no new decorative cards, typefaces, navigation chrome or palette. Existing Material roles supply light surface `#F4FBF8`, dark surface `#0E1513`, light ink `#161D1C`, dark ink `#DDE4E1`, and the teal seed `#006A60` (reference colors only; implementation uses generated roles/Material You).

Roboto retains the Material scale. Spend the motion on the user's selection: fade the tonal state/checkmark in place, keep row silhouettes stable, and resize the toolbar from its existing right edge. Hover changes opacity only. Respect reduced motion and distinguish keyboard focus from mouse focus.

```text
Safe area, once
┌ Back / Library      Title or search      Actions ┐ 64dp
├ Saved item / folder: feedback follows its shape  ┤
│ Nested chip or action owns its own feedback      │
│ Selection tint fades; row positions do not move  │
└ Read  Move  Tags  Copy   Delete ────────────────● ┘
                                    fixed right edge
```

Review against the brief rejected a universal rounded hover tile: grouped list edges, menu items, circles, filled fields and connected segments have different shapes. It also rejected per-button layout springs, which cannot preserve the toolbar edge when siblings are removed. The resulting system reuses each component's actual corners and a single toolbar geometry animation.

## Audit and fixes

| Area | Findings / resolution |
| --- | --- |
| Shared action state layers | Explicit longhand corners, clipped feedback surface, Material 8% hover / 10% press-focus, non-overshooting opacity. Mouse focus no longer leaves a second selection-like highlight. Replace automatic Android rectangular ripple with the same shaped pressed layer. |
| Native hover delivery | React Native's Android pointer dispatch and Pressability hover flag default to off. A config plugin enables pointer dispatch before application creation, and explicit native pointer enter/leave handlers feed shared feedback (mouse/pen only, never touch). No private JS feature-flag override. Requires a rebuilt Android binary; an OTA on an old binary cannot enable native dispatch. |
| Animated action controls | Hover does not trigger geometry changes. Press shape and state layer use the same live corner animation. Preserve keyboard focus outlines. |
| List controls | Lightweight native-driver fades rather than per-row Reanimated color/layout work. Disabled feedback stays off. |
| Bookmark/folder/tag rows | Remove the independent 20dp hover squircle. Full-bleed feedback clips to the exact existing group silhouette; web nested actions/chips no longer highlight the parent simultaneously. Selection/checkmarks fade in place without popping group corners. Native nested hover interaction still needs device verification. |
| Menus and grouped settings | Shared state layer preserves all four individual corners. Menu items explicitly clip and have one shape definition. First/last group edges retain their real outline. |
| Avatars, icon actions and URL title | Account feedback is inset to the visible 40dp avatar while retaining its 48dp target. Reader URL long-press gets a 48dp, rounded target instead of a thin square text highlight. |
| Switches | Retain the moving circular handle halo; press/release/hover/focus resolve together and use effects springs instead of abrupt opacity resets. |
| Auth, fields, chips and pickers | Retain role-specific shapes and focus outlines; round checkbox-line/hosting-link targets. Inline prose links and text-input focus remain distinct from button hover. |
| Selection updates | Screen-scoped external store gives rows direct per-key subscriptions. FlatList no longer refreshes every cell through `extraData` / `renderItem` changes on each toggle. Read the current store synchronously to avoid dropped rapid toggles. Library, folder and tag lists share this path. |
| Contextual toolbar | Keep action identities during transitions; fade removed actions but disable/hide them from interaction and accessibility immediately. Animate the whole slot geometry together from the right, preserving Delete's anchor. Preserve adjacent compression for pressed groups. |
| Keyboard selection | RN Web's built-in Space handler excludes selection roles. Shared actions/lists now activate checkbox/radio/switch roles once, prevent scroll/repeats, and don't activate parents for nested key events. |
| App bars | Exactly one safe-area inset. Default standard, library/search and reader app bars share a 64dp footprint; compact-height bars retain 56dp. Standard outer padding **16 → 0dp**; tonal/search outer padding **16 → 8dp**. |
| Website host | Browser host starts directly after the app-bar wrapper. Explicit zero WebView content insets/margins/padding; disable automatic inset adjustment. Do not rewrite external sites' own page margins or navigation padding. |

All hover/press actions in `apps/mobile/app` and `apps/mobile/src` were inventoried, including auth, settings, picker/dialog/menu, reader, list and floating controls. Raw `Pressable` exceptions are overlay dismissal scrims and the OTP input's input-focus wrapper, not painted hover buttons. Shared tests inspect state-layer corners/bounds across the full screen/state fixture matrix.

## Sources

- [Material states](https://m3.material.io/foundations/interaction/states/overview)
- [Material motion physics](https://m3.material.io/styles/motion/overview): spatial springs for position/size; effects springs without overshoot for color/opacity.
- [Material top app bars](https://m3.material.io/components/top-app-bar/specs)

Official pages were read through agent-reach's Jina backend. The motion page returned its detailed guidance; the states/top-app-bar pages returned limited shell content. Local Material references and the repository's rules supply the remaining implementation constraints.

## Verified checks

- Workspace lint/typecheck passed.
- **529 tests passed:** 411 mobile interaction/unit/calendar/reader/polish/plugin cases, plus 118 Material color/contrast cases; zero failures.
- Production web export and Android/iOS JavaScript exports passed (`--no-bytecode`). These are not APK/device or Hermes-bytecode validation.
- An isolated **Expo Android prebuild** passed and generated the pointer-dispatch assignment before `super.onCreate()` in a real `MainApplication.kt`. Kotlin and Java plugin tests cover idempotency. Android SDK/Gradle toolchains are not installed here, so this native configuration has not been compiled into an APK in this round.
- Whole-app light/dark × Standard/Expressive regression passed: **452 captures, 72 interaction groups, 3,560 state-layer geometry checks**, zero uncaught page errors. Includes compact, wide, constrained and reduced-motion screens, auth, menus, dialogs, fields, settings and reader controls. Results: `/tmp/opencode/ordo-polish-final-regression-{light,dark}/results.json`.
- Initial focused matrix passed **64 captures, 8 interaction groups and 616 state-layer checks**, including avatar/menu/group edges, selection fades, press expansion in both modes, fixed Delete edge, Select all/Deselect all, Space, reduced motion and compact/wide/constrained layouts. Final expanded coverage adds nested chip ownership and scoped folder/tag selection.

### Before/after browser measurements

The same 1,000-bookmark fixture, viewport and 20 selection toggles ran against the prior reader export and the new export. Only visible cells are mounted; this is not 1,000 simultaneous mounted rows.

| Measurement | Before | After |
| --- | ---: | ---: |
| Delete right-edge drift during toolbar change | 280px | **0px** |
| First run: median click → `aria-checked` update | 32.7ms | 13.1ms |
| First run: p95 click → `aria-checked` update | 52.6ms | 20.0ms |
| Repeat: median click → `aria-checked` update | 13.2ms | 13.2ms |
| Repeat: p95 click → `aria-checked` update | 16.6ms | 17.3ms |
| Repeat: p95 frame interval | 16.7ms | 16.8ms |
| Repeat: max frame interval | 16.8ms | 16.8ms |
| Repeat: Long Tasks | 0 | 0 |

The first run overlapped more build-box work (before: eight Long Tasks, maximum 67ms; after: zero). The repeat demonstrates **no reliable web latency improvement claim** under light load; the measured fixed anchor is consistent. The subscription refactor removes the known FlatList refresh path but requires native timing verification. This is not an FPS, zero-hitch or zero-lag guarantee.

Reproduce with `ORDO_UI_SELECTION_PERF=1` and the standard `test:ui` environment. Repeat results: `/tmp/opencode/ordo-hover-perf-{before,after}/results.json`. Initial measurements: `/tmp/opencode/ordo-selection-{before,after}.log`.

## Verification limitations

Browser fixtures are not live backend flows. Click-to-ARIA timing measures web state acknowledgement, not native touch latency or completed visual animation. Native opacity fades use the native driver; slot sizes use the existing Reanimated spatial scheme. `adb devices -l` reports **0 attached devices**, so Android pointer hover, real safe-area/keyboard behavior and third-party page rendering still require on-device verification. JavaScript export is not APK/iOS device validation. The screenshot's website-owned top spacing must not be “fixed” by globally stripping CSS from arbitrary pages.
