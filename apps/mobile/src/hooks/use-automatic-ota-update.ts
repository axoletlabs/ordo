import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { AppState } from "react-native";
import * as Updates from "expo-updates";
import { createAutomaticOtaUpdater } from "../lib/automatic-ota-update";
import { checkOta, downloadOta } from "../lib/ota-update-actions";
import { useOtaUpdate } from "./use-ota-update";
import { useNativeUpdateStore } from "../store/native-update";
import { restartForUpdate } from "../store/update-restart";
import { useIncomingShareStore } from "../store/incoming-share";
import { useOnlineStore } from "../lib/online";

/** Mount exactly once in the root, not once for every update-status consumer. */
export function useAutomaticOtaUpdate() {
  const ota = useOtaUpdate();
  const { restartCount } = Updates.useUpdates();
  const latest = useRef(ota);
  latest.current = ota;
  const [updater] = useState(() => createAutomaticOtaUpdater({
    enabled: ota.enabled,
    alreadyRestarted: restartCount > 0,
    isPending: () => latest.current.status === "ready",
    canApply: () => {
      const native = useNativeUpdateStore.getState();
      return AppState.currentState !== "background" && AppState.currentState !== "inactive" &&
        native.status !== "downloading" && !native.installing &&
        !useIncomingShareStore.getState().pendingUrl;
    },
    check: checkOta,
    download: downloadOta,
    restart: restartForUpdate,
  }));
  const phase = useSyncExternalStore(updater.subscribe, updater.getSnapshot, updater.getSnapshot);

  useEffect(() => {
    updater.start();
    const subscription = AppState.addEventListener("change", (state) => {
      if (state === "active") updater.refresh();
      else updater.release();
    });
    const unsubscribe = useOnlineStore.subscribe((state, previous) => {
      if (state.online && !previous.online && AppState.currentState === "active") updater.refresh();
    });
    return () => {
      subscription.remove();
      unsubscribe();
    };
  }, [updater]);

  return { phase, progress: ota.downloadProgress };
}
