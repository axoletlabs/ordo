import React from "react";
import { StyleSheet, View } from "react-native";
import { APP_NAME } from "@ordo/shared";
import { FloatingPanel } from "./ui/FloatingPanel";
import { PanelHeader } from "./ui/PanelHeader";
import { Text } from "./ui/Text";
import { Button } from "./ui/Button";
import { PanelActions } from "./ui/SheetActionRow";
import { Spinner } from "./ui/Spinner";
import { toast } from "./ui/toast-store";
import {
  openInstallPermissionSettings,
  useNativeUpdateStore,
} from "../store/native-update";
import {
  downloadPercentLabel,
  downloadProgressLabel,
  downloadTrackPercent,
} from "../lib/native-download-progress";
import { useTheme } from "../theme/ThemeProvider";
import { layout, radius, spacing } from "../theme/tokens";

export function NativeUpdateProgress() {
  const { palette } = useTheme();
  const update = useNativeUpdateStore();
  const visible =
    update.showProgress &&
    (update.status === "downloading" ||
      update.installing ||
      update.status === "error" ||
      (update.status === "downloaded" && !!update.downloadedUri));
  const downloading = update.status === "downloading";
  const downloadFailed = update.status === "error" && !update.downloadedUri;
  const installUnfinished = !downloading && !downloadFailed && !!update.error;
  const starting = downloading && update.receivedBytes <= 0;
  const percentLabel = downloadPercentLabel(update.progress);
  const trackPercent = downloadTrackPercent(update.progress, update.receivedBytes);
  const amountLabel = downloadProgressLabel(
    update.receivedBytes,
    update.release?.apkSize ?? 0,
  );

  const close = () => {
    if (update.status === "downloading") update.cancelDownload();
    else update.dismissDownload();
  };

  return (
    <FloatingPanel
      visible={visible}
      onDismiss={close}
      dismissible
      maxWidth={layout.overlayConfirmWidth}
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
              : installUnfinished
                ? "Install didn't finish"
                : "Ready to install"
        }
        subtitle={
          downloading
            ? `Keep ${APP_NAME} open.`
            : downloadFailed
              ? "Your current version is unchanged."
              : installUnfinished
                ? "Your current version is unchanged."
                : `${APP_NAME} v${update.release?.version ?? ""} is ready.`
        }
      />

      {downloading ? (
        <View style={styles.progressSection}>
          <View style={styles.progressMeta}>
            <Text
              variant={starting ? "footnote" : "monoSmall"}
              color="secondary"
              numberOfLines={1}
              style={styles.amount}
            >
              {amountLabel}
            </Text>
            {starting ? (
              <Spinner size="sm" color={palette.accent} />
            ) : (
              <Text variant="monoSmall" color="accent">
                {percentLabel}
              </Text>
            )}
          </View>
          <View
            accessibilityRole="progressbar"
            accessibilityLabel={starting ? "Starting download" : amountLabel}
            accessibilityValue={
              starting ? undefined : { min: 0, max: 100, now: Math.round(update.progress * 100) }
            }
            style={[styles.progressTrack, { backgroundColor: palette.background }]}
          >
            {trackPercent > 0 ? (
              <View style={[styles.progressFill, { flex: trackPercent, backgroundColor: palette.accent }]} />
            ) : null}
            <View style={{ flex: Math.max(0.001, 100 - trackPercent) }} />
          </View>
          <Button
            label="Cancel"
            variant="secondary"
            block
            onPress={update.cancelDownload}
            style={styles.cancel}
          />
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
          {update.installPermissionLikely ? (
            <Button
              label="Allow installs"
              variant="secondary"
              onPress={() =>
                openInstallPermissionSettings().catch(() =>
                  toast.error("Couldn't open Android install settings."),
                )
              }
              style={styles.permissionButton}
            />
          ) : null}
          <PanelActions
            confirmLabel={update.installing ? "Opening…" : "Open installer"}
            cancelLabel="Later"
            loading={update.installing}
            confirmDisabled={update.installing}
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
  progressSection: {
    width: "100%",
  },
  progressMeta: {
    minHeight: 18,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: spacing[12],
    marginBottom: spacing[8],
  },
  amount: { flex: 1 },
  progressTrack: {
    height: 3,
    width: "100%",
    borderRadius: radius.full,
    overflow: "hidden",
    flexDirection: "row",
  },
  progressFill: { height: 3 },
  cancel: { marginTop: spacing[12] },
  actions: { gap: spacing[4] },
  error: { marginBottom: spacing[12] },
  permissionButton: { width: "100%", marginBottom: spacing[8] },
});

