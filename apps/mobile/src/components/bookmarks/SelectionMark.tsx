import React from "react";
import { Animated, StyleSheet, View } from "react-native";
import { MaterialIcon as Ionicons } from "../ui/MaterialIcon";
import { useTheme } from "../../theme/ThemeProvider";
import { ROW_ICON_FRAME, ROW_ICON_GLYPH } from "../../theme/alignment";
import { radius } from "../../theme/tokens";
import { useStateVisibility } from "../ui/StateLayer";

/** Same footprint as folder/favicon tiles so selection chrome matches the row. */
export const SELECTION_MARK_SIZE = ROW_ICON_FRAME;

export function SelectionMark({ selected, size = SELECTION_MARK_SIZE }: { selected: boolean; size?: number }) {
  const { palette } = useTheme();
  const progress = useStateVisibility(selected);
  return (
    <View
      style={[
        styles.mark,
        {
          width: size,
          height: size,
          backgroundColor: palette.surfaceSecondary,
          borderColor: palette.outline,
        },
      ]}
    >
      <Animated.View pointerEvents="none" style={[StyleSheet.absoluteFill, styles.selected,
        { backgroundColor: palette.primary, opacity: progress }]}>
        <Ionicons name="checkmark" size={ROW_ICON_GLYPH} color={palette.onAccent} />
      </Animated.View>
    </View>
  );
}

const styles = StyleSheet.create({
  mark: {
    borderRadius: radius.sm,
    borderWidth: StyleSheet.hairlineWidth,
    alignItems: "center",
    justifyContent: "center",
    overflow: "hidden",
  },
  selected: { alignItems: "center", justifyContent: "center", borderRadius: radius.sm },
});
