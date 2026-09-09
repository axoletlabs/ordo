/** About-page rows for OTA bundles and native app releases. Both stay visible. */
import React from "react";
import { StyleSheet } from "react-native";
import { Button } from "./Button";
import { SettingRow } from "./SettingRow";
import { toast } from "./toast-store";
import { useAppUpdate } from "../../hooks/use-app-update";
import type { AppUpdatePhase } from "../../lib/app-update-action";
import { layout } from "../../theme/tokens";

function phaseLabel(phase: AppUpdatePhase): string {
  if (phase.action === "download") return "Download";
  if (phase.action === "install") return "Install";
  return "Restart";
}

export function OtaUpdateCard() {
  const update = useAppUpdate();
  const { ota, native, phases } = update;
  const manualCheck = React.useRef(false);

  React.useEffect(() => {
    if (!manualCheck.current) return;
    if (update.checking) return;

    manualCheck.current = false;
    if (phases.length > 0) return;
    if (update.error) {
      toast.show(ota.message ?? native.error ?? "Couldn't check for updates.", {
        tone: "danger",
        duration: 5000,
        action: {
          label: "Retry",
          onPress: () => {
            manualCheck.current = true;
            void update.check().catch(() => {});
          },
        },
      });
      return;
    }
    toast.show("You're up to date", { tone: "success", duration: 3000 });
  }, [native.error, ota.message, phases.length, update.check, update.checking, update.error]);

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
    const busy = update.checking;
    return (
      <SettingRow
        icon="cloud-download-outline"
        label="App updates"
        description={!update.enabled ? "Available in production builds" : undefined}
        right={
          <Button
            label={busy ? "Checking…" : "Check"}
            size="md"
            loading={busy}
            disabled={!update.enabled}
            style={styles.checkButton}
            onPress={() => {
              manualCheck.current = true;
              void update.check().catch(() => {});
            }}
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
        const nativeVersion = native.release ? `v${native.release.version}` : "app";
        return (
          <SettingRow
            key={`${phase.kind}-${phase.action}`}
            icon={phase.kind === "native" ? "phone-portrait-outline" : "cloud-download-outline"}
            label={phase.kind === "native" ? "Install update" : "App update"}
            description={
              phase.kind === "native"
                ? `${nativeVersion} APK`
                : phase.action === "restart"
                  ? "Restart to apply"
                  : "Download and restart"
            }
            right={
              <Button
                label={phaseLabel(phase)}
                size="md"
                loading={busy}
                disabled={!update.enabled}
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
  checkButton: { width: layout.settingsControlWidth },
});
