# Material audit fixes

The actionable audit findings are implemented in shared primitives rather than
screen-specific controls. This is not a native accessibility certification.

| Finding | Implementation |
| --- | --- |
| Field states and full-container focus | `Input` separates `disabled` from `readOnly`, paints pointer hover/focus/disabled states, and focuses from padding without intercepting accessories. Disabled trailing actions are also inert on web. Native editing/autofill workarounds remain. |
| Required/error feedback | Required labels and explanations, required/invalid/description semantics, alert errors, error icons beside existing actions, reserved support rows, and counters for validated name limits. OTP/PIN cells remain custom but gain disabled/error semantics. |
| Interaction targets | `PressableScale.visualStyle` separates smaller visuals from actual 48dp targets for buttons, icon buttons, segments, and interactive chips. Suggested-tag actions use `IconButton`; changelog pills have 48dp height. |
| Accessible patterns | Ordered dot buttons, clear and submit, using the same skip-fill algorithm and credential as gesture entry. |
| Time/date entry | Direct hour and arbitrary minute entry, OS/locale 12/24-hour preference, explicit wide-screen calendar/input switching, year entry, and calendar arrow/Home/End/Page keys. Compact layouts retain date text entry. |
| Selection semantics | Named color/icon radio groups, checked state, roving tab stops and grid arrow keys. Chips explicitly distinguish selectable checkboxes from actions. |
| Tooltip lifecycle | Trigger association, persistent hover/focus visibility, pointer transfer to the tooltip, and Escape dismissal. Native long-press presentation remains transient. |
| Processing progress | Shared 4dp `LinearProgress`, secondary-container track, gap/stop mark, truthful zero fill and native/web numeric values. Circular loading arcs grow and shrink. Reduced-motion preferences update live. |
| Offline blockers | Web focus containment and inert/hidden background siblings, restored after reconnect; native modal accessibility declarations retained. |

Lower-priority fixes include an outlined button variant, Standard small-button
24dp padding, Standard action-group expansion, Standard menu item spacing, and
snackbar timeout pausing plus Android's recommended accessible timeout.

## Verification

From `apps/mobile`:

```sh
pnpm run typecheck
pnpm run test:material
pnpm test
pnpm run test:accessibility
```

Build web with `expo export --platform web`, serve it with an SPA fallback, then:

```sh
ORDO_UI_URL=http://127.0.0.1:8239 ORDO_UI_ACCESSIBILITY_ONLY=1 pnpm run test:ui
```

The browser runner also accepts `PLAYWRIGHT_MODULE`, `PLAYWRIGHT_CHROMIUM` and
`ORDO_UI_OUTPUT`. Its targeted suite checks all four light/dark ×
Standard/Expressive combinations at 390×844 and 1280×800, 12/24-hour locales,
keyboard interaction, motion preference changes, and accurate processing values.
APIs are fixtures: this does not verify the backend.

Use `ORDO_UI_SKIP_SCREEN_MATRIX=1 pnpm run test:ui` for broader interaction
regressions without the base route screenshot catalogue; omit it for the full run.

## Native/release limitations

- `expo-localization` requires a new native build to read the actual OS clock
  toggle. Older APKs safely fall back to the locale through an optional module
  lookup; the runtime fingerprint remains managed by Expo config.
- TalkBack/VoiceOver, IME/autofill, physical touch hit-testing and large OS fonts
  still require on-device verification.
- Android JavaScript export passes. The attempted Hermes bytecode export exited
  with code 128; no passing APK/production bytecode build is claimed.
- Existing deliberate customization is retained: filled fields use `outline`
  per app policy; reader scroll/refresh indicators, status pills and OTP/pattern
  controls remain custom. Unused navigation bars, rails, sheets, sliders and
  other component categories were not introduced.
