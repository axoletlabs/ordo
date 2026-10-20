/** Only full app releases are user-facing. OTA never changes this UI. */
import React from "react";
import { StyleSheet } from "react-native";
import { Button } from "./Button";
import { SettingRow } from "./SettingRow";
import { toast } from "./toast-store";
import { useAppUpdate } from "../../hooks/use-app-update";
import type { AppUpdatePhase } from "../../lib/app-update-action";
import { useUpdateRestartStore } from "../../store/update-restart";

function phaseLabel(phase: AppUpdatePhase): string {
  if (phase.action === "download") return "Download";
  return "Install";
}

export function OtaUpdateCard() {
  const update = useAppUpdate();
  const { native, phases } = update;
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

  const busy = update.checking || manualChecking;

  if (phases.length === 0) {
    return (
      <SettingRow
        icon="cloud-download-outline"
        label="App updates"
        right={
          <Button
            label={busy ? "Checking…" : "Check"}
            size="md"
            loading={busy}
            disabled={!update.enabled || busy || restarting}
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
        return (
          <SettingRow
            key={phase.kind}
            icon="phone-portrait-outline"
            label="Install update"
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
});
