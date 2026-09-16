/**
 * Title block for floating panels and dialogs. Left-aligned to match
 * the context-menu card, not a centered alert. An icon sits in a chip
 * beside the copy so title and subtitle share one edge, like SettingRow.
 */
import React from "react";
import { StyleSheet, View, type StyleProp, type ViewStyle } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { Text, type TextVariant } from "./Text";
import { radius, spacing } from "../../theme/tokens";

const ICON_SIZE = 28;
/** Extra left inset so body copy lines up with the title when an icon is present. */
export const PANEL_ICON_COLUMN = ICON_SIZE + spacing[12];

export function PanelHeader({
  title,
  subtitle,
  icon,
  iconColor,
  iconBackground,
  titleVariant = "title2",
  subtitleVariant = "footnote",
  numberOfLines,
  accessory,
  style,
}: {
  title: string;
  subtitle?: string;
  icon?: keyof typeof Ionicons.glyphMap;
  iconColor?: string;
  iconBackground?: string;
  titleVariant?: TextVariant;
  subtitleVariant?: TextVariant;
  numberOfLines?: number;
  accessory?: React.ReactNode;
  style?: StyleProp<ViewStyle>;
}) {
  return (
    <View style={[styles.wrap, icon ? styles.wrapWithIcon : null, style]}>
      {icon ? (
        <View
          style={[
            styles.icon,
            iconBackground ? { backgroundColor: iconBackground } : null,
          ]}
        >
          <Ionicons name={icon} size={16} color={iconColor} accessible={false} />
        </View>
      ) : null}
      <View style={icon ? styles.copy : null}>
        <View style={styles.titleRow}>
          <Text variant={titleVariant} numberOfLines={numberOfLines} style={styles.title}>
            {title}
          </Text>
          {accessory}
        </View>
        {subtitle ? (
          <Text variant={subtitleVariant} color="secondary" numberOfLines={3} style={styles.subtitle}>
            {subtitle}
          </Text>
        ) : null}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    alignItems: "stretch",
    paddingHorizontal: spacing[4],
    marginBottom: spacing[8],
  },
  wrapWithIcon: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: spacing[12],
  },
  icon: {
    width: ICON_SIZE,
    height: ICON_SIZE,
    borderRadius: radius.sm,
    alignItems: "center",
    justifyContent: "center",
    flexShrink: 0,
  },
  copy: { flex: 1, minWidth: 0 },
  titleRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing[8],
  },
  title: { flex: 1, minWidth: 0 },
  subtitle: { marginTop: spacing[4] },
});
