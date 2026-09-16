/**
 * Title block for floating panels and dialogs. Centered, using the same
 * uppercase Inter Tight as screen headers so overlays sit in the same type
 * system as the rest of the app. An optional icon stacks above the title.
 */
import React from "react";
import { StyleSheet, View, type StyleProp, type ViewStyle } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { Text, type TextVariant } from "./Text";
import { radius, spacing } from "../../theme/tokens";

const ICON_SIZE = 36;

export function PanelHeader({
  title,
  subtitle,
  icon,
  iconColor,
  iconBackground,
  titleVariant = "header",
  subtitleVariant = "footnote",
  numberOfLines = 3,
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
      {icon ? (
        <View
          style={[
            styles.icon,
            iconBackground ? { backgroundColor: iconBackground } : null,
          ]}
        >
          <Ionicons name={icon} size={18} color={iconColor} accessible={false} />
        </View>
      ) : null}
      <View style={styles.copy}>
        <Text
          variant={titleVariant}
          align="center"
          numberOfLines={numberOfLines}
          style={styles.title}
        >
          {title}
        </Text>
        {accessory ? <View style={styles.accessory}>{accessory}</View> : null}
        {subtitle ? (
          <Text
            variant={subtitleVariant}
            color="secondary"
            align="center"
            numberOfLines={4}
            style={styles.subtitle}
          >
            {subtitle}
          </Text>
        ) : null}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    alignItems: "center",
    marginBottom: spacing[12],
  },
  icon: {
    width: ICON_SIZE,
    height: ICON_SIZE,
    borderRadius: radius.md,
    alignItems: "center",
    justifyContent: "center",
    flexShrink: 0,
    marginBottom: spacing[12],
  },
  copy: {
    width: "100%",
    alignItems: "center",
  },
  title: {
    width: "100%",
    includeFontPadding: false,
    textAlignVertical: "center",
  },
  accessory: {
    marginTop: spacing[4],
    alignItems: "center",
  },
  subtitle: {
    marginTop: spacing[6],
    width: "100%",
    includeFontPadding: false,
  },
});
