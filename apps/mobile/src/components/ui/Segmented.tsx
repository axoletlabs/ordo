/** Baseline segmented buttons / Expressive connected toggle button group. */
import React, { useEffect } from "react";
import { StyleSheet, View } from "react-native";
import Animated, { useAnimatedStyle, useSharedValue, withSpring } from "react-native-reanimated";
import { PressableScale } from "./PressableScale";
import { Text } from "./Text";
import { MaterialIcon } from "./MaterialIcon";
import { useTheme } from "../../theme/ThemeProvider";
import { radius } from "../../theme/tokens";
import { haptics } from "../../lib/haptics";
import { materialMotion, useMaterialMotion } from "../../theme/material-motion";
const AnimatedText = Animated.createAnimatedComponent(Text);
function SegmentLabel({ label, foreground, selected }: { label: string; foreground: string; selected: boolean }) {
  const motion = useMaterialMotion();
  const tint = useSharedValue(foreground);
  const selection = useSharedValue(selected ? 1 : 0);
  useEffect(() => {
    tint.value = motion.reducedMotion ? foreground : withSpring(foreground, materialMotion.effects.fast);
    selection.value = motion.reducedMotion ? Number(selected) : withSpring(Number(selected), materialMotion.effects.fast);
  }, [foreground, selected, motion.reducedMotion, tint, selection]);
  const labelStyle = useAnimatedStyle(() => ({ color: tint.value }));
  const checkStyle = useAnimatedStyle(() => ({ opacity: selection.value }));
  return <>{selected ? <Animated.View testID="material-segment-check" style={[{ width: 18 }, checkStyle]}><MaterialIcon name="checkmark" size={18} color={foreground} /></Animated.View> : null}
    <AnimatedText variant="labelLarge" numberOfLines={1} style={[{ flexShrink: 1 }, labelStyle]}>{label}</AnimatedText></>;
}
export interface SegmentedProps<T extends string> {
  options: readonly { value: T; label: string; accessibilityLabel?: string }[]; value: T; onChange: (value: T) => void;
  accessibilityLabel?: string;
}
export function Segmented<T extends string>({ options, value, onChange, accessibilityLabel }: SegmentedProps<T>) {
  const { palette, expressive } = useTheme();
  return <View style={{ minHeight: 48, justifyContent: "center" }}><View accessibilityRole="radiogroup" accessibilityLabel={accessibilityLabel} style={[styles.group, {
    gap: expressive ? 2 : 0, backgroundColor: "transparent",
    borderRadius: radius.full,
  }]}>
    {options.map((option, index) => {
      const selected = value === option.value;
      const fg = selected ? expressive ? palette.onSecondary : palette.onSecondaryContainer : palette.onSurface;
      const outer = 20;
      const rest = selected ? outer : { topLeft: index === 0 ? outer : radius.sm, bottomLeft: index === 0 ? outer : radius.sm,
        topRight: index === options.length - 1 ? outer : radius.sm, bottomRight: index === options.length - 1 ? outer : radius.sm };
      const pressed = { topLeft: index === 0 ? outer : radius.xs, bottomLeft: index === 0 ? outer : radius.xs,
        topRight: index === options.length - 1 ? outer : radius.xs, bottomRight: index === options.length - 1 ? outer : radius.xs };
      return <PressableScale key={option.value} accessibilityRole="radio" accessibilityLabel={option.accessibilityLabel ?? option.label}
        accessibilityState={{ checked: selected }} onPress={() => { if (!selected) { haptics.selection(); onChange(option.value); } }}
        stateLayerColor={fg} hitSlop={{ top: 4, bottom: 4 }} shape={expressive ? { rest, pressed } : undefined}
        style={[styles.option, {
          height: 40,
          backgroundColor: selected ? expressive ? palette.secondary : palette.secondaryContainer : expressive ? palette.surfaceContainerHigh : "transparent",
          borderColor: palette.outline,
          borderTopWidth: expressive ? 0 : 1, borderBottomWidth: expressive ? 0 : 1,
          borderLeftWidth: expressive || index > 0 ? 0 : 1, borderRightWidth: expressive ? 0 : 1,
          ...(!expressive ? { borderTopLeftRadius: index === 0 ? outer : 0, borderBottomLeftRadius: index === 0 ? outer : 0,
            borderTopRightRadius: index === options.length - 1 ? outer : 0, borderBottomRightRadius: index === options.length - 1 ? outer : 0 } : {}),
        }]}>
          <SegmentLabel label={option.label} foreground={fg} selected={selected} />
      </PressableScale>;
    })}
  </View></View>;
}
const styles = StyleSheet.create({
  group: { flexDirection: "row", height: 40 },
  option: { flex: 1, minWidth: 48, height: 40, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8, paddingHorizontal: 12 },
});
