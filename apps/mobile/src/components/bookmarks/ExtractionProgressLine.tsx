/**
 * Quiet library-line progress for background article fetches after an import
 * (or a burst of new saves). Hidden for a single pending bookmark — the row
 * spinner already covers that.
 */
import React from "react";
import { StyleSheet, View } from "react-native";
import { Text } from "../ui/Text";
import { useTheme } from "../../theme/ThemeProvider";
import { useColumnPadding } from "../../hooks/use-scene-column-insets";
import { layout, radius, spacing } from "../../theme/tokens";
import { useExtractionProgress } from "../../hooks/use-extraction-progress";

export function ExtractionProgressLine({ maxWidth = layout.maxContentWidth }: { maxWidth?: number }) {
  const { palette } = useTheme();
  const column = useColumnPadding(maxWidth);
  const { data } = useExtractionProgress();
  if (!data || data.pending <= 0 || data.total < 2) return null;

  const ratio = data.total === 0 ? 0 : Math.min(1, data.completed / data.total);

  return (
    <View
      accessibilityRole="progressbar"
      accessibilityLabel={`Fetching articles, ${data.completed} of ${data.total}`}
      style={[
        styles.wrap,
        {
          maxWidth,
          paddingLeft: column.left,
          paddingRight: column.right,
        },
      ]}
    >
      <Text variant="footnote" color="secondary">
        Fetching articles · {data.completed} of {data.total}
      </Text>
      <View style={[styles.track, { backgroundColor: palette.surfaceSecondary }]}>
        <View
          style={[
            styles.fill,
            { width: `${Math.max(4, ratio * 100)}%`, backgroundColor: palette.accent },
          ]}
        />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    width: "100%",
    alignSelf: "center",
    paddingBottom: spacing[10],
    gap: spacing[8],
  },
  track: {
    height: 3,
    borderRadius: radius.full,
    overflow: "hidden",
  },
  fill: {
    height: 3,
    borderRadius: radius.full,
  },
});
