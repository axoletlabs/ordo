/** A setting list row: same well, title, and hairline as a library row. */
import React from "react";
import { StyleSheet, View, useWindowDimensions } from "react-native";
import { MaterialIcon as Ionicons } from "./MaterialIcon";
import { PressableScale } from "./PressableScale";
import { Text } from "./Text";
import { UnavailableLabel } from "./UnavailableLabel";
import { useTheme } from "../../theme/ThemeProvider";
import { haptics } from "../../lib/haptics";
import { runPressAction } from "../../lib/press-action";
import { ROW_ICON_GLYPH } from "../../theme/alignment";
import { layout, radius, spacing } from "../../theme/tokens";

export interface SettingRowProps {
  icon?: keyof typeof Ionicons.glyphMap;
  label: string;
  /** Use 0 when the complete value must stay readable, such as a website address. */
  labelLines?: number;
  description?: string;
  /** Replaces the control with a status label and keeps its reason readable. */
  unavailableReason?: string;
  value?: string;
  onPress?: () => void | boolean | Promise<unknown>;
  right?: React.ReactNode;
  /** `column` (default) reserves the settings picker width so labels align. */
  rightFit?: "column" | "content";
  destructive?: boolean;
  /** Override the icon tint when the row is not destructive. */
  iconColor?: string;
  showChevron?: boolean;
  /** Point the chevron up instead of forward, for rows that expand in place. */
  chevronUp?: boolean;
  divider?: boolean;
  position?: "first" | "middle" | "last" | "only";
  selectionRole?: "radio" | "checkbox";
  checked?: boolean;
  disabled?: boolean;
}

export function SettingRow({
  icon,
  label,
  labelLines = 2,
  description,
  unavailableReason,
  value,
  onPress,
  right,
  rightFit = "column",
  destructive,
  iconColor,
  showChevron,
  chevronUp = false,
  divider = false,
  position = "only",
  selectionRole,
  checked,
  disabled = false,
}: SettingRowProps) {
  const { palette, expressive } = useTheme();
  const { width } = useWindowDimensions();
  const tint = destructive ? palette.error : iconColor ?? palette.onSurfaceVariant;
  const valueColor = destructive ? palette.danger : palette.textTertiary;
  const unavailable = !!unavailableReason;
  const supportingText = unavailableReason || description;
  const rowStyle = [styles.row, { borderBottomColor: palette.outlineVariant,
    backgroundColor: palette.surfaceContainerLow,
    borderRadius: expressive ? radius.xs : 0,
    borderTopLeftRadius: position === "first" || position === "only" ? expressive ? radius.xl : radius.lg : undefined,
    borderTopRightRadius: position === "first" || position === "only" ? expressive ? radius.xl : radius.lg : undefined,
    borderBottomLeftRadius: position === "last" || position === "only" ? expressive ? radius.xl : radius.lg : undefined,
    borderBottomRightRadius: position === "last" || position === "only" ? expressive ? radius.xl : radius.lg : undefined,
    marginBottom: expressive ? spacing[2] : 0,
    borderBottomWidth: expressive || !divider ? 0 : StyleSheet.hairlineWidth,
    opacity: disabled && !unavailable ? 0.38 : 1 }];

  const content = (
    <>
      {icon ? (
        <View style={styles.icon}>
          <Ionicons name={icon} size={ROW_ICON_GLYPH} color={tint} />
        </View>
      ) : null}
      <View style={styles.body}>
        <Text variant="bodyLarge" numberOfLines={labelLines} color={destructive ? "danger" : "primary"}>
          {label}
        </Text>
        {supportingText ? (
          <Text variant="footnote" color="tertiary" style={styles.description}>
            {supportingText}
          </Text>
        ) : null}
      </View>
      {value && !unavailable ? (
        <Text variant="footnote" numberOfLines={1} style={[styles.value, { color: valueColor }]}>
          {value}
        </Text>
      ) : null}
      {unavailable ? <UnavailableLabel /> : right ? (
        <View style={rightFit === "content" ? styles.trailingHug : [styles.trailing, { width: width < 380 ? 112 : layout.settingsControlWidth }]}>
          {React.isValidElement(right) ? React.cloneElement(right as React.ReactElement<{ accessibilityLabel?: string }>, { accessibilityLabel: label }) : right}
        </View>
      ) : null}
      {showChevron && !unavailable ? (
        <Ionicons name={chevronUp ? "chevron-up" : "chevron-forward"} size={ROW_ICON_GLYPH} color={palette.textFaint} />
      ) : null}
    </>
  );

  if (unavailable) return <View accessible accessibilityState={{ disabled: true }}
    accessibilityLabel={`${label}, unavailable. ${unavailableReason}`} style={rowStyle}>{content}</View>;
  if (!onPress) return <View style={rowStyle}>{content}</View>;
  return (
    <PressableScale
      accessibilityRole={selectionRole ?? "button"}
      disabled={disabled}
      accessibilityState={{ disabled, ...(selectionRole ? { checked: !!checked } : {}) }}
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
