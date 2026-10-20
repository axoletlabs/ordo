import { useEffect } from "react";
import { AppState } from "react-native";
import { createAutomaticOtaUpdater } from "../lib/automatic-ota-update";
import { checkOta, downloadOta, otaUpdatesEnabled } from "../lib/ota-update-actions";
import { useOnlineStore } from "../lib/online";

const updater = createAutomaticOtaUpdater({
  enabled: otaUpdatesEnabled,
  check: checkOta,
  download: downloadOta,
});

/** Mount exactly once in the root, not once for every update-status consumer. */
export function useAutomaticOtaUpdate() {
  useEffect(() => {
    updater.start();
    const subscription = AppState.addEventListener("change", (state) => {
      if (state === "active") updater.refresh();
    });
    const unsubscribe = useOnlineStore.subscribe((state, previous) => {
      if (state.online && !previous.online && AppState.currentState === "active") updater.refresh();
    });
    return () => {
      subscription.remove();
      unsubscribe();
    };
  }, []);
}
