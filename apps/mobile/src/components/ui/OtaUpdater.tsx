/** About-page rows for OTA bundles and native app releases. Both stay visible. */
import React from "react";
import { StyleSheet, View } from "react-native";
import { Button } from "./Button";
import { SettingRow } from "./SettingRow";
import { toast } from "./toast-store";
import { useAppUpdate } from "../../hooks/use-app-update";
import type { AppUpdatePhase } from "../../lib/app-update-action";
import { useUpdateRestartStore } from "../../store/update-restart";
import { LinearProgress } from "./LinearProgress";
import { spacing } from "../../theme/tokens";

function phaseLabel(phase: AppUpdatePhase): string {
  if (phase.action === "download") return "Download";
  if (phase.action === "install") return "Install";
  return "Restart";
}

export function OtaUpdateCard() {
  const update = useAppUpdate();
  const { ota, native, phases } = update;
  const [manualChecking, setManualChecking] = React.useState(false);
  const checkInFlight = React.useRef(false);
  const restarting = useUpdateRestartStore((state) => state.restarting);
  const check = async () => {
    if (checkInFlight.current) return;
    checkInFlight.current = true;
    setManualChecking(true);
    try {
      const available = await update.check();
      if (!available) toast.show("You're up to date", { tone: "success", duration: 3000 });
    } catch (error) {
      toast.show(error instanceof Error ? error.message : "Couldn't check for updates.", {
        tone: "danger",
        duration: 5000,
        action: {
          label: "Retry",
          onPress: () => { void check(); },
        },
      });
    } finally {
      checkInFlight.current = false;
      setManualChecking(false);
    }
  };

  const runPhase = (phase: AppUpdatePhase) => {
    if (phase.kind === "native" && phase.action === "download") {
      void native.downloadAndInstall().catch(() => toast.error("Couldn't download the update."));
      return;
    }
    if (phase.kind === "native") {
      void native.install().catch((error) => {
        const missing =
          error instanceof Error && error.message.includes("no longer on the device");
        if (missing) {
          void native
            .downloadAndInstall()
            .catch(() => toast.error("Couldn't download the update."));
          return;
        }
        toast.error("Couldn't open the installer.");
      });
      return;
    }
  };

  const busy = update.checking || manualChecking || ota.status === "downloading";
  const ready = ota.status === "ready";
  const description = ota.status === "downloading" ? "Downloading automatically…"
    : ready ? "Ready for your next launch. Or restart now."
      : ota.message ? "Couldn't update. We'll try again automatically."
        : "Updates download and apply automatically on startup.";

  return (
    <>
      <SettingRow
        icon="cloud-download-outline"
        label="App updates"
        description={ota.enabled ? description : "Check for a new app version."}
        right={
          <Button
            label={ready ? "Restart now" : busy ? ota.status === "downloading" ? "Downloading…" : "Checking…" : "Check"}
            size="md"
            loading={busy || restarting}
            disabled={!update.enabled || busy || update.downloading || native.installing || restarting}
            style={styles.checkButton}
            onPress={() => {
              if (ready) void ota.restart().catch(() => toast.error("Couldn't restart to apply the update."));
              else void check();
            }}
          />
        }
      />
      {ota.status === "downloading" ? (
        <View style={styles.progress}>
          <LinearProgress wavy label="Downloading app update" value={ota.downloadProgress} />
        </View>
      ) : null}
      {phases.filter((phase) => phase.kind === "native").map((phase) => {
        const nativeBusy =
          phase.kind === "native" &&
          (native.status === "downloading" || native.installing);
        return (
          <SettingRow
            key={phase.kind}
            icon={phase.kind === "native" ? "phone-portrait-outline" : "cloud-download-outline"}
            label={phase.kind === "native" ? "Install update" : "App update"}
            right={
              <Button
                label={phaseLabel(phase)}
                size="md"
                loading={nativeBusy}
                disabled={!update.enabled || update.checking || manualChecking || update.downloading || native.installing || restarting}
                style={styles.checkButton}
                onPress={() => runPhase(phase)}
              />
            }
          />
        );
      })}
    </>
  );
}

const styles = StyleSheet.create({
  checkButton: { width: "100%" },
  progress: { paddingHorizontal: spacing[16], paddingVertical: spacing[16] },
});
