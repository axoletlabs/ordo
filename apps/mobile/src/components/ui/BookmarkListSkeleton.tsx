/**
 * Bookmark list skeleton (used while the first page loads).
 */
import React from "react";
import { StyleSheet, View } from "react-native";
import { Skeleton, SkeletonGroup } from "./Skeleton";
import { ROW_ICON_FRAME } from "../../theme/alignment";
import { layout, spacing } from "../../theme/tokens";
import { useTheme } from "../../theme/ThemeProvider";
import { listCorners, listPosition } from "../../theme/list-shape";

export function BookmarkListSkeleton({ count = 6 }: { count?: number }) {
  const { palette, expressive } = useTheme();
  return (
    <SkeletonGroup><View style={styles.wrap}>
      {Array.from({ length: count }).map((_, i) => (
        <View key={i} style={[styles.row, { backgroundColor: expressive ? palette.surfaceContainerLow : "transparent",
          ...(expressive ? listCorners(listPosition(i, count), false) : { borderRadius: 0 }),
          marginBottom: expressive && i < count - 1 ? spacing[2] : 0 }]}>
          <Skeleton width={ROW_ICON_FRAME} height={ROW_ICON_FRAME} radiusKey="sm" />
          <View style={styles.copy}>
            <Skeleton width="72%" height={15} />
            <Skeleton width="48%" height={11} style={{ marginTop: spacing[6] }} />
          </View>
        </View>
      ))}
    </View></SkeletonGroup>
  );
}

const styles = StyleSheet.create({
  wrap: { width: "100%", alignSelf: "center" },
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing[16],
    paddingLeft: layout.rowInset,
    paddingRight: layout.rowInset,
    paddingVertical: spacing[16],
    minHeight: 72,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderColor: "transparent",
  },
  copy: { flex: 1, minWidth: 0 },
});
