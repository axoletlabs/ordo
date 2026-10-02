/** Material empty/error state with tonal illustration and a clear next action. */
import React from "react";
import { StyleSheet, View } from "react-native";
import { MaterialIcon as Ionicons } from "./MaterialIcon";
import { Text } from "./Text";
import { useTheme } from "../../theme/ThemeProvider";
import { radius, spacing } from "../../theme/tokens";

export interface EmptyStateProps {
  icon: keyof typeof Ionicons.glyphMap;
  title: string;
  message?: string;
  action?: React.ReactNode;
  /** Tighter padding for inline use (e.g. under a reader article header). */
  compact?: boolean;
}

export function EmptyState({ icon, title, message, action, compact }: EmptyStateProps) {
  const { palette, expressive } = useTheme();
  return (
    <View style={[styles.wrap, compact && styles.compact]}>
      <View style={[styles.iconCircle, { backgroundColor: palette.tertiaryContainer, borderRadius: expressive ? radius["2xl"] : radius.full }]}>
        <Ionicons name={icon} size={40} color={palette.onTertiaryContainer} />
      </View>
      <Text variant="headlineSmall" align="center" style={{ marginTop: spacing[24] }}>{title}</Text>
      {message ? (
        <Text variant="bodyMedium" color="secondary" align="center" style={{ marginTop: spacing[8] }}>
          {message}
        </Text>
      ) : null}
      {action ? <View style={{ marginTop: spacing[16] }}>{action}</View> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    width: "100%",
    maxWidth: 420,
    alignSelf: "center",
    alignItems: "center",
    justifyContent: "center",
    paddingVertical: spacing[32],
    paddingHorizontal: spacing[24],
  },
  compact: {
    paddingVertical: spacing[20],
    paddingHorizontal: spacing[16],
  },
  iconCircle: { width: 88, height: 88, alignItems: "center", justifyContent: "center" },
});
