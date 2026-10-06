/** Material switch: 52×32 track, 16/24dp handle, selected checkmark. */
import React, { useEffect, useRef } from "react";
import { Platform, StyleSheet } from "react-native";
import Animated, { interpolateColor, useAnimatedStyle, useSharedValue, withSpring } from "react-native-reanimated";
import { MaterialIcon } from "./MaterialIcon";
import { PressableScale } from "./PressableScale";
import { useTheme } from "../../theme/ThemeProvider";
import { materialMotion, useMaterialMotion } from "../../theme/material-motion";
import { haptics } from "../../lib/haptics";
import { radius } from "../../theme/tokens";
import { stateLayerOpacity } from "../../theme/state-layer";
export interface ToggleProps { value: boolean; onValueChange: (value: boolean) => void; disabled?: boolean; accessibilityLabel?: string }
export function Toggle({ value, onValueChange, disabled, accessibilityLabel }: ToggleProps) {
  const { palette } = useTheme();
  const motion = useMaterialMotion();
  const position = useSharedValue(value ? 1 : 0);
  const effect = useSharedValue(value ? 1 : 0);
  const pressed = useSharedValue(0);
  const state = useSharedValue(0);
  const interaction = useRef({ pressed: false, focused: false, hovered: false });
  const updateHalo = () => {
    const active = stateLayerOpacity({ ...interaction.current, disabled }) > 0;
    state.value = motion.reducedMotion ? (active ? 1 : 0) : withSpring(active ? 1 : 0, materialMotion.effects.fast);
  };
  useEffect(() => {
    position.value = motion.reducedMotion ? +value : withSpring(+value, motion.fast);
    effect.value = motion.reducedMotion ? +value : withSpring(+value, materialMotion.effects.fast);
  }, [value, motion.fast, motion.reducedMotion, position, effect]);
  const track = useAnimatedStyle(() => ({
    backgroundColor: disabled ? value ? `${palette.onSurface}1f` : `${palette.surfaceContainerHighest}1f`
      : interpolateColor(effect.value, [0, 1], [palette.surfaceContainerHighest, palette.primary]),
    borderColor: disabled ? `${palette.onSurface}1f` : interpolateColor(effect.value, [0, 1], [palette.outline, palette.primary]),
  }));
  const handle = useAnimatedStyle(() => {
    const diameter = 16 + effect.value * 8 + pressed.value * (12 - effect.value * 8);
    return { left: 14 + position.value * 20 - diameter / 2, width: diameter, height: diameter,
      backgroundColor: disabled ? value ? palette.surface : `${palette.onSurface}61`
        : interpolateColor(effect.value, [0, 1], [palette.outline, palette.onPrimary]) };
  });
  const halo = useAnimatedStyle(() => ({ left: -6 + position.value * 20,
    backgroundColor: interpolateColor(state.value, [0, 1], [`${value ? palette.primary : palette.onSurface}00`, `${value ? palette.primary : palette.onSurface}14`]) }));
  const check = useAnimatedStyle(() => ({ opacity: effect.value }));
  return <PressableScale accessibilityRole="switch" accessibilityLabel={accessibilityLabel}
    accessibilityState={{ checked: value, disabled: !!disabled }} disabled={disabled}
    stateLayerColor="transparent"
    onPressIn={() => { pressed.value = motion.reducedMotion ? 1 : withSpring(1, motion.fast); interaction.current.pressed = true; updateHalo(); }}
    onPressOut={() => { pressed.value = motion.reducedMotion ? 0 : withSpring(0, motion.fast); interaction.current.pressed = false; updateHalo(); }}
    onHoverIn={() => { interaction.current.hovered = true; updateHalo(); }} onHoverOut={() => { interaction.current.hovered = false; updateHalo(); }}
    onFocus={event => { interaction.current.focused = Platform.OS !== "web" || !!(event.currentTarget as unknown as HTMLElement)?.matches?.(":focus-visible"); updateHalo(); }}
    onBlur={() => { pressed.value = 0; interaction.current.focused = false; interaction.current.pressed = false; updateHalo(); }}
    style={styles.target} onPress={() => { haptics.selection(); onValueChange(!value); }}>
    <Animated.View pointerEvents="none" style={[styles.track, track]}>
      <Animated.View style={[styles.halo, halo]} />
      <Animated.View testID="material-switch-handle" style={[styles.handle, handle]}>
        <Animated.View style={check}><MaterialIcon name="checkmark" size={16} color={disabled ? `${palette.onSurface}61` : palette.onPrimaryContainer} /></Animated.View>
      </Animated.View>
    </Animated.View>
  </PressableScale>;
}
const styles = StyleSheet.create({
  target: { width: 56, minHeight: 48, alignItems: "center", justifyContent: "center", borderRadius: 28 },
  track: { width: 52, height: 32, borderRadius: 16, borderWidth: 2, justifyContent: "center" },
  handle: { position: "absolute", borderRadius: radius.full, alignItems: "center", justifyContent: "center" },
  halo: { position: "absolute", top: -6, width: 40, height: 40, borderRadius: radius.full },
});
