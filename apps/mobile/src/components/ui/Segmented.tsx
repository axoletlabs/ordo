/** Baseline segmented buttons / Expressive connected toggle button group. */
import React, { useEffect } from "react";
import { Platform, StyleSheet, View } from "react-native";
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
  orientation?: "horizontal" | "vertical";
}
export function Segmented<T extends string>({ options, value, onChange, accessibilityLabel, orientation = "horizontal" }: SegmentedProps<T>) {
  const { palette, expressive } = useTheme();
  const vertical = orientation === "vertical";
  const keyboardProps = Platform.OS === "web" ? {
    onKeyDown: (event: React.KeyboardEvent<HTMLDivElement>) => {
      const radios = Array.from(event.currentTarget.querySelectorAll<HTMLElement>('[role="radio"]'));
      const focused = radios.indexOf(event.target as HTMLElement);
      if (focused < 0) return;
      let next = focused;
      if (event.key === "ArrowRight" || event.key === "ArrowDown") next = (focused + 1) % options.length;
      else if (event.key === "ArrowLeft" || event.key === "ArrowUp") next = (focused + options.length - 1) % options.length;
      else if (event.key === "Home") next = 0;
      else if (event.key === "End") next = options.length - 1;
      else return;
      event.preventDefault();
      const option = options[next];
      if (option && option.value !== value) { haptics.selection(); onChange(option.value); }
      radios[next]?.focus();
    },
  } : {};
  return <View style={{ minHeight: 48, justifyContent: "center" }}><View {...keyboardProps} accessibilityRole="radiogroup" accessibilityLabel={accessibilityLabel} style={[styles.group, {
    gap: expressive ? 2 : 0, backgroundColor: "transparent",
    borderRadius: radius.full,
    ...(vertical ? { flexDirection: "column" as const, height: "auto" as const } : {}),
  }]}>
    {options.map((option, index) => {
      const selected = value === option.value;
      const fg = selected ? expressive ? palette.onSecondary : palette.onSecondaryContainer : palette.onSurface;
      const outer = vertical ? 24 : 20;
      const first = index === 0, last = index === options.length - 1;
      const ends = { topLeft: first, bottomLeft: vertical ? last : first, topRight: vertical ? first : last, bottomRight: last };
      const corners = (inner: number) => ({ topLeft: ends.topLeft ? outer : inner, bottomLeft: ends.bottomLeft ? outer : inner,
        topRight: ends.topRight ? outer : inner, bottomRight: ends.bottomRight ? outer : inner });
      const rest = selected ? outer : corners(radius.sm);
      const pressed = corners(radius.xs);
      const outline = corners(0);
      return <PressableScale key={option.value} accessibilityRole="radio" accessibilityLabel={option.accessibilityLabel ?? option.label}
        {...(Platform.OS === "web" ? { tabIndex: selected ? 0 : -1 } : {})}
        accessibilityState={{ checked: selected }} onPress={() => { if (!selected) { haptics.selection(); onChange(option.value); } }}
        stateLayerColor={fg} hitSlop={vertical ? undefined : { top: 4, bottom: 4 }} shape={expressive ? { rest, pressed } : undefined}
        style={[styles.option, {
          height: vertical ? 48 : 40,
          ...(vertical ? { flex: 0, flexShrink: 0, minHeight: 48, width: "100%" as const } : {}),
          backgroundColor: selected ? expressive ? palette.secondary : palette.secondaryContainer : expressive ? palette.surfaceContainerLow : "transparent",
          borderColor: palette.outline,
          borderTopWidth: expressive || vertical && !first ? 0 : 1, borderBottomWidth: expressive ? 0 : 1,
          borderLeftWidth: expressive || !vertical && !first ? 0 : 1, borderRightWidth: expressive ? 0 : 1,
          ...(!expressive ? { borderTopLeftRadius: outline.topLeft, borderBottomLeftRadius: outline.bottomLeft,
            borderTopRightRadius: outline.topRight, borderBottomRightRadius: outline.bottomRight } : {}),
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
