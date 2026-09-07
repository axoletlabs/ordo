/**
 * Title block for floating panels and dialogs.
 * Action menus use `align="start"` so the title sits on the same edge as the rows.
 */
import React from "react";
import { StyleSheet, View, type StyleProp, type ViewStyle } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { Text, type TextVariant } from "./Text";
import { radius, spacing } from "../../theme/tokens";

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
  align = "center",
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
  align?: "center" | "start";
  style?: StyleProp<ViewStyle>;
}) {
  const start = align === "start";
  const copy = (
    <>
      <View style={[styles.titleCluster, start && styles.titleClusterStart]}>
        <Text
          variant={titleVariant}
          align={start ? "left" : "center"}
          numberOfLines={numberOfLines}
          style={styles.title}
        >
          {title}
        </Text>
        {accessory}
      </View>
      {subtitle ? (
        <Text
          variant={subtitleVariant}
          color="secondary"
          align={start ? "left" : "center"}
          numberOfLines={3}
          style={styles.subtitle}
        >
          {subtitle}
        </Text>
      ) : null}
    </>
  );

  return (
    <View style={[styles.wrap, start && styles.wrapStart, style]}>
      {icon ? (
        <View style={[styles.icon, start && styles.iconStart, { backgroundColor: iconBackground }]}>
          <Ionicons name={icon} size={start ? 16 : 20} color={iconColor} />
        </View>
      ) : null}
      {start ? <View style={styles.copy}>{copy}</View> : copy}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    alignItems: "center",
    marginBottom: spacing[8],
  },
  wrapStart: {
    flexDirection: "row",
    alignItems: "center",
    marginBottom: spacing[6],
  },
  icon: {
    width: 36,
    height: 36,
    borderRadius: radius.md,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: spacing[6],
  },
  iconStart: {
    width: 28,
    height: 28,
    marginBottom: 0,
    flexShrink: 0,
  },
  copy: { flex: 1, minWidth: 0 },
  titleCluster: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: spacing[8],
    alignSelf: "stretch",
  },
  titleClusterStart: { justifyContent: "flex-start" },
  title: { flexShrink: 1 },
  subtitle: { marginTop: spacing[2], alignSelf: "stretch" },
});
