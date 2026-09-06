/**
 * Announces the newest actionable update once per artifact. Renderless.
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
  const lastNativeShown = useRef<string | null>(null);
  const lastAvailableShown = useRef<string | null>(null);
  const lastReadyShown = useRef<string | null>(null);

  useEffect(() => {
    if (update.kind !== "native" || !native.release) return;
    if (native.release.tagName === lastNativeShown.current) return;
    lastNativeShown.current = native.release.tagName;

    haptics.light();
    toast.show(`${APP_NAME} v${native.release.version} is available`, {
      duration: 6000,
      swipeable: true,
      action: {
        label: "Install",
        onPress: () =>
          native.downloadAndInstall().catch(() => toast.error("Couldn't download the update.")),
      },
    });
  }, [native.downloadAndInstall, native.release, update.kind]);

  useEffect(() => {
    if (update.kind !== "ota" || !ota.enabled || ota.status !== "available") return;
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
  }, [ota.availableUpdateId, ota.download, ota.enabled, ota.status, update.kind]);

  useEffect(() => {
    if (update.kind !== "ota" || !ota.enabled || ota.status !== "ready") return;
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
  }, [ota.enabled, ota.status, ota.pendingUpdateId, update.kind]);

  return null;
}
