# Material loading indicators

## Official guidance

Reviewed Google's Material 3 documentation and AndroidX implementations:

- [Loading indicator overview](https://m3.material.io/components/loading-indicator/overview): the filled, shape-morphing Expressive indicator replaces indeterminate circular progress for short waits, including pull-to-refresh. It is not for a process that changes from indeterminate to determinate.
- [Progress indicator overview](https://m3.material.io/components/progress-indicators/overview) and [specifications](https://m3.material.io/components/progress-indicators/specs): waves are an optional Expressive treatment on the active track; linear progress still reports a measurable process.
- AndroidX Material3 [LoadingIndicator.kt](https://github.com/androidx/androidx/blob/androidx-main/compose/material3/material3/src/commonMain/kotlin/androidx/compose/material3/LoadingIndicator.kt), [MaterialShapes.kt](https://github.com/androidx/androidx/blob/androidx-main/compose/material3/material3/src/commonMain/kotlin/androidx/compose/material3/MaterialShapes.kt), and [WavyProgressIndicator.kt](https://github.com/androidx/androidx/blob/androidx-main/compose/material3/material3/src/commonMain/kotlin/androidx/compose/material3/WavyProgressIndicator.kt).

Google provides Compose implementations, not a React Native component. Ordo uses the existing SVG/Reanimated stack to render the AndroidX polygon morphs and adapt its motion; no new runtime dependencies are required.

## Shared implementation

- `Spinner` retains the circular grow/shrink arc in standard mode. Expressive mode now renders filled SoftBurst → Cookie9 → Pentagon → Pill → Sunny → Cookie4 → Oval → SoftBurst morphs, replacing the previous wavy circular arc. Buttons, pending rows, lists, dialogs, and refresh HUDs inherit this through the shared primitive.
- Morphs use AndroidX Graphics Shapes' actual matched cubic control points, generated offline rather than approximating the shapes with radial sine waves. The generator and generated data retain Apache-2.0 attribution.
- Motion follows AndroidX's 650 ms morph interval, stiffness 200 / damping ratio .6 spring response, 90° stepped rotations, and 4666 ms global rotation. The sampled response settles at the end of each interval. Four sequence passes make the stepped rotation loop seamlessly. Compact spinner footprints remain appropriate to their existing controls; the refresh chip uses a 24dp indicator.
- `LinearProgress` has an explicit `wavy` option, enabled for both native APK and OTA downloads in either design mode as requested. Reading, extraction, and page progress remain unchanged. Downloads keep linear progress throughout startup and byte-count updates; a morphing loader never replaces their bar.
- Waves use 4dp strokes, 3dp amplitude, 40dp determinate / 20dp indeterminate wavelengths, one wavelength per second, a straight inactive track, 4dp track gaps, and the terminal stop mark. Cubic Hermite segments approximate the sine wave. Amplitude eases to zero at ≤10% and ≥95%, following AndroidX defaults.
- Reduced motion stops morphing, rotation, segment chasing, and wave travel. Determinate byte progress still updates. `spinning={false}` remains static. Existing progress semantics, refresh minimum duration, request guards, and overlay protections are preserved.

## Regenerating polygon data

Use Java 17+ and these development-only artifacts:

- Google's Maven repository: `androidx.graphics:graphics-shapes-android:1.0.1` (extract `classes.jar` from its AAR).
- Google's Maven repository: `androidx.collection:collection-jvm:1.4.2`.
- Maven Central: `org.jetbrains.kotlin:kotlin-stdlib:1.9.24`.

With those files in `/tmp/opencode`, run from the repository root:

```sh
java -cp /tmp/opencode/graphics-shapes-classes.jar:/tmp/opencode/kotlin-stdlib.jar:/tmp/opencode/collection.jar \
  apps/mobile/scripts/GenerateLoadingShapes.java \
  > apps/mobile/src/lib/material-loading-shapes.ts
```

## Verification

- Mobile TypeScript and ESLint checks passed; Expo production web export passed.
- Pure geometry checks passed for all seven matched cubic morphs, 10,000+ sampled frames, loop boundaries, invalid/negative animation clocks, and zero/narrow/full-width wave paths.
- Isolated rendered-component checks: 8 captures across light/dark, standard/Expressive, and 390/1280px layouts. Verified moving determinate waves, amplitude, 0/5/98/100% endpoint behavior, indeterminate progress, semantics, stationary previews, and live reduced-motion changes. No page errors.
- Fixture-backed integration matrix: 16 captures across both themes, modes, and layouts. Verified shared loading and refresh indicators, reduced motion, rejected short/cancelled/horizontal pulls, duplicate-refresh protection, completion and subsequent pulls, reader scroll progress, and keyboard Back. No page errors.
- Browser verification artifacts are under `/tmp/opencode/ordo-loading-visual` and `/tmp/opencode/ordo-loading-integration-verified`. Temporary preview routes and runners are not shipped or added to the removed test suite.
- Real-device native rendering, touch, and hardware Back were not verified; no device was attached.
