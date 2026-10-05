/** A setting list row: same well, title, and hairline as a library row. */
import React from "react";
import { StyleSheet, View, useWindowDimensions } from "react-native";
import { MaterialIcon as Ionicons } from "./MaterialIcon";
import { PressableScale } from "./PressableScale";
import { Text } from "./Text";
import { useTheme } from "../../theme/ThemeProvider";
import { haptics } from "../../lib/haptics";
import { runPressAction } from "../../lib/press-action";
import { ROW_ICON_GLYPH } from "../../theme/alignment";
import { layout, radius, spacing } from "../../theme/tokens";

export interface SettingRowProps {
  icon?: keyof typeof Ionicons.glyphMap;
  label: string;
  description?: string;
  value?: string;
  onPress?: () => void | boolean | Promise<unknown>;
  right?: React.ReactNode;
  /** `column` (default) reserves the settings picker width so labels align. */
  rightFit?: "column" | "content";
  destructive?: boolean;
  /** Override the icon tint when the row is not destructive. */
  iconColor?: string;
  showChevron?: boolean;
  divider?: boolean;
  position?: "first" | "middle" | "last" | "only";
  selectionRole?: "radio" | "checkbox";
  checked?: boolean;
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
  divider = false,
  position = "only",
  selectionRole,
  checked,
}: SettingRowProps) {
  const { palette, expressive } = useTheme();
  const { width } = useWindowDimensions();
  const tint = destructive ? palette.error : iconColor ?? palette.onSurfaceVariant;
  const valueColor = destructive ? palette.danger : palette.textTertiary;
  const rowStyle = [styles.row, { borderBottomColor: palette.outlineVariant,
    backgroundColor: palette.surfaceContainerLow,
    borderRadius: expressive ? radius.xs : 0,
    borderTopLeftRadius: position === "first" || position === "only" ? expressive ? radius.xl : radius.lg : undefined,
    borderTopRightRadius: position === "first" || position === "only" ? expressive ? radius.xl : radius.lg : undefined,
    borderBottomLeftRadius: position === "last" || position === "only" ? expressive ? radius.xl : radius.lg : undefined,
    borderBottomRightRadius: position === "last" || position === "only" ? expressive ? radius.xl : radius.lg : undefined,
    marginBottom: expressive ? spacing[2] : 0,
    borderBottomWidth: expressive || !divider ? 0 : StyleSheet.hairlineWidth }];

  const content = (
    <>
      {icon ? (
        <View style={styles.icon}>
          <Ionicons name={icon} size={ROW_ICON_GLYPH} color={tint} />
        </View>
      ) : null}
      <View style={styles.body}>
        <Text variant="bodyLarge" numberOfLines={2} color={destructive ? "danger" : "primary"}>
          {label}
        </Text>
        {description ? (
          <Text variant="footnote" color="tertiary" style={styles.description}>
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
        <View style={rightFit === "content" ? styles.trailingHug : [styles.trailing, { width: width < 380 ? 112 : layout.settingsControlWidth }]}>
          {React.isValidElement(right) ? React.cloneElement(right as React.ReactElement<{ accessibilityLabel?: string }>, { accessibilityLabel: label }) : right}
        </View>
      ) : null}
      {showChevron ? (
        <Ionicons name="chevron-forward" size={ROW_ICON_GLYPH} color={palette.textFaint} />
      ) : null}
    </>
  );

  if (!onPress) return <View style={rowStyle}>{content}</View>;
  return (
    <PressableScale
      accessibilityRole={selectionRole ?? "button"}
      accessibilityState={selectionRole ? { checked: !!checked } : undefined}
      accessibilityLabel={description ? `${label}, ${description}` : label}
      style={rowStyle}
      onPress={() => {
        runPressAction(onPress, haptics.light);
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
    gap: spacing[16],
    paddingHorizontal: layout.rowInset,
    paddingVertical: spacing[12],
    minHeight: 72,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  noDivider: { borderBottomWidth: 0 },
  icon: { width: 24, height: 24, alignItems: "center", justifyContent: "center" },
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
