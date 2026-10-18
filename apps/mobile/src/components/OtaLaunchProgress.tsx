import React from "react";
import { StyleSheet, View } from "react-native";
import type { OtaLaunchPhase } from "../lib/automatic-ota-update";
import { progressFraction } from "../lib/progress-fraction";
import { spacing } from "../theme/tokens";
import { Text } from "./ui/Text";
import { LinearProgress } from "./ui/LinearProgress";

/** Quiet, prompt-free startup status. Percentages come only from native bytes. */
export function OtaLaunchProgress({ phase, progress }: { phase: NonNullable<OtaLaunchPhase>; progress?: number }) {
  const downloading = phase === "downloading";
  const applying = phase === "applying";
  const percent = downloading && progress != null ? Math.round(progressFraction(progress) * 100) : null;
  return (
    <View style={styles.root} testID="ota-launch-progress">
      <Text variant="titleMedium" align="center" accessibilityLiveRegion="polite">
        {applying ? "Opening updated app…" : downloading ? "Updating Ordo" : "Checking for updates"}
      </Text>
      <View style={styles.progress}>
        <View style={styles.meta}>
          <Text variant="bodyMedium" color="secondary">
            {applying ? "Ready to go" : downloading ? "Downloading update" : "Getting things ready"}
          </Text>
          {percent != null ? <Text variant="labelLarge" color="accent">{percent}%</Text> : null}
        </View>
        <LinearProgress wavy label={applying ? "Applying update" : downloading ? "Downloading app update" : "Checking for updates"}
          value={applying ? 1 : downloading ? progress : undefined} />
      </View>
      <Text variant="bodyMedium" color="secondary" align="center">
        Your library will open automatically.
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { width: "100%", maxWidth: 320, gap: spacing[24] },
  progress: { gap: spacing[12] },
  meta: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: spacing[16] },
});
