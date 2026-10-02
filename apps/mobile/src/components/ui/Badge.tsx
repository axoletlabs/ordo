/** Small pill badge — soft tinted. */
import React from "react";
import { StyleSheet, View } from "react-native";
import { Text } from "./Text";
import { useTheme } from "../../theme/ThemeProvider";
import { radius, spacing } from "../../theme/tokens";

export interface BadgeProps {
  children: React.ReactNode;
  tone?: "neutral" | "accent" | "green" | "blue" | "danger";
}

export function Badge({ children, tone = "neutral" }: BadgeProps) {
  const { palette } = useTheme();
  const { bg, fg } = {
    neutral: { bg: palette.surfaceSecondary, fg: palette.textTertiary },
    accent: { bg: palette.primaryContainer, fg: palette.onPrimaryContainer },
    green: { bg: palette.primaryContainer, fg: palette.onPrimaryContainer },
    blue: { bg: palette.secondaryContainer, fg: palette.onSecondaryContainer },
    danger: { bg: palette.errorContainer, fg: palette.onErrorContainer },
  }[tone];

  return (
    <View style={[styles.badge, { backgroundColor: bg, borderRadius: radius.full }]}>
      <Text variant="labelSmall" style={{ color: fg }}>
        {children}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  badge: { paddingHorizontal: spacing[4], minHeight: 16, minWidth: 16, alignItems: "center", justifyContent: "center" },
});
