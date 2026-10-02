/** Baseline segmented buttons / Expressive connected toggle button group. */
import React from "react";
import { StyleSheet, View } from "react-native";
import { PressableScale } from "./PressableScale";
import { Text } from "./Text";
import { MaterialIcon } from "./MaterialIcon";
import { useTheme } from "../../theme/ThemeProvider";
import { radius } from "../../theme/tokens";
import { haptics } from "../../lib/haptics";
export interface SegmentedProps<T extends string> {
  options: readonly { value: T; label: string }[]; value: T; onChange: (value: T) => void;
}
export function Segmented<T extends string>({ options, value, onChange }: SegmentedProps<T>) {
  const { palette, expressive } = useTheme();
  return <View accessibilityRole="radiogroup" style={[styles.group, {
    gap: expressive ? 2 : 0, borderWidth: expressive ? 0 : 1, borderColor: palette.outline,
    borderRadius: radius.full, overflow: "hidden",
  }]}>
    {options.map((option, index) => {
      const selected = value === option.value;
      const fg = selected ? expressive ? palette.onSecondary : palette.onSecondaryContainer : palette.onSurface;
      return <PressableScale key={option.value} accessibilityRole="radio" accessibilityLabel={option.label}
        accessibilityState={{ checked: selected }} onPress={() => { if (!selected) { haptics.selection(); onChange(option.value); } }}
        stateLayerColor={fg} shape={expressive ? { rest: selected ? radius.md : 24, pressed: radius.sm } : undefined}
        style={[styles.option, {
          backgroundColor: selected ? expressive ? palette.secondary : palette.secondaryContainer : expressive ? palette.surfaceContainerHigh : "transparent",
          borderRightWidth: !expressive && index < options.length - 1 ? 1 : 0, borderColor: palette.outline,
        }]}>
        {selected && options.length <= 2 ? <MaterialIcon name="checkmark" size={18} color={fg} /> : null}
        <Text variant="labelLarge" numberOfLines={1} style={{ color: fg, flexShrink: 1 }}>{option.label}</Text>
      </PressableScale>;
    })}
  </View>;
}
const styles = StyleSheet.create({
  group: { flexDirection: "row" },
  option: { flex: 1, minWidth: 0, minHeight: 48, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8, paddingHorizontal: 8 },
});
