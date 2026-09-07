import React from "react";
import { StyleSheet, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { PressableScale } from "./PressableScale";
import { Text } from "./Text";
import { useTheme } from "../../theme/ThemeProvider";
import { haptics } from "../../lib/haptics";
import { spacing } from "../../theme/tokens";

export const sheetMenuStyles = StyleSheet.create({
  stack: { gap: spacing[4], marginTop: spacing[12] },
  row: { flexDirection: "row", alignItems: "center", gap: spacing[8], marginTop: spacing[12] },
  cancel: { marginTop: spacing[4] },
});

export function SheetActionRow({
  icon,
  label,
  tone,
  trailing,
  divider = true,
  onPress,
}: {
  icon: keyof typeof Ionicons.glyphMap;
  label: string;
  tone?: "danger";
  trailing?: React.ReactNode;
  divider?: boolean;
  onPress: () => void;
}) {
  const { palette } = useTheme();
  const color = tone === "danger" ? palette.danger : palette.text;
  return (
    <PressableScale
      accessibilityRole="button"
      accessibilityLabel={label}
      style={[
        styles.row,
        { borderBottomColor: palette.border },
        !divider && styles.noDivider,
      ]}
      onPress={() => {
        haptics.light();
        onPress();
      }}
    >
      <Ionicons name={icon} size={20} color={tone === "danger" ? color : palette.accent} />
      <Text variant="body" style={[styles.label, { color }]} numberOfLines={1}>
        {label}
      </Text>
      {trailing ? <View style={styles.trailing}>{trailing}</View> : null}
    </PressableScale>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing[12],
    minHeight: 44,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  noDivider: { borderBottomWidth: 0 },
  label: { flex: 1, minWidth: 0 },
  trailing: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing[8],
    flexShrink: 0,
  },
});
