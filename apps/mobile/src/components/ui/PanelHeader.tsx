/**
 * Title block for floating panels and dialogs. Left-aligned to match
 * the context-menu card, not a centered alert.
 */
import React from "react";
import { StyleSheet, View, type StyleProp, type ViewStyle } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { Text, type TextVariant } from "./Text";
import { spacing } from "../../theme/tokens";

export function PanelHeader({
  title,
  subtitle,
  icon,
  iconColor,
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
    <View style={[styles.wrap, style]}>
      <View style={styles.titleRow}>
        {icon ? <Ionicons name={icon} size={18} color={iconColor} accessible={false} /> : null}
        <Text variant={titleVariant} numberOfLines={numberOfLines} style={styles.title}>
          {title}
        </Text>
        {accessory}
      </View>
      {subtitle ? (
        <Text
          variant={subtitleVariant}
          color="secondary"
          numberOfLines={3}
          style={[styles.subtitle, icon ? styles.subtitleWithIcon : null]}
        >
          {subtitle}
        </Text>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    alignItems: "stretch",
    paddingHorizontal: spacing[4],
    marginBottom: spacing[8],
  },
  titleRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing[8],
    alignSelf: "stretch",
  },
  title: { flex: 1, minWidth: 0 },
  subtitle: { marginTop: spacing[6] },
  subtitleWithIcon: { paddingLeft: 26 },
});
