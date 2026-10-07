/** Material filter / assist chip. Tag color remains a secondary identity marker. */
import React from "react";
import { StyleSheet, View } from "react-native";
import type { TagColor } from "@ordo/shared";
import { Text } from "../ui/Text";
import { PressableScale } from "../ui/PressableScale";
import { MaterialIcon } from "../ui/MaterialIcon";
import { useTheme } from "../../theme/ThemeProvider";
import { radius, spacing } from "../../theme/tokens";
import { tagColorValue } from "../../lib/tag-colors";
export interface TagChipProps {
  name: string; color: TagColor; selected?: boolean; count?: number; compact?: boolean; inline?: boolean;
  onPress?: () => void; accessibilityLabel?: string;
}
export const TagChip = React.memo(function TagChip({ name, color, selected = false, count, compact = false, inline = false, onPress, accessibilityLabel }: TagChipProps) {
  const { palette, expressive } = useTheme();
  const fg = selected ? palette.onSecondaryContainer : palette.onSurfaceVariant;
  const contents = <>
    {selected ? <MaterialIcon name="checkmark" size={18} color={fg} /> : <View style={[styles.dot, { backgroundColor: tagColorValue(color).dot }]} />}
    <Text variant={compact ? "labelMedium" : "labelLarge"} numberOfLines={1} style={{ color: fg, flexShrink: 1 }}>{name}</Text>
    {count != null ? <Text variant="labelMedium" style={{ color: fg }}>{count}</Text> : null}
  </>;
  const style = [styles.chip, { minHeight: compact ? 32 : 40, flexShrink: 1, backgroundColor: selected ? palette.secondaryContainer : palette.surfaceContainerHigh,
    borderWidth: 0, borderRadius: expressive ? radius.full : radius.sm },
    inline ? { minHeight: 24, paddingHorizontal: 0, backgroundColor: "transparent", maxWidth: 120 } : null];
  return onPress ? <PressableScale accessibilityRole="button" accessibilityLabel={accessibilityLabel ?? name}
    accessibilityState={{ selected }} hitSlop={{ top: 8, bottom: 8 }} stateLayerColor={fg}
    shape={expressive ? { rest: radius.full, pressed: radius.md } : undefined}
    style={style}
    onPress={(event) => { event.stopPropagation(); onPress(); }}>{contents}</PressableScale> : <View style={style}>{contents}</View>;
});
const styles = StyleSheet.create({
  chip: { flexDirection: "row", alignItems: "center", gap: spacing[8], paddingHorizontal: spacing[12], borderWidth: 1, alignSelf: "flex-start", maxWidth: 200 },
  dot: { width: 8, height: 8, borderRadius: radius.full },
});
