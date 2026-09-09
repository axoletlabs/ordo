/**
 * Announces each actionable update once per artifact. Renderless.
 * OTA and native toasts are independent so one never hides the other.
 */
import { useEffect, useRef } from "react";
import { APP_NAME } from "@ordo/shared";
import { useAppUpdate } from "../hooks/use-app-update";
import { restartForUpdate } from "../store/update-restart";
import { toast } from "./ui/toast-store";
import { haptics } from "../lib/haptics";

const UPDATE_TOAST_DURATION = 3000;

export function UpdateReadyWatcher() {
  const update = useAppUpdate();
  const { ota, native } = update;
  const lastNativeDownloadShown = useRef<string | null>(null);
  const lastNativeInstallShown = useRef<string | null>(null);
  const lastAvailableShown = useRef<string | null>(null);
  const lastReadyShown = useRef<string | null>(null);

  useEffect(() => {
    if (!native.release || native.showProgress) return;
    if (native.status === "downloading") return;
    if (native.status !== "available") return;
    if (native.release.tagName === lastNativeDownloadShown.current) return;
    lastNativeDownloadShown.current = native.release.tagName;

    haptics.light();
    toast.show(`${APP_NAME} v${native.release.version} is available`, {
      duration: 6000,
      swipeable: true,
      action: {
        label: "Download",
        onPress: () =>
          native.downloadAndInstall().catch(() => toast.error("Couldn't download the update.")),
      },
    });
  }, [native.downloadAndInstall, native.release, native.showProgress, native.status]);

  useEffect(() => {
    if (!native.release || native.showProgress) return;
    if (native.status !== "downloaded" || !native.downloadedUri) return;
    if (native.release.tagName === lastNativeInstallShown.current) return;
    lastNativeInstallShown.current = native.release.tagName;

    haptics.light();
    toast.show(`${APP_NAME} v${native.release.version} is ready to install`, {
      duration: 6000,
      swipeable: true,
      action: {
        label: "Install",
        onPress: () =>
          native.install().catch(() => toast.error("Couldn't open the installer.")),
      },
    });
  }, [
    native.downloadedUri,
    native.install,
    native.release,
    native.showProgress,
    native.status,
  ]);

  useEffect(() => {
    if (!ota.enabled || ota.status !== "available") return;
    const key = ota.availableUpdateId ?? "__available";
    if (key === lastAvailableShown.current) return;
    lastAvailableShown.current = key;

    haptics.light();
    toast.show("A new update is available", {
      duration: 6000,
      swipeable: true,
      action: {
        label: "Download",
        onPress: () => ota.download().catch(() => toast.error("Couldn't download the update.")),
      },
    });
  }, [ota.availableUpdateId, ota.download, ota.enabled, ota.status]);

  useEffect(() => {
    if (!ota.enabled || ota.status !== "ready") return;
    const key = ota.pendingUpdateId ?? "__pending";
    if (key === lastReadyShown.current) return;
    lastReadyShown.current = key;

    haptics.light();
    toast.show("Update ready — restart to apply", {
      duration: UPDATE_TOAST_DURATION,
      swipeable: true,
      action: {
        label: "Restart",
        onPress: () => {
          if (!ota.enabled) return;
          restartForUpdate().catch(() => toast.error("Couldn't restart to apply the update."));
        },
      },
    });
  }, [ota.enabled, ota.status, ota.pendingUpdateId]);

  return null;
}
