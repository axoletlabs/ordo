/**
 * Animated toggle switch faithful to ordo: coral track when on, surface knob.
 */
import React, { useCallback } from "react";
import { StyleSheet, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import Animated, {
  interpolateColor,
  useAnimatedStyle,
  useSharedValue,
  withSpring,
} from "react-native-reanimated";
import { PressableScale } from "./PressableScale";
import { useTheme } from "../../theme/ThemeProvider";
import { haptics } from "../../lib/haptics";
import { springs } from "../../theme/tokens";

const TRACK_W = 52;
const TRACK_H = 30;
const KNOB = 22;
const PADDING = (TRACK_H - KNOB) / 2;
const TRAVEL = TRACK_W - KNOB - PADDING * 2;

export interface ToggleProps {
  value: boolean;
  onValueChange: (v: boolean) => void;
  disabled?: boolean;
}

export function Toggle({ value, onValueChange, disabled }: ToggleProps) {
  const { palette } = useTheme();
  const pressed = useSharedValue(value ? 1 : 0);
  const offFill = useSharedValue(palette.surfaceSecondary);
  const onFill = useSharedValue(palette.accent);
  const offBorder = useSharedValue(palette.borderStrong);
  offFill.value = palette.surfaceSecondary;
  onFill.value = palette.accent;
  offBorder.value = palette.borderStrong;

  React.useEffect(() => {
    pressed.value = withSpring(value ? 1 : 0, springs.snappy);
  }, [value, pressed]);

  const onToggle = useCallback(() => {
    if (disabled) return;
    haptics.selection();
    onValueChange(!value);
  }, [disabled, onValueChange, value]);

  const trackStyle = useAnimatedStyle(() => ({
    backgroundColor: interpolateColor(pressed.value, [0, 1], [offFill.value, onFill.value]),
    borderColor: interpolateColor(pressed.value, [0, 1], [offBorder.value, onFill.value]),
  }));

  const knobStyle = useAnimatedStyle(() => ({
    transform: [{ translateX: pressed.value * TRAVEL }],
  }));

  return (
    <PressableScale
      scaleTo={0.92}
      dim={false}
      disabled={disabled}
      onPress={onToggle}
      accessibilityRole="switch"
      accessibilityState={{ checked: value, disabled: !!disabled }}
      hitSlop={6}
    >
      <Animated.View
        style={[styles.track, { opacity: disabled ? 0.55 : 1 }, trackStyle]}
        pointerEvents="none"
      >
        <View style={[styles.stateIcon, value ? styles.stateIconLeft : styles.stateIconRight]}>
          <Ionicons
            name={disabled ? "lock-closed" : value ? "checkmark" : "close"}
            size={12}
            color={value ? palette.onAccent : palette.textTertiary}
          />
        </View>
        <Animated.View style={[styles.knob, { backgroundColor: palette.onAccent }, knobStyle]} />
      </Animated.View>
    </PressableScale>
  );
}

const styles = StyleSheet.create({
  track: {
    width: TRACK_W,
    height: TRACK_H,
    borderRadius: TRACK_H / 2,
    borderWidth: 1,
    justifyContent: "center",
  },
  stateIcon: { position: "absolute", width: TRACK_W / 2, alignItems: "center" },
  stateIconLeft: { left: 0 },
  stateIconRight: { right: 0 },
  knob: {
    position: "absolute",
    left: PADDING,
    width: KNOB,
    height: KNOB,
    borderRadius: KNOB / 2,
    shadowColor: "#000",
    shadowOpacity: 0.2,
    shadowRadius: 2,
    shadowOffset: { width: 0, height: 1 },
    elevation: 2,
  },
});
