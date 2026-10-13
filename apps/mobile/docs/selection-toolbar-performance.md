# Selection toolbar: Android frame pacing

## What was wrong with the previous verification

The browser regression suite measured overlap, right-edge drift, overshoot and
CSS layout writes. Zero animated layout writes is **not** proof of smooth
Android rendering. No connected Android device was available on the build box.
Do not report a measured native FPS improvement from these tests.

## Rendering-path findings

Versions inspected: React Native 0.86.3, Reanimated 4.5.1, Gesture Handler 2.32.0.

1. Reanimated's Android synchronous UI-props flag defaults to `false`. With
   these defaults, even transform/opacity updates enter
   `ReanimatedModuleProxy::commitUpdates`, clone shadow nodes and call
   `ShadowTree::commit`. Native UI-thread execution does not mean that Fabric
   commit/layout work has been bypassed.
2. The old toolbar animated one object containing eight coordinates. Reanimated
   decorates this into **eight separate scalar springs**, allocates a fresh
   coordinate object each frame, and invalidates every slot subscribed to it.
   Each slot's newly allocated transform array fails the style updater's shallow
   equality test, including unchanged or already-transparent slots.
3. The old transition also read `positions.value` on the JS thread. Native shared
   value reads can synchronize/block JS against the UI runtime. This adds work
   at exactly the transition boundary.
4. React Native's native Animated driver uses `PropsAnimatedNode.updateView` and
   `synchronouslyUpdateViewOnUIThread` instead. Native arithmetic nodes support
   multiplication, subtraction, interpolation and division, so the pill's exact
   inverse-scale geometry needs neither JS frames nor Reanimated style mappers.

These are verified implementation-path findings and known performance hazards,
not a device trace attributing every dropped frame to a single cause.

## Fix

- Resize, positioning and entrance/departure opacity use native Animated on
  Android/iOS; web uses its JS driver.
- Only changed coordinates animate: bookmark-only → mixed now starts **one
  width spring**, not eight object-member springs. Departing slots remain static
  under a common native opacity fade until the resize settles.
- The native arithmetic graph preserves the real hit bounds, fixed-size pill
  caps and undistorted icons/text. No per-frame listener is installed.
- The native fade completion gates growth; generations guard stale completions.
- Only the toolbar opts into Gesture Handler's platform-view hit testing. Other
  `PressableScale` consumers retain RN synthetic events and existing behavior.
- Material colors, shared spatial/effects spring tokens, Expressive shape morphs,
  reduced motion and 48dp targets remain shared. Shape/ink feedback still uses
  `PressableScale`; it is not driven by the resize graph.

Do **not** enable `ANDROID_SYNCHRONOUSLY_UPDATE_UI_PROPS` globally as a shortcut:
it changes hit testing for transformed RN Pressables and would require auditing
unrelated screens. No Reanimated feature flag or dependency upgrade is needed.

## Verification and remaining device check

`tests/selection-native-driver.test.mjs` loads RN's real arithmetic classes,
native graph promotion and driver guard. It checks native-driver selection,
single-coordinate resizing, exact geometry, no JS bridge listeners, fade
ordering, retargeting, stale callbacks and live reduced motion. Its bridge and
completion clock are simulated; it does not measure native frame rate or taps.

`tests/selection-action-motion.mjs` verifies painted motion, menu placement,
keyboard and interruption behavior in all eight web configurations. Android
bundling checks native module resolution, not device performance.

For an actual before/after comparison, use release APKs on the **same device**,
with the same theme, refresh-rate/battery settings and library. Reset Android's
frame counters, perform 20 bookmark-only ↔ mixed selection transitions, then
collect the counters:

```sh
adb shell dumpsys gfxinfo APP_PACKAGE reset
# Perform the 20 transitions on the phone.
adb shell dumpsys gfxinfo APP_PACKAGE framestats
```

Compare janky-frame percentage, p95/p99 duration and frame deadline misses, not
just mean FPS. Record a Perfetto trace if drops remain, examining
`Choreographer#doFrame`, native animated nodes, Fabric commits, React row updates
and render-thread/GPU work. Verify taps on Read, Move, More and Delete at their
painted bounds during/after resizing, including TalkBack and pointer input.

## Sources

- [Reanimated performance guide](https://docs.swmansion.com/react-native-reanimated/docs/guides/performance/)
- [Reanimated feature flags and touch caveats](https://docs.swmansion.com/react-native-reanimated/docs/guides/feature-flags/)
- [Known transformed-Pressable issue #10121](https://github.com/software-mansion/react-native-reanimated/issues/10121)
- Installed Reanimated: `src/animation/util.ts`, `src/hook/useAnimatedStyle.ts`,
  `src/mutables.ts`, `src/featureFlags/staticFlags.json`,
  `Common/cpp/reanimated/NativeModules/ReanimatedModuleProxy.cpp`.
- Installed React Native: `ReactAndroid/src/main/java/com/facebook/react/animated/PropsAnimatedNode.kt`
  and `DivisionAnimatedNode.kt`, `Libraries/Animated/nodes/*`.
