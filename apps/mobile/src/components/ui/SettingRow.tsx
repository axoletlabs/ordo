/** A setting list row: same well, title, and hairline as a library row. */
import React from "react";
import { StyleSheet, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { PressableScale } from "./PressableScale";
import { RowIconWell } from "./RowIconWell";
import { Text } from "./Text";
import { useTheme } from "../../theme/ThemeProvider";
import { haptics } from "../../lib/haptics";
import { ROW_ICON_GLYPH } from "../../theme/alignment";
import { layout, spacing } from "../../theme/tokens";

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
  /** Override the icon tint when the row is not destructive. */
  iconColor?: string;
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
  iconColor,
  showChevron,
  divider = true,
}: SettingRowProps) {
  const { palette } = useTheme();
  const tint = destructive ? palette.danger : iconColor ?? palette.accent;
  const valueColor = destructive ? palette.danger : palette.textTertiary;

  const content = (
    <View style={[styles.row, { borderBottomColor: palette.border }, !divider && styles.noDivider]}>
      {icon ? (
        <RowIconWell>
          <Ionicons name={icon} size={ROW_ICON_GLYPH} color={tint} />
        </RowIconWell>
      ) : null}
      <View style={styles.body}>
        <Text variant="headline" numberOfLines={1} color={destructive ? "danger" : "primary"}>
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
      {showChevron ? (
        <Ionicons name="chevron-forward" size={ROW_ICON_GLYPH} color={palette.textFaint} />
      ) : null}
    </View>
  );

  if (!onPress) return content;
  return (
    <PressableScale
      onPress={() => {
        haptics.light();
        onPress();
      }}
    >
      {content}
    </PressableScale>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: "row",
    flexWrap: "nowrap",
    alignItems: "center",
    gap: spacing[12],
    paddingHorizontal: layout.rowInset,
    paddingVertical: spacing[8],
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  noDivider: { borderBottomWidth: 0 },
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
