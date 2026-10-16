/** Non-interactive Material list content; actions belong in ListPressable. */
import React from "react";
import { StyleSheet, View } from "react-native";
import { useTheme } from "../../theme/ThemeProvider";
import { listCorners, type ListPosition } from "../../theme/list-shape";
import { spacing } from "../../theme/tokens";

export function ListItem({ children, position = "only" }: {
  children: React.ReactNode;
  position?: ListPosition;
}) {
  const { palette, expressive } = useTheme();
  return <View style={[styles.row, expressive ? {
    backgroundColor: palette.surfaceContainerLow,
    ...listCorners(position, false),
    marginBottom: position === "last" || position === "only" ? 0 : spacing[2],
  } : {
    borderBottomColor: palette.outlineVariant,
    borderBottomWidth: position === "last" || position === "only" ? 0 : StyleSheet.hairlineWidth,
  }]}>{children}</View>;
}

const styles = StyleSheet.create({
  row: { minHeight: 56, justifyContent: "center", paddingHorizontal: spacing[16], paddingVertical: spacing[16], gap: spacing[8] },
});
