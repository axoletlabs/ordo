/** A consistent, full-width entry into folder, tag, and icon selection. */
import React from "react";
import { StyleSheet, View } from "react-native";
import { MaterialIcon } from "./MaterialIcon";
import { PressableScale } from "./PressableScale";
import { Text } from "./Text";
import { useTheme } from "../../theme/ThemeProvider";
import { radius, spacing } from "../../theme/tokens";

export function PickerField({ label, value, icon, onPress }: {
  label: string; value: string; icon: keyof typeof MaterialIcon.glyphMap; onPress: () => void;
}) {
  const { palette, expressive } = useTheme();
  return <PressableScale accessibilityRole="button" accessibilityLabel={`${label}, ${value}`}
    accessibilityHint={`Choose ${label.toLocaleLowerCase()}.`} onPress={onPress}
    stateLayerColor={palette.onSecondaryContainer}
    style={[styles.field, { backgroundColor: palette.secondaryContainer, borderRadius: expressive ? radius.lg : radius.md }]}>
    <MaterialIcon name={icon} size={24} color={palette.onSecondaryContainer} />
    <View style={{ flex: 1, minWidth: 0 }}>
      <Text variant="bodySmall" style={{ color: palette.onSecondaryContainer }}>{label}</Text>
      <Text variant="bodyLarge" numberOfLines={1} style={{ color: palette.onSecondaryContainer }}>{value}</Text>
    </View>
    <MaterialIcon name="chevron-forward" size={24} color={palette.onSecondaryContainer} />
  </PressableScale>;
}
const styles = StyleSheet.create({
  field: { minHeight: 64, flexDirection: "row", alignItems: "center", gap: spacing[16], paddingHorizontal: spacing[16], paddingVertical: spacing[8] },
});
