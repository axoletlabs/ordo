/** Unified About-page update row for OTA bundles and native app releases. */
import React from "react";
import { StyleSheet } from "react-native";
import { Button } from "./Button";
import { SettingRow } from "./SettingRow";
import { toast } from "./toast-store";
import { useAppUpdate } from "../../hooks/use-app-update";
import { layout } from "../../theme/tokens";

export function OtaUpdateCard() {
  const update = useAppUpdate();
  const { ota, native } = update;
  const manualCheck = React.useRef(false);

  React.useEffect(() => {
    if (!manualCheck.current) return;
    if (update.checking) return;

    manualCheck.current = false;
    if (update.action !== "check") return;
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
  }, [native.error, ota.message, update.action, update.check, update.checking, update.error]);

  const buttonLabel =
    update.checking && update.action === "check"
      ? "Checking…"
      : update.action === "download"
        ? "Download"
        : update.action === "restart"
          ? "Restart"
          : "Check";

  const busy = update.downloading || (update.checking && update.action === "check");

  return (
    <SettingRow
      icon="cloud-download-outline"
      label="App updates"
      description={!update.enabled ? "Available in production builds" : undefined}
      right={
        <Button
          label={buttonLabel}
          size="md"
          loading={busy}
          disabled={!update.enabled}
          style={styles.checkButton}
          onPress={() => {
            if (update.action === "download") {
              if (update.kind === "native") {
                void native
                  .downloadAndInstall()
                  .catch(() => toast.error("Couldn't download the update."));
                return;
              }
              void ota.download().catch(() => toast.error("Couldn't download the update."));
              return;
            }
            if (update.action === "restart") {
              if (update.kind === "native") {
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
              void ota.restart().catch(() => toast.error("Couldn't restart to apply the update."));
              return;
            }
            manualCheck.current = true;
            void update.check().catch(() => {});
          }}
        />
      }
    />
  );
}

const styles = StyleSheet.create({
  checkButton: { width: layout.settingsControlWidth },
});
