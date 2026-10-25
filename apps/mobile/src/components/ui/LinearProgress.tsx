/** Material 3 straight/wavy progress, shared by downloads and content progress. */
import React, { useCallback, useEffect, useState } from "react";
import { View, type StyleProp, type ViewStyle } from "react-native";
import Animated, {
  cancelAnimation, Easing, ReduceMotion, useAnimatedProps, useSharedValue,
  withRepeat, withTiming, type SharedValue,
} from "react-native-reanimated";
import Svg, { Circle, Path } from "react-native-svg";
import { useTheme } from "../../theme/ThemeProvider";
import { useMaterialMotion } from "../../theme/material-motion";
import { progressFraction } from "../../lib/progress-fraction";
import { linearIndeterminateSegments, linearTrackSegments, straightProgressPath, wavyProgressPath } from "../../lib/material-progress";
import { useAnimationActivityEffect } from "../../hooks/use-animation-activity";

const HEIGHT = 4;
const GAP = 4;
const AnimatedPath = Animated.createAnimatedComponent(Path);
const AnimatedCircle = Animated.createAnimatedComponent(Circle);

/** Module-scope so the animated-prop updaters below capture stable values:
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

export function LinearProgress({ value, animatedValue, label, style, wavy: wavyOverride }: {
  value?: number;
  /** Reader scroll progress stays on the UI thread rather than rerendering. */
  animatedValue?: SharedValue<number>;
  label: string;
  style?: StyleProp<ViewStyle>;
  /** Defaults to the design mode. Reading position can explicitly stay straight. */
  wavy?: boolean;
}) {
  const { palette, expressive } = useTheme();
  const wavy = wavyOverride ?? expressive;
  const { reducedMotion } = useMaterialMotion();
  const [width, setWidth] = useState(0);
  const phase = useSharedValue(0);
  const fill = useSharedValue(0);
  const wave = useSharedValue(0);
  const amplitude = useSharedValue(0);
  const progress = value == null ? null : progressFraction(value);
  const indeterminate = progress == null && !animatedValue;
  const complete = progress === 1;

  useAnimationActivityEffect(useCallback((active: boolean) => {
    wave.value = 0;
    if (wavy && active && !reducedMotion && !complete) {
      wave.value = withRepeat(withTiming(1, { duration: 1000, easing: Easing.linear, reduceMotion: ReduceMotion.Never }), -1, false, undefined, ReduceMotion.Never);
    }
    return () => cancelAnimation(wave);
  }, [wave, wavy, reducedMotion, complete]));

  const waveAmplitude = indeterminate || (progress != null && progress > 0.1 && progress < 0.95) ? 3 : 0;
  useEffect(() => {
    amplitude.value = reducedMotion ? waveAmplitude : withTiming(waveAmplitude, {
      duration: 500, easing: Easing.bezier(0.2, 0, 0, 1),
    });
    return () => cancelAnimation(amplitude);
  }, [amplitude, waveAmplitude, reducedMotion]);

  useAnimationActivityEffect(useCallback((active: boolean) => {
    cancelAnimation(phase);
    phase.value = 0;
    if (indeterminate && active && !reducedMotion) {
      phase.value = withRepeat(withTiming(1, { duration: 1800, easing: Easing.linear, reduceMotion: ReduceMotion.Never }), -1, false, undefined, ReduceMotion.Never);
    }
    return () => cancelAnimation(phase);
  }, [phase, indeterminate, reducedMotion]));

  useEffect(() => {
    // Don't spring a percentage: overshooting suggests bytes that aren't there.
    fill.value = reducedMotion || animatedValue ? (progress ?? 0) : withTiming(progress ?? 0, {
      duration: 200, easing: Easing.bezier(0.2, 0, 0, 1),
    });
    return () => cancelAnimation(fill);
  }, [fill, progress, reducedMotion, animatedValue]);

  // SVG paths keep Yoga geometry fixed and preserve circular caps at every
  // length. Scaling a rounded View horizontally also squashes its end caps.
  const track = useAnimatedProps(() => {
    const segments = progressGeometry(phase, fill, animatedValue, width, indeterminate, reducedMotion);
    return { d: linearTrackSegments(segments, width, GAP)
      .map(({ start, end }) => straightProgressPath(start, end, wavy ? 5 : 2)).join(" ") };
  });
  const stop = useAnimatedProps(() => {
    const segment = progressGeometry(phase, fill, animatedValue, width, indeterminate, reducedMotion)[0];
    return { opacity: !indeterminate && segment.end < width - HEIGHT ? 1 : 0 };
  });
  const firstWave = useAnimatedProps(() => {
    const segment = progressGeometry(phase, fill, animatedValue, width, indeterminate, reducedMotion)[0];
    return { d: wavy ? wavyProgressPath(segment.start, segment.end, width, wave.value, amplitude.value, indeterminate ? 20 : 40)
      : straightProgressPath(segment.start, segment.end) };
  });
  const secondWave = useAnimatedProps(() => {
    const segment = progressGeometry(phase, fill, animatedValue, width, indeterminate, reducedMotion)[1];
    return { d: wavy ? wavyProgressPath(segment.start, segment.end, width, wave.value, amplitude.value, indeterminate ? 20 : 40)
      : straightProgressPath(segment.start, segment.end) };
  });
  return (
    <View testID={wavy ? "material-wavy-progress" : "material-linear-progress"} accessibilityRole="progressbar" accessibilityLabel={label}
      accessibilityValue={progress == null ? undefined : { min: 0, max: 100, now: Math.round(progress * 100) }}
      aria-valuemin={progress == null ? undefined : 0} aria-valuemax={progress == null ? undefined : 100}
      aria-valuenow={progress == null ? undefined : Math.round(progress * 100)}
      onLayout={(event) => setWidth(event.nativeEvent.layout.width)}
      style={[{ height: wavy ? 10 : HEIGHT, width: "100%", overflow: "hidden" }, style]}>
      <Svg width={width} height={wavy ? 10 : HEIGHT} style={{ position: "absolute" }}>
        <AnimatedPath animatedProps={track} stroke={palette.secondaryContainer} strokeWidth={HEIGHT} strokeLinecap="round" fill="none" />
        <AnimatedPath animatedProps={firstWave} stroke={palette.primary} strokeWidth={HEIGHT} strokeLinecap="round" fill="none" />
        <AnimatedPath animatedProps={secondWave} stroke={palette.primary} strokeWidth={HEIGHT} strokeLinecap="round" fill="none" />
        {!indeterminate ? <AnimatedCircle animatedProps={stop} cx={Math.max(0, width - HEIGHT / 2)} cy={wavy ? 5 : HEIGHT / 2}
          r={HEIGHT / 2} fill={palette.primary} /> : null}
      </Svg>
    </View>
  );
}
