import React from "react";
import { StyleSheet } from "react-native";
import { useTheme } from "../../theme/ThemeProvider";
import { radius, spacing } from "../../theme/tokens";
import { Text } from "./Text";

/** A readable, non-interactive status in place of an unavailable control. */
export function UnavailableLabel() {
  const { palette } = useTheme();
  return <Text variant="labelMedium" color="secondary"
    style={[styles.label, { backgroundColor: palette.surfaceContainerHighest }]}>
    Unavailable
  </Text>;
}

const styles = StyleSheet.create({
  label: {
    alignSelf: "center",
    borderRadius: radius.sm,
    paddingHorizontal: spacing[8],
    paddingVertical: spacing[4],
  },
});
