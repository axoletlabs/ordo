/**
 * Compact header shown while multi-select is active.
 * The count sits where the screen title sits, so entering selection does
 * not jump the label. Cancel and Select All trail on the right.
 */
import React from "react";
import { StyleSheet, View, type TextStyle } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useColumnPadding } from "../../hooks/use-scene-column-insets";
import { PressableScale } from "../ui/PressableScale";
import { Text } from "../ui/Text";
import { HEADER_CONTROL_SIZE, headerTitleTextStyle } from "../ui/Header";
import { useTheme } from "../../theme/ThemeProvider";
import { fontSize, layout, lineHeight } from "../../theme/tokens";

const headerActionTextStyle: TextStyle = {
  includeFontPadding: false,
  textAlignVertical: "center",
  fontSize: fontSize.md,
  lineHeight: Math.round(fontSize.md * lineHeight.normal),
};

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
  const column = useColumnPadding(maxWidth);
  const allSelected = selectableCount > 0 && count === selectableCount;
  const title = count === 0 ? "Select items" : count === 1 ? "1 selected" : `${count} selected`;

  return (
    <View
      style={[
        styles.wrap,
        {
          maxWidth,
          paddingTop: insets.top + layout.headerTopGap,
          paddingBottom: layout.headerContentGap,
          paddingLeft: column.left,
          paddingRight: column.right,
          borderBottomColor: palette.border,
        },
      ]}
    >
      <View style={styles.row}>
        <View style={styles.gutter} />
        <Text variant="header" numberOfLines={1} style={[headerTitleTextStyle, styles.count]}>
          {title}
        </Text>
        <PressableScale
          accessibilityRole="button"
          accessibilityLabel="Cancel selection"
          onPress={onCancel}
          hitSlop={8}
          style={styles.sideHit}
        >
          <Text variant="header" color="accent" style={headerActionTextStyle}>
            Cancel
          </Text>
        </PressableScale>
        {selectableCount > 0 ? (
          <PressableScale
            accessibilityRole="button"
            accessibilityLabel={allSelected ? "Deselect all" : "Select all"}
            onPress={onToggleSelectAll}
            hitSlop={8}
            style={[styles.sideHit, styles.beside]}
          >
            <Text variant="header" color="accent" numberOfLines={1} style={headerActionTextStyle}>
              {allSelected ? "Deselect" : "Select All"}
            </Text>
          </PressableScale>
        ) : null}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    width: "100%",
    alignSelf: "center",
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  row: {
    height: HEADER_CONTROL_SIZE,
    flexDirection: "row",
    alignItems: "center",
  },
  gutter: { width: layout.rowInset },
  count: { flex: 1, minWidth: 0, width: "auto", marginRight: layout.rowInset },
  sideHit: { height: HEADER_CONTROL_SIZE, justifyContent: "center" },
  beside: { marginLeft: layout.rowInset },
});
