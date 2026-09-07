/**
 * Compact header shown while multi-select is active: Cancel, count, Select all.
 * Uses the same title slot as `Header` so entering selection does not jump the label.
 */
import React from "react";
import { StyleSheet, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { PressableScale } from "../ui/PressableScale";
import { Text } from "../ui/Text";
import {
  HEADER_CONTROL_SIZE,
  HEADER_LINE_HEIGHT,
  headerSideStyle,
  headerTitleTextStyle,
} from "../ui/Header";
import { useTheme } from "../../theme/ThemeProvider";
import { layout, spacing } from "../../theme/tokens";

/** Clears "Select all" / "Deselect" while keeping the title on the same center as `Header`. */
const TITLE_SLOT_INSET = 80;

export function SelectionHeader({
  count,
  selectableCount,
  onCancel,
  onToggleSelectAll,
  maxWidth = layout.maxContentWidth,
}: {
  count: number;
  selectableCount: number;
  onCancel: () => void;
  onToggleSelectAll: () => void;
  maxWidth?: number;
}) {
  const { palette } = useTheme();
  const insets = useSafeAreaInsets();
  const allSelected = selectableCount > 0 && count === selectableCount;
  const title = count === 0 ? "Select items" : count === 1 ? "1 selected" : `${count} selected`;

  return (
    <View
      style={[
        styles.wrap,
        {
          maxWidth,
          paddingTop: insets.top + spacing[4],
          paddingLeft: Math.max(insets.left, spacing[16]),
          paddingRight: Math.max(insets.right, spacing[16]),
          borderBottomColor: palette.border,
        },
      ]}
    >
      <View style={styles.row}>
        <View style={[headerSideStyle, styles.left]} pointerEvents="box-none">
          <PressableScale
            accessibilityRole="button"
            accessibilityLabel="Cancel selection"
            onPress={onCancel}
            hitSlop={8}
            style={styles.sideHit}
          >
            <Text variant="bodyStrong" color="accent">
              Cancel
            </Text>
          </PressableScale>
        </View>
        <View pointerEvents="none" style={styles.titleSlot}>
          <Text variant="header" align="center" numberOfLines={1} style={headerTitleTextStyle}>
            {title}
          </Text>
        </View>
        {selectableCount > 0 ? (
          <View style={[headerSideStyle, styles.right]} pointerEvents="box-none">
            <PressableScale
              accessibilityRole="button"
              accessibilityLabel={allSelected ? "Deselect all" : "Select all"}
              onPress={onToggleSelectAll}
              hitSlop={8}
              style={styles.sideHit}
            >
              <Text variant="bodyStrong" color="accent" numberOfLines={1}>
                {allSelected ? "Deselect" : "Select all"}
              </Text>
            </PressableScale>
          </View>
        ) : null}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    width: "100%",
    alignSelf: "center",
    paddingBottom: spacing[6],
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  row: {
    height: HEADER_LINE_HEIGHT,
    justifyContent: "center",
  },
  titleSlot: {
    ...StyleSheet.absoluteFillObject,
    left: TITLE_SLOT_INSET,
    right: TITLE_SLOT_INSET,
    alignItems: "center",
    justifyContent: "center",
  },
  left: { left: 0 },
  right: { right: 0, alignItems: "flex-end" },
  sideHit: { height: HEADER_CONTROL_SIZE, justifyContent: "center" },
});
