/**
 * Title block for floating panels and dialogs. Centered, using the same
 * Material headline-small role. An optional icon stacks above the title.
 */
import React from "react";
import { StyleSheet, View, type StyleProp, type ViewStyle } from "react-native";
import { MaterialIcon as Ionicons } from "./MaterialIcon";
import { Text, type TextVariant } from "./Text";
import { iconGlyphStyle } from "../../theme/icon-glyph";
import { radius, spacing } from "../../theme/tokens";
import { useTheme } from "../../theme/ThemeProvider";
import { PanelTitleContext } from "./panel-title";

const ICON_SIZE = 36;

export function PanelHeader({
  title,
  subtitle,
  icon,
  iconColor,
  iconBackground,
   titleVariant = "headlineSmall",
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
  const { palette } = useTheme();
  const titleId = React.useContext(PanelTitleContext);
  const resolvedIconColor = iconBackground === palette.primaryContainer && (!iconColor || iconColor === palette.primary)
    ? palette.onPrimaryContainer : iconBackground === palette.errorContainer && (!iconColor || iconColor === palette.error)
      ? palette.onErrorContainer : iconColor ?? palette.secondary;
  return (
    <View style={[styles.wrap, style]}>
      {icon ? (
        <View
          style={[
            styles.icon,
            iconBackground ? { backgroundColor: iconBackground } : null,
          ]}
        >
          <Ionicons
            name={icon}
            size={24}
            color={resolvedIconColor}
            accessible={false}
            style={iconGlyphStyle(24)}
          />
        </View>
      ) : null}
      <View style={styles.copy}>
        <Text
          variant={titleVariant}
          nativeID={titleId}
          accessibilityRole="header"
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
    marginBottom: spacing[24],
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
