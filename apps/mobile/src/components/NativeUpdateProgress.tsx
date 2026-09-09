import React from "react";
import { StyleSheet, View } from "react-native";
import { APP_NAME } from "@ordo/shared";
import { FloatingPanel } from "./ui/FloatingPanel";
import { PanelHeader } from "./ui/PanelHeader";
import { Text } from "./ui/Text";
import { PanelActions } from "./ui/SheetActionRow";
import { toast } from "./ui/toast-store";
import { useNativeUpdateStore } from "../store/native-update";
import { useTheme } from "../theme/ThemeProvider";
import { radius, spacing } from "../theme/tokens";

export function NativeUpdateProgress() {
  const { palette } = useTheme();
  const update = useNativeUpdateStore();
  const visible =
    update.showProgress &&
    (update.status === "downloading" ||
      (update.status === "downloaded" && !!update.downloadedUri) ||
      (update.status === "error" && (!!update.downloadedUri || update.progress > 0)));
  const downloading = update.status === "downloading";
  const downloadFailed = update.status === "error" && !update.downloadedUri;
  const percent = Math.round(update.progress * 100);

  return (
    <FloatingPanel
      visible={visible}
      onDismiss={downloading ? () => {} : update.dismissDownload}
      maxWidth={380}
    >
      <PanelHeader
        icon="phone-portrait-outline"
        iconColor={palette.accent}
        iconBackground={palette.accentSoft}
        title={
          downloading
            ? "Downloading update"
            : downloadFailed
              ? "Download interrupted"
              : "Ready to install"
        }
        subtitle={
          downloading
            ? `Keep ${APP_NAME} open.`
            : downloadFailed
              ? "Your current version is unchanged."
              : `${APP_NAME} v${update.release?.version ?? ""} is ready.`
        }
      />

      {downloading ? (
        <View style={styles.progressSection}>
          <View style={[styles.progressTrack, { backgroundColor: palette.surfaceSecondary }]}>
            <View
              style={[
                styles.progressFill,
                { backgroundColor: palette.accent, width: `${percent}%` },
              ]}
            />
          </View>
          <View style={styles.progressMeta}>
            <Text variant="monoSmall" color="secondary">Downloading</Text>
            <Text variant="monoSmall" color="accent">{percent}%</Text>
          </View>
        </View>
      ) : downloadFailed ? (
        <View style={styles.actions}>
          <Text variant="footnote" color="danger" align="center" style={styles.error}>
            {update.error ?? "Couldn't download the update."}
          </Text>
          <PanelActions
            confirmLabel="Retry"
            cancelLabel="Later"
            onConfirm={() =>
              update
                .downloadAndInstall()
                .catch(() => toast.error("Couldn't download the update."))
            }
            onCancel={update.dismissDownload}
          />
        </View>
      ) : (
        <View style={styles.actions}>
          {update.error ? (
            <Text variant="footnote" color="danger" align="center" style={styles.error}>
              {update.error}
            </Text>
          ) : null}
          <PanelActions
            confirmLabel="Open installer"
            cancelLabel="Later"
            onConfirm={() =>
              update.install().catch(() => toast.error("Couldn't open the installer."))
            }
            onCancel={update.dismissDownload}
          />
        </View>
      )}
    </FloatingPanel>
  );
}

const styles = StyleSheet.create({
  progressSection: { marginTop: spacing[4] },
  progressTrack: { height: 8, borderRadius: radius.full, overflow: "hidden" },
  progressFill: { height: "100%", borderRadius: radius.full },
  progressMeta: {
    marginTop: spacing[8],
    flexDirection: "row",
    justifyContent: "space-between",
  },
  actions: { marginTop: spacing[12], gap: spacing[4] },
  error: { marginBottom: spacing[12] },
});
