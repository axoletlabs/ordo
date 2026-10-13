# Update and loading verification

## Before → after

- The expanded native-updater suite against the original store: **14/17 → 17/17 passing**.
- Fixed regressions: download reservation before asynchronous file checks, dismissal actually cancelling the socket, and cache read failures blocking online discovery.
- Additional coverage: concurrent checks, app-variant/ABI selection, late results, cancel/retry cleanup, incomplete APKs, HTTP errors, offline cached downloads and installer-permission retry.
- OTA/manual-check and shared-operation tests: **18 passing**. A disabled or successful source cannot hide another source's failure. Overlapping operations coalesce and failures permit retry.
- Progress/refresh geometry: **6 passing**, including 5,400 circular animation samples, loop continuity, bounded quick-line segments and rejected horizontal/multitouch pulls.

## Built-app checks

- **8 screenshots**, covering 390×844 and 1280×800, dark/light themes and standard/Expressive modes.
- All four theme/design combinations verify arc animation, determinate progress semantics, refresh completion without looping, live reduced-motion changes, reader scroll progress and keyboard Back.
- Web export, Android JavaScript export, TypeScript and ESLint passed.
- The existing mobile test suite and Material color/contrast suite passed.

## Device verification still required

No Android device/emulator was connected. Native downloads and installer callbacks
are exercised with mocked platform services, not an actual APK installation.
The full Android bytecode export fails in the existing x86-64 Hermes compiler
on this ARM build box (exit 128); `expo export --platform android --no-bytecode`
passes. Check a signed release on a physical Android device before publishing,
including interrupted transfers, denied install permission, installer cancellation,
OTA restart and native pull-to-refresh. No production deployment was performed.
