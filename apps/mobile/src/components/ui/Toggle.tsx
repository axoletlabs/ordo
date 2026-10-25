/** Plain Material switch: 52×32 track, 16/24dp thumb, 28dp while pressed. */
import React, { useEffect, useRef } from "react";
import { Platform, StyleSheet, View } from "react-native";
import Animated, { interpolateColor, useAnimatedStyle, useSharedValue, withSpring } from "react-native-reanimated";
import { PressableScale } from "./PressableScale";
import { useTheme } from "../../theme/ThemeProvider";
import { materialMotion, useMaterialMotion } from "../../theme/material-motion";
import { haptics } from "../../lib/haptics";
import { radius } from "../../theme/tokens";
import { stateLayerOpacity } from "../../theme/state-layer";

export interface ToggleProps {
  value: boolean;
  onValueChange: (value: boolean) => void;
  disabled?: boolean;
  accessibilityLabel?: string;
  accessibilityHint?: string;
  displayOnly?: boolean;
}

export function Toggle({ value, onValueChange, disabled = false, accessibilityLabel, accessibilityHint, displayOnly = false }: ToggleProps) {
  const { palette } = useTheme();
  const motion = useMaterialMotion();
  const position = useSharedValue(Number(value));
  const selection = useSharedValue(Number(value));
  const availability = useSharedValue(Number(!disabled));
  const pressed = useSharedValue(0);
  const state = useSharedValue(0);
  const interaction = useRef({ pressed: false, focused: false, hovered: false });
  const previousPosition = useRef({ value, spring: motion.fast, reducedMotion: motion.reducedMotion });
  const previousFeedback = useRef({ disabled, spring: motion.fast, reducedMotion: motion.reducedMotion });

  const updateHalo = () => {
    const fraction = stateLayerOpacity({ ...interaction.current, disabled });
    state.value = motion.reducedMotion ? fraction : withSpring(fraction, materialMotion.effects.fast);
  };
  const setPressed = (down: boolean) => {
    interaction.current.pressed = down && !disabled;
    pressed.value = motion.reducedMotion ? Number(interaction.current.pressed)
      : withSpring(Number(interaction.current.pressed), motion.fast);
    updateHalo();
  };

  useEffect(() => {
    if (previousPosition.current.value === value && previousPosition.current.spring === motion.fast && previousPosition.current.reducedMotion === motion.reducedMotion) return;
    previousPosition.current = { value, spring: motion.fast, reducedMotion: motion.reducedMotion };
    position.value = motion.reducedMotion ? Number(value) : withSpring(Number(value), motion.fast);
    selection.value = motion.reducedMotion ? Number(value) : withSpring(Number(value), materialMotion.effects.fast);
  }, [value, motion.fast, motion.reducedMotion, position, selection]);

  useEffect(() => {
    if (previousFeedback.current.disabled === disabled && previousFeedback.current.spring === motion.fast && previousFeedback.current.reducedMotion === motion.reducedMotion) return;
    previousFeedback.current = { disabled, spring: motion.fast, reducedMotion: motion.reducedMotion };
    if (disabled) interaction.current = { pressed: false, focused: false, hovered: false };
    const fraction = stateLayerOpacity({ ...interaction.current, disabled });
    availability.value = motion.reducedMotion ? Number(!disabled) : withSpring(Number(!disabled), materialMotion.effects.fast);
    state.value = motion.reducedMotion ? fraction : withSpring(fraction, materialMotion.effects.fast);
    pressed.value = motion.reducedMotion ? Number(interaction.current.pressed) : withSpring(Number(interaction.current.pressed), motion.fast);
  }, [disabled, motion.reducedMotion, motion.fast, availability, pressed, state]);

  const track = useAnimatedStyle(() => ({
    backgroundColor: interpolateColor(availability.value, [0, 1], [
      interpolateColor(selection.value, [0, 1], [`${palette.surfaceContainerHighest}1f`, `${palette.onSurface}1f`]),
      interpolateColor(selection.value, [0, 1], [palette.surfaceContainerHighest, palette.primary]),
    ]),
    borderColor: interpolateColor(availability.value, [0, 1], [
      `${palette.onSurface}1f`, interpolateColor(selection.value, [0, 1], [palette.outline, palette.primary]),
    ]),
  }));
  const handle = useAnimatedStyle(() => {
    // Size and travel share the spatial spring. Clamp its overshoot so the
    // thumb stays inside the track, including rapid reversals while pressed.
    const progress = Math.max(0, Math.min(1, position.value));
    const down = Math.max(0, Math.min(1, pressed.value));
    const diameter = 16 + progress * 8 + down * (12 - progress * 8);
    return {
      left: 16 + progress * 20 - diameter / 2,
      top: (32 - diameter) / 2,
      width: diameter,
      height: diameter,
      backgroundColor: interpolateColor(availability.value, [0, 1], [
        interpolateColor(selection.value, [0, 1], [`${palette.onSurface}61`, palette.surface]),
        interpolateColor(down, [0, 1], [
          interpolateColor(selection.value, [0, 1], [palette.outline, palette.onPrimary]),
          interpolateColor(selection.value, [0, 1], [palette.onSurfaceVariant, palette.primaryContainer]),
        ]),
      ]),
    };
  });
  const halo = useAnimatedStyle(() => ({
    left: -4 + Math.max(0, Math.min(1, position.value)) * 20,
    backgroundColor: interpolateColor(disabled ? 0 : state.value, [0, 1], [
      interpolateColor(selection.value, [0, 1], [`${palette.onSurface}00`, `${palette.primary}00`]),
      interpolateColor(selection.value, [0, 1], [palette.onSurface, palette.primary]),
    ]),
  }));

  const visual = <View pointerEvents="none" style={styles.visual}>
    <Animated.View testID="material-switch-track" style={[styles.track, track]} />
    <Animated.View style={[styles.halo, halo]} />
    <Animated.View testID="material-switch-handle" style={[styles.handle, handle]} />
  </View>;
  // A menu row owns its focus, semantics and press. Reuse the same switch
  // paint without nesting another interactive control inside that row.
  if (displayOnly) return <View pointerEvents="none" aria-hidden accessibilityElementsHidden
    importantForAccessibility="no-hide-descendants" style={styles.visual}>{visual}</View>;
  return <PressableScale accessibilityRole="switch" accessibilityLabel={accessibilityLabel} accessibilityHint={accessibilityHint}
    accessibilityState={{ checked: value, disabled }} disabled={disabled}
    stateLayerColor="transparent"
    onPressIn={() => setPressed(true)} onPressOut={() => setPressed(false)}
    onHoverIn={() => { interaction.current.hovered = true; updateHalo(); }}
    onHoverOut={() => { interaction.current.hovered = false; updateHalo(); }}
    onFocus={event => { interaction.current.focused = Platform.OS !== "web" || !!(event.currentTarget as unknown as HTMLElement)?.matches?.(":focus-visible"); updateHalo(); }}
    onBlur={() => { interaction.current.focused = false; setPressed(false); }}
    style={styles.target} onPress={() => { if (!disabled) { haptics.selection(); onValueChange(!value); } }}>
    {visual}
  </PressableScale>;
}
const styles = StyleSheet.create({
  visual: { width: 52, height: 32 },
  target: { width: 56, minHeight: 48, alignItems: "center", justifyContent: "center", borderRadius: radius.full },
  track: { position: "absolute", top: 0, right: 0, bottom: 0, left: 0, borderRadius: radius.full, borderWidth: 2 },
  handle: { position: "absolute", borderRadius: radius.full },
  halo: { position: "absolute", top: -4, width: 40, height: 40, borderRadius: radius.full },
});
