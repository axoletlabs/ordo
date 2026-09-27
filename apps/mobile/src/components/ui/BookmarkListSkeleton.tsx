/**
 * Bookmark list skeleton (used while the first page loads).
 */
import React from "react";
import { StyleSheet, View } from "react-native";
import { Skeleton } from "./Skeleton";
import { layout, spacing } from "../../theme/tokens";

export function BookmarkListSkeleton({ count = 6 }: { count?: number }) {
  return (
    <View style={styles.wrap}>
      {Array.from({ length: count }).map((_, i) => (
        <View key={i} style={styles.row}>
          <Skeleton width={36} height={36} radiusKey="sm" />
          <View style={styles.copy}>
            <Skeleton width="72%" height={15} />
            <Skeleton width="48%" height={11} style={{ marginTop: spacing[6] }} />
          </View>
        </View>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { width: "100%", alignSelf: "center" },
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing[12],
    paddingLeft: layout.rowInset,
    paddingRight: layout.rowInset,
    paddingVertical: spacing[8],
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderColor: "transparent",
  },
  copy: { flex: 1, minWidth: 0 },
});
