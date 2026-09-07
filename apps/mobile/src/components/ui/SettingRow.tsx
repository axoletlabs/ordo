/** A setting list row: icon chip + label + value/chevron, or trailing control. */
import React from "react";
import { StyleSheet, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { PressableScale } from "./PressableScale";
import { Text } from "./Text";
import { useTheme } from "../../theme/ThemeProvider";
import { layout, radius, spacing } from "../../theme/tokens";

export interface SettingRowProps {
  icon?: keyof typeof Ionicons.glyphMap;
  label: string;
  description?: string;
  value?: string;
  onPress?: () => void;
  right?: React.ReactNode;
  /** `column` (default) reserves the settings picker width so labels align. */
  rightFit?: "column" | "content";
  destructive?: boolean;
  showChevron?: boolean;
  divider?: boolean;
}

export function SettingRow({
  icon,
  label,
  description,
  value,
  onPress,
  right,
  rightFit = "column",
  destructive,
  showChevron,
  divider = true,
}: SettingRowProps) {
  const { palette } = useTheme();
  const tint = destructive ? palette.danger : palette.accent;
  const valueColor = destructive ? palette.danger : palette.textTertiary;

  const content = (
    <View style={[styles.row, { borderBottomColor: palette.border }, !divider && styles.noDivider]}>
      {icon ? (
        <View style={[styles.iconWrap, { backgroundColor: palette.surfaceSecondary, borderRadius: radius.sm }]}>
          <Ionicons name={icon} size={16} color={tint} />
        </View>
      ) : null}
      <View style={styles.body}>
        <Text
          variant="bodyStrong"
          numberOfLines={1}
          style={{ color: destructive ? palette.danger : palette.text }}
        >
          {label}
        </Text>
        {description ? (
          <Text variant="footnote" color="tertiary" numberOfLines={2} style={styles.description}>
            {description}
          </Text>
        ) : null}
      </View>
      {value ? (
        <Text variant="footnote" numberOfLines={1} style={[styles.value, { color: valueColor }]}>
          {value}
        </Text>
      ) : null}
      {right ? (
        <View style={rightFit === "content" ? styles.trailingHug : styles.trailing}>{right}</View>
      ) : null}
      {showChevron ? <Ionicons name="chevron-forward" size={16} color={palette.textFaint} /> : null}
    </View>
  );

  if (!onPress) return <View style={styles.pad}>{content}</View>;
  return (
    <View style={styles.pad}>
      <PressableScale style={styles.press} dim onPress={onPress}>
        {content}
      </PressableScale>
    </View>
  );
}

const styles = StyleSheet.create({
  pad: { width: "100%" },
  press: { borderRadius: radius.sm },
  row: {
    flexDirection: "row",
    flexWrap: "nowrap",
    alignItems: "center",
    gap: spacing[12],
    minHeight: 52,
    paddingHorizontal: spacing[16],
    paddingVertical: spacing[10],
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  noDivider: { borderBottomWidth: 0 },
  iconWrap: {
    width: 28, height: 28, alignItems: "center", justifyContent: "center",
    flexShrink: 0, overflow: "hidden",
  },
  body: { flex: 1, flexBasis: 0, minWidth: 0 },
  description: { marginTop: spacing[2] },
  value: { maxWidth: layout.settingsControlWidth, flexShrink: 0, textAlign: "right" },
  trailing: {
    width: layout.settingsControlWidth,
    flexGrow: 0,
    flexShrink: 0,
    alignItems: "flex-end",
    justifyContent: "center",
    overflow: "hidden",
  },
  trailingHug: { flexShrink: 0 },
});
