/** Material 3 straight/wavy progress, shared by downloads and content progress. */
import React, { useEffect, useState } from "react";
import { View, type StyleProp, type ViewStyle } from "react-native";
import Animated, {
  cancelAnimation, Easing, ReduceMotion, useAnimatedProps, useAnimatedStyle, useSharedValue,
  withRepeat, withTiming, type SharedValue,
} from "react-native-reanimated";
import Svg, { Path } from "react-native-svg";
import { useTheme } from "../../theme/ThemeProvider";
import { useMaterialMotion } from "../../theme/material-motion";
import { progressFraction } from "../../lib/progress-fraction";
import { linearIndeterminateSegments, wavyProgressPath } from "../../lib/material-progress";
import { useAnimationActivity } from "../../hooks/use-animation-activity";

const HEIGHT = 4;
const GAP = 4;
const segmentStyle = { position: "absolute", height: HEIGHT, borderRadius: HEIGHT / 2 } as const;
const AnimatedPath = Animated.createAnimatedComponent(Path);

/** Keep Yoga geometry fixed: progress must not relayout the reader header (or
 * its article sibling) on every scroll/animation frame. */
function segmentTransform(start: number, end: number, width: number) {
  "worklet";
  const length = Math.max(0, end - start);
  return { transform: [{ translateX: start + length / 2 - width / 2 }, { scaleX: width > 0 ? length / width : 0 }] };
}

/** Module-scope so the animated-style updaters below capture stable values:
 * a worklet rebuilt in render scope would re-register on the UI thread on
 * every progress re-render (e.g. every download tick). */
function progressGeometry(phase: SharedValue<number>, fill: SharedValue<number>, animatedValue: SharedValue<number> | undefined, width: number, indeterminate: boolean, reducedMotion: boolean): Array<{ start: number; end: number }> {
  "worklet";
  if (!indeterminate) {
    const end = Math.max(0, Math.min(1, animatedValue?.value ?? fill.value)) * width;
    return [{ start: 0, end }, { start: 0, end: 0 }];
  }
  if (reducedMotion) return [{ start: width * 0.3, end: width * 0.7 }, { start: 0, end: 0 }];
  return linearIndeterminateSegments(phase.value).map(({ start, end }) => ({ start: start * width, end: end * width }));
}

export function LinearProgress({ value, animatedValue, label, style, wavy = false }: {
  value?: number;
  /** Reader scroll progress stays on the UI thread rather than rerendering. */
  animatedValue?: SharedValue<number>;
  label: string;
  style?: StyleProp<ViewStyle>;
  /** Downloads opt into the Expressive wave in either design mode. */
  wavy?: boolean;
}) {
  const { palette } = useTheme();
  const { reducedMotion } = useMaterialMotion();
  const active = useAnimationActivity();
  const [width, setWidth] = useState(0);
  const phase = useSharedValue(0);
  const fill = useSharedValue(0);
  const wave = useSharedValue(0);
  const amplitude = useSharedValue(0);
  const progress = value == null ? null : progressFraction(value);
  const indeterminate = progress == null && !animatedValue;
  const complete = progress === 1;

  useEffect(() => {
    wave.value = 0;
    if (wavy && active && !reducedMotion && !complete) {
      wave.value = withRepeat(withTiming(1, { duration: 1000, easing: Easing.linear, reduceMotion: ReduceMotion.Never }), -1, false, undefined, ReduceMotion.Never);
    }
    return () => cancelAnimation(wave);
  }, [wave, wavy, reducedMotion, active, complete]);

  const waveAmplitude = indeterminate || (progress != null && progress > 0.1 && progress < 0.95) ? 3 : 0;
  useEffect(() => {
    amplitude.value = reducedMotion ? waveAmplitude : withTiming(waveAmplitude, {
      duration: 500, easing: Easing.bezier(0.2, 0, 0, 1),
    });
    return () => cancelAnimation(amplitude);
  }, [amplitude, waveAmplitude, reducedMotion]);

  useEffect(() => {
    cancelAnimation(phase);
    phase.value = 0;
    if (indeterminate && active && !reducedMotion) {
      phase.value = withRepeat(withTiming(1, { duration: 1800, easing: Easing.linear, reduceMotion: ReduceMotion.Never }), -1, false, undefined, ReduceMotion.Never);
    }
    return () => cancelAnimation(phase);
  }, [phase, indeterminate, reducedMotion, active]);

  useEffect(() => {
    // Don't spring a percentage: overshooting suggests bytes that aren't there.
    fill.value = reducedMotion || animatedValue ? (progress ?? 0) : withTiming(progress ?? 0, {
      duration: 200, easing: Easing.bezier(0.2, 0, 0, 1),
    });
    return () => cancelAnimation(fill);
  }, [fill, progress, reducedMotion, animatedValue]);

  const leading = useAnimatedStyle(() => {
    const segment = progressGeometry(phase, fill, animatedValue, width, indeterminate, reducedMotion)[0];
    return segmentTransform(segment.start, segment.end, width);
  });
  const trailing = useAnimatedStyle(() => {
    const segment = progressGeometry(phase, fill, animatedValue, width, indeterminate, reducedMotion)[1];
    return segmentTransform(segment.start, segment.end, width);
  });
  const before = useAnimatedStyle(() => {
    const [first, second] = progressGeometry(phase, fill, animatedValue, width, indeterminate, reducedMotion);
    const end = second.end > second.start ? second.start : first.start;
    return segmentTransform(0, Math.max(0, end - GAP), width);
  });
  const between = useAnimatedStyle(() => {
    const [first, second] = progressGeometry(phase, fill, animatedValue, width, indeterminate, reducedMotion);
    const visible = second.end > second.start;
    return segmentTransform(second.end + GAP, visible ? Math.max(second.end + GAP, first.start - GAP) : second.end + GAP, width);
  });
  const after = useAnimatedStyle(() => {
    const first = progressGeometry(phase, fill, animatedValue, width, indeterminate, reducedMotion)[0];
    const gap = first.end > first.start ? GAP : 0;
    return segmentTransform(first.end + gap, width, width);
  });
  const firstWave = useAnimatedProps(() => {
    if (!wavy) return { d: "" };
    const segment = progressGeometry(phase, fill, animatedValue, width, indeterminate, reducedMotion)[0];
    return { d: wavyProgressPath(segment.start, segment.end, width, wave.value, amplitude.value, indeterminate ? 20 : 40) };
  });
  const secondWave = useAnimatedProps(() => {
    if (!wavy) return { d: "" };
    const segment = progressGeometry(phase, fill, animatedValue, width, indeterminate, reducedMotion)[1];
    return { d: wavyProgressPath(segment.start, segment.end, width, wave.value, amplitude.value, indeterminate ? 20 : 40) };
  });
  const fixedSegmentStyle = { ...segmentStyle, left: 0, width };
  const trackStyle = { ...fixedSegmentStyle, top: wavy ? 3 : 0 };
  return (
    <View testID={wavy ? "material-wavy-progress" : "material-linear-progress"} accessibilityRole="progressbar" accessibilityLabel={label}
      accessibilityValue={progress == null ? undefined : { min: 0, max: 100, now: Math.round(progress * 100) }}
      aria-valuemin={progress == null ? undefined : 0} aria-valuemax={progress == null ? undefined : 100}
      aria-valuenow={progress == null ? undefined : Math.round(progress * 100)}
      onLayout={(event) => setWidth(event.nativeEvent.layout.width)}
      style={[{ height: wavy ? 10 : HEIGHT, width: "100%", overflow: "hidden" }, style]}>
      <Animated.View style={[trackStyle, { backgroundColor: palette.secondaryContainer }, before]} />
      <Animated.View style={[trackStyle, { backgroundColor: palette.secondaryContainer }, between]} />
      <Animated.View style={[trackStyle, { backgroundColor: palette.secondaryContainer }, after]} />
      {wavy ? <Svg width={width} height={10} style={{ position: "absolute" }}>
        <AnimatedPath animatedProps={firstWave} stroke={palette.primary} strokeWidth={HEIGHT} strokeLinecap="round" fill="none" />
        <AnimatedPath animatedProps={secondWave} stroke={palette.primary} strokeWidth={HEIGHT} strokeLinecap="round" fill="none" />
      </Svg> : <>
        <Animated.View style={[fixedSegmentStyle, { backgroundColor: palette.primary }, leading]} />
        <Animated.View style={[fixedSegmentStyle, { backgroundColor: palette.primary }, trailing]} />
      </>}
      {!indeterminate && progress !== 1 ? <View style={[segmentStyle, { top: wavy ? 3 : 0, right: 0, width: HEIGHT, backgroundColor: palette.primary }]} /> : null}
    </View>
  );
}
