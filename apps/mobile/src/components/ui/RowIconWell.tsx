/**
 * Leading icon well shared by bookmark, folder, tag, and settings rows.
 * One size, one radius, one hairline, so those lists sit on the same grid.
 */
import React from "react";
import { StyleSheet, View, type StyleProp, type ViewStyle } from "react-native";
import { useTheme } from "../../theme/ThemeProvider";
import { ROW_ICON_FRAME } from "../../theme/alignment";
import { radius } from "../../theme/tokens";

export function RowIconWell({
  children,
  style,
}: {
  children: React.ReactNode;
  style?: StyleProp<ViewStyle>;
}) {
  const { palette } = useTheme();
  return (
    <View
      style={[
        styles.well,
        { backgroundColor: palette.surfaceSecondary, borderColor: palette.border },
        style,
      ]}
    >
      {children}
    </View>
  );
}

const styles = StyleSheet.create({
  well: {
    width: ROW_ICON_FRAME,
    height: ROW_ICON_FRAME,
    borderRadius: radius.sm,
    borderWidth: StyleSheet.hairlineWidth,
    alignItems: "center",
    justifyContent: "center",
    flexShrink: 0,
  },
});
