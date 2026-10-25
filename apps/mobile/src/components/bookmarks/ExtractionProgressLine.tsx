/**
 * Quiet library-line progress for background article fetches after an import
 * (or a burst of new saves). Hidden for a single pending bookmark — the row
 * spinner already covers that.
 */
import React from "react";
import { StyleSheet, View } from "react-native";
import { Text } from "../ui/Text";
import { AnimatedDisclosure } from "../ui/AnimatedDisclosure";
import { useColumnPadding } from "../../hooks/use-scene-column-insets";
import { layout, spacing } from "../../theme/tokens";
import { LinearProgress } from "../ui/LinearProgress";
import { useExtractionProgress } from "../../hooks/use-extraction-progress";

export function ExtractionProgressLine({ maxWidth = layout.maxContentWidth }: { maxWidth?: number }) {
  const column = useColumnPadding(maxWidth);
  const { data } = useExtractionProgress();
  const active = !!data && data.pending > 0 && data.total >= 2;
  const ratio = active && data ? (data.total === 0 ? 0 : Math.min(1, data.completed / data.total)) : 0;

  return (
    <AnimatedDisclosure expanded={active}>
      <View
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
          Fetching articles · {data?.completed ?? 0} of {data?.total ?? 0}
        </Text>
        <LinearProgress value={ratio} label={`Fetching articles, ${data?.completed ?? 0} of ${data?.total ?? 0}`} />
      </View>
    </AnimatedDisclosure>
  );
}

const styles = StyleSheet.create({
  wrap: {
    width: "100%",
    alignSelf: "center",
    paddingBottom: spacing[10],
    gap: spacing[8],
  },
});
