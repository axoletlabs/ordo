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

/** Shrink-wraps action rows to the longest label and centers that column. */
export function SheetMenu({ children }: { children: React.ReactNode }) {
  return (
    <View style={styles.menu}>
      <View>{children}</View>
    </View>
  );
}

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
  const fill = trailing != null;
  return (
    <View style={[styles.wrap, fill && styles.wrapFill]}>
      <PressableScale
        accessibilityRole="button"
        accessibilityLabel={label}
        style={styles.row}
        onPress={() => {
          haptics.light();
          onPress();
        }}
      >
        <Ionicons name={icon} size={20} color={tone === "danger" ? color : palette.accent} />
        <Text variant="body" style={[styles.label, fill && styles.labelFill, { color }]} numberOfLines={1}>
          {label}
        </Text>
        {trailing ? <View style={styles.trailing}>{trailing}</View> : null}
      </PressableScale>
      {divider ? <View style={[styles.divider, { backgroundColor: palette.border }]} /> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  menu: { width: "100%", alignItems: "center" },
  wrap: { minWidth: "100%" },
  wrapFill: { alignSelf: "stretch", width: "100%" },
  row: {
    flexDirection: "row",
    alignItems: "center",
    alignSelf: "stretch",
    gap: spacing[12],
    minHeight: 42,
  },
  label: { flexShrink: 1 },
  labelFill: { flex: 1, minWidth: 0 },
  trailing: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing[8],
    flexShrink: 0,
  },
  divider: { height: StyleSheet.hairlineWidth, width: "100%" },
});
