/** Material 3: rounded 4dp segments, 4dp track gaps and a terminal stop mark. */
import React, { useEffect, useState } from "react";
import { View, type StyleProp, type ViewStyle } from "react-native";
import Animated, {
  cancelAnimation, Easing, ReduceMotion, useAnimatedStyle, useSharedValue,
  withRepeat, withTiming, type SharedValue,
} from "react-native-reanimated";
import { useTheme } from "../../theme/ThemeProvider";
import { useMaterialMotion } from "../../theme/material-motion";
import { progressFraction } from "../../lib/progress-fraction";
import { linearIndeterminateSegments } from "../../lib/material-progress";

const HEIGHT = 4;
const GAP = 4;
const segmentStyle = { position: "absolute", height: HEIGHT, borderRadius: HEIGHT / 2 } as const;

export function LinearProgress({ value, animatedValue, label, style }: {
  value?: number;
  /** Reader scroll progress stays on the UI thread rather than rerendering. */
  animatedValue?: SharedValue<number>;
  label: string;
  style?: StyleProp<ViewStyle>;
}) {
  const { palette } = useTheme();
  const { reducedMotion } = useMaterialMotion();
  const [width, setWidth] = useState(0);
  const phase = useSharedValue(0);
  const fill = useSharedValue(0);
  const progress = value == null ? null : progressFraction(value);
  const indeterminate = progress == null && !animatedValue;

  useEffect(() => {
    cancelAnimation(phase);
    phase.value = 0;
    if (indeterminate && !reducedMotion) {
      phase.value = withRepeat(withTiming(1, { duration: 1800, easing: Easing.linear, reduceMotion: ReduceMotion.Never }), -1, false, undefined, ReduceMotion.Never);
    }
    return () => cancelAnimation(phase);
  }, [phase, indeterminate, reducedMotion]);

  useEffect(() => {
    // Don't spring a percentage: overshooting suggests bytes that aren't there.
    fill.value = reducedMotion || animatedValue ? (progress ?? 0) : withTiming(progress ?? 0, {
      duration: 200, easing: Easing.bezier(0.2, 0, 0, 1),
    });
    return () => cancelAnimation(fill);
  }, [fill, progress, reducedMotion, animatedValue]);

  const geometry = () => {
    "worklet";
    if (!indeterminate) {
      const end = Math.max(0, Math.min(1, animatedValue?.value ?? fill.value)) * width;
      return [{ start: 0, end }, { start: 0, end: 0 }];
    }
    if (reducedMotion) return [{ start: width * 0.3, end: width * 0.7 }, { start: 0, end: 0 }];
    return linearIndeterminateSegments(phase.value).map(({ start, end }) => ({ start: start * width, end: end * width }));
  };
  const leading = useAnimatedStyle(() => {
    const segment = geometry()[0];
    return { left: segment.start, width: Math.max(0, segment.end - segment.start) };
  });
  const trailing = useAnimatedStyle(() => {
    const segment = geometry()[1];
    return { left: segment.start, width: Math.max(0, segment.end - segment.start) };
  });
  const before = useAnimatedStyle(() => {
    const [first, second] = geometry();
    const end = second.end > second.start ? second.start : first.start;
    return { left: 0, width: Math.max(0, end - GAP) };
  });
  const between = useAnimatedStyle(() => {
    const [first, second] = geometry();
    const visible = second.end > second.start;
    return { left: second.end + GAP, width: visible ? Math.max(0, first.start - second.end - GAP * 2) : 0 };
  });
  const after = useAnimatedStyle(() => {
    const first = geometry()[0];
    const gap = first.end > first.start ? GAP : 0;
    return { left: first.end + gap, width: Math.max(0, width - first.end - gap) };
  });
  return (
    <View testID="material-linear-progress" accessibilityRole="progressbar" accessibilityLabel={label}
      accessibilityValue={progress == null ? undefined : { min: 0, max: 100, now: Math.round(progress * 100) }}
      aria-valuemin={progress == null ? undefined : 0} aria-valuemax={progress == null ? undefined : 100}
      aria-valuenow={progress == null ? undefined : Math.round(progress * 100)}
      onLayout={(event) => setWidth(event.nativeEvent.layout.width)}
      style={[{ height: HEIGHT, width: "100%", borderRadius: HEIGHT / 2, overflow: "hidden" }, style]}>
      <Animated.View style={[segmentStyle, { backgroundColor: palette.secondaryContainer }, before]} />
      <Animated.View style={[segmentStyle, { backgroundColor: palette.secondaryContainer }, between]} />
      <Animated.View style={[segmentStyle, { backgroundColor: palette.secondaryContainer }, after]} />
      <Animated.View style={[segmentStyle, { backgroundColor: palette.primary }, leading]} />
      <Animated.View style={[segmentStyle, { backgroundColor: palette.primary }, trailing]} />
      {!indeterminate && progress !== 1 ? <View style={[segmentStyle, { right: 0, width: HEIGHT, backgroundColor: palette.primary }]} /> : null}
    </View>
  );
}
