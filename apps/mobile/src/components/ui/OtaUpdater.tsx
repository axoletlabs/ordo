/** About-page rows for OTA bundles and native app releases. Both stay visible. */
import React from "react";
import { StyleSheet } from "react-native";
import { Button } from "./Button";
import { SettingRow } from "./SettingRow";
import { toast } from "./toast-store";
import { useAppUpdate } from "../../hooks/use-app-update";
import type { AppUpdatePhase } from "../../lib/app-update-action";
import { useUpdateRestartStore } from "../../store/update-restart";
import { LinearProgress } from "./LinearProgress";

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
    if (phase.action === "download") {
      void ota.download().catch(() => toast.error("Couldn't download the update."));
      return;
    }
    void ota.restart().catch(() => toast.error("Couldn't restart to apply the update."));
  };

  if (phases.length === 0) {
    const busy = update.checking || manualChecking;
    return (
      <SettingRow
        icon="cloud-download-outline"
        label="App updates"
        right={
          <Button
            label={busy ? "Checking…" : "Check"}
            size="md"
            loading={busy}
            disabled={!update.enabled}
            style={styles.checkButton}
            onPress={() => { void check(); }}
          />
        }
      />
    );
  }

  return (
    <>
      {phases.map((phase) => {
        const nativeBusy =
          phase.kind === "native" &&
          (native.status === "downloading" || native.installing);
        const otaBusy = phase.kind === "ota" && ota.status === "downloading";
        const busy = nativeBusy || otaBusy;
        return (
          <SettingRow
            key={phase.kind}
            icon={phase.kind === "native" ? "phone-portrait-outline" : "cloud-download-outline"}
            label={phase.kind === "native" ? "Install update" : "App update"}
            right={
              <Button
                label={phaseLabel(phase)}
                size="md"
                loading={busy}
                disabled={!update.enabled || update.checking || manualChecking || update.downloading || native.installing || restarting}
                style={styles.checkButton}
                onPress={() => runPhase(phase)}
              />
            }
          />
        );
      })}
      {ota.status === "downloading" ? <LinearProgress wavy label="Downloading app update" value={ota.downloadProgress} /> : null}
    </>
  );
}

const styles = StyleSheet.create({
  checkButton: { width: "100%" },
});
