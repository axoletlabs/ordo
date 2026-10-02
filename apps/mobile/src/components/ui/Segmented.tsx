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
  return <View style={{ minHeight: 48, justifyContent: "center" }}><View accessibilityRole="radiogroup" style={[styles.group, {
    gap: expressive ? 2 : 0, borderWidth: expressive ? 0 : 1, borderColor: palette.outline,
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
      return <PressableScale key={option.value} accessibilityRole="radio" accessibilityLabel={option.label}
        accessibilityState={{ checked: selected }} onPress={() => { if (!selected) { haptics.selection(); onChange(option.value); } }}
        stateLayerColor={fg} hitSlop={{ top: 4, bottom: 4 }} shape={expressive ? { rest, pressed } : undefined}
        style={[styles.option, {
          height: expressive ? 40 : 38,
          backgroundColor: selected ? expressive ? palette.secondary : palette.secondaryContainer : expressive ? palette.surfaceContainerHigh : "transparent",
          borderRightWidth: !expressive && index < options.length - 1 ? 1 : 0, borderColor: palette.outline,
          ...(!expressive ? { borderTopLeftRadius: index === 0 ? outer : 0, borderBottomLeftRadius: index === 0 ? outer : 0,
            borderTopRightRadius: index === options.length - 1 ? outer : 0, borderBottomRightRadius: index === options.length - 1 ? outer : 0 } : {}),
        }]}>
        {selected && options.length <= 2 ? <MaterialIcon name="checkmark" size={18} color={fg} /> : null}
        <Text variant="labelLarge" numberOfLines={1} style={{ color: fg, flexShrink: 1 }}>{option.label}</Text>
      </PressableScale>;
    })}
  </View></View>;
}
const styles = StyleSheet.create({
  group: { flexDirection: "row", height: 40 },
  option: { flex: 1, minWidth: 48, height: 40, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8, paddingHorizontal: 8 },
});
