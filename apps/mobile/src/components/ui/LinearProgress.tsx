/** Material processing progress: 4dp rounded segments, track gap and stop mark. */
import React, { useEffect, useState } from "react";
import { View, type StyleProp, type ViewStyle } from "react-native";
import Animated, { cancelAnimation, Easing, ReduceMotion, useAnimatedStyle, useSharedValue, withRepeat, withTiming } from "react-native-reanimated";
import { useTheme } from "../../theme/ThemeProvider";
import { useMaterialMotion } from "../../theme/material-motion";
import { progressFraction } from "../../lib/progress-fraction";

export function LinearProgress({ value, label, style }: { value?: number; label: string; style?: StyleProp<ViewStyle> }) {
  const { palette } = useTheme();
  const { reducedMotion } = useMaterialMotion();
  const [width, setWidth] = useState(0);
  const phase = useSharedValue(0);
  const progress = value == null ? null : progressFraction(value);
  useEffect(() => {
    cancelAnimation(phase); phase.value = 0;
    if (progress == null && !reducedMotion) phase.value = withRepeat(withTiming(1, { duration: 1500, easing: Easing.linear, reduceMotion: ReduceMotion.Never }), -1, false, undefined, ReduceMotion.Never);
    return () => cancelAnimation(phase);
  }, [phase, progress == null, reducedMotion]);
  const moving = useAnimatedStyle(() => ({ transform: [{ translateX: reducedMotion ? width * 0.3 : phase.value * width * 1.4 - width * 0.4 }] }));
  return <View testID="material-linear-progress" accessibilityRole="progressbar" accessibilityLabel={label}
    accessibilityValue={progress == null ? undefined : { min: 0, max: 100, now: Math.round(progress * 100) }}
    aria-valuemin={progress == null ? undefined : 0} aria-valuemax={progress == null ? undefined : 100}
    aria-valuenow={progress == null ? undefined : Math.round(progress * 100)}
    onLayout={(event) => setWidth(event.nativeEvent.layout.width)} style={[{ height: 4, width: "100%", borderRadius: 2, overflow: "hidden" }, style]}>
    {progress == null ? <>
      <View style={{ position: "absolute", inset: 0, borderRadius: 2, backgroundColor: palette.secondaryContainer }} />
      <Animated.View style={[{ width: "40%", height: 4, borderRadius: 2, backgroundColor: palette.primary }, moving]} />
    </> : <>
      {progress > 0 ? <View style={{ position: "absolute", left: 0, width: `${progress * 100}%`, height: 4, borderRadius: 2, backgroundColor: palette.primary }} /> : null}
      {progress < 1 ? <View style={{ position: "absolute", left: `${progress * 100}%`, marginLeft: progress > 0 ? 4 : 0, right: 0, height: 4, borderRadius: 2, backgroundColor: palette.secondaryContainer }} /> : null}
      {progress < 1 ? <View style={{ position: "absolute", right: 0, width: 4, height: 4, borderRadius: 2, backgroundColor: palette.primary }} /> : null}
    </>}
  </View>;
}
