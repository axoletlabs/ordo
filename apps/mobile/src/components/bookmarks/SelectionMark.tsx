import React from "react";
import { StyleSheet, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useTheme } from "../../theme/ThemeProvider";
import { radius } from "../../theme/tokens";

/** Same footprint as folder/favicon tiles so selection chrome matches the row. */
export const SELECTION_MARK_SIZE = 36;

export function SelectionMark({ selected, size = SELECTION_MARK_SIZE }: { selected: boolean; size?: number }) {
  const { palette } = useTheme();
  return (
    <View
      style={[
        styles.mark,
        {
          width: size,
          height: size,
          backgroundColor: selected ? palette.accent : palette.surfaceSecondary,
          borderColor: selected ? palette.accent : palette.border,
        },
      ]}
    >
      {selected ? (
        <Ionicons name="checkmark" size={18} color={palette.onAccent} />
      ) : null}
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
});
