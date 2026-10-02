/** Material switch: 52×32 track, 16/24dp handle, selected checkmark. */
import React, { useEffect } from "react";
import { StyleSheet } from "react-native";
import Animated, { interpolateColor, useAnimatedStyle, useSharedValue, withSpring, withTiming } from "react-native-reanimated";
import { MaterialIcon } from "./MaterialIcon";
import { PressableScale } from "./PressableScale";
import { useTheme } from "../../theme/ThemeProvider";
import { useMaterialMotion } from "../../theme/material-motion";
import { haptics } from "../../lib/haptics";
export interface ToggleProps { value: boolean; onValueChange: (value: boolean) => void; disabled?: boolean; accessibilityLabel?: string }
export function Toggle({ value, onValueChange, disabled, accessibilityLabel }: ToggleProps) {
  const { palette } = useTheme();
  const motion = useMaterialMotion();
  const position = useSharedValue(value ? 1 : 0);
  const effect = useSharedValue(value ? 1 : 0);
  useEffect(() => {
    position.value = motion.reducedMotion ? +value : withSpring(+value, motion.fast);
    effect.value = withTiming(+value, { duration: motion.reducedMotion ? 0 : 150 });
  }, [value, motion.fast, motion.reducedMotion, position, effect]);
  const track = useAnimatedStyle(() => ({
    backgroundColor: interpolateColor(effect.value, [0, 1], [palette.surfaceContainerHighest, palette.primary]),
    borderColor: interpolateColor(effect.value, [0, 1], [palette.outline, palette.primary]),
  }));
  const handle = useAnimatedStyle(() => ({
    left: 6 + position.value * 16, width: 16 + effect.value * 8, height: 16 + effect.value * 8,
    backgroundColor: interpolateColor(effect.value, [0, 1], [palette.outline, palette.onPrimary]),
  }));
  return <PressableScale accessibilityRole="switch" accessibilityLabel={accessibilityLabel}
    accessibilityState={{ checked: value, disabled: !!disabled }} disabled={disabled}
    style={styles.target} onPress={() => { haptics.selection(); onValueChange(!value); }}>
    <Animated.View pointerEvents="none" style={[styles.track, { opacity: disabled ? 0.38 : 1 }, track]}>
      <Animated.View style={[styles.handle, handle]}>
        {value ? <MaterialIcon name="checkmark" size={16} color={palette.onPrimaryContainer} /> : null}
      </Animated.View>
    </Animated.View>
  </PressableScale>;
}
const styles = StyleSheet.create({
  target: { width: 56, minHeight: 48, alignItems: "center", justifyContent: "center", borderRadius: 28 },
  track: { width: 52, height: 32, borderRadius: 16, borderWidth: 2, justifyContent: "center" },
  handle: { position: "absolute", borderRadius: 12, alignItems: "center", justifyContent: "center" },
});
