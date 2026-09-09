import { useCallback, useEffect } from "react";
import { AppState } from "react-native";
import { useOtaUpdate } from "./use-ota-update";
import { useNativeUpdateStore } from "../store/native-update";
import { resolveAppUpdateAction } from "../lib/app-update-action";

const FOREGROUND_RECHECK_MS = 60 * 60 * 1000;
let lastNativeForegroundCheck = 0;

export function useAppUpdate() {
  const ota = useOtaUpdate();
  const native = useNativeUpdateStore();

  useEffect(() => {
    void native.hydrate();
    const runCheck = () => {
      const now = Date.now();
      if (now - lastNativeForegroundCheck < FOREGROUND_RECHECK_MS) return;
      lastNativeForegroundCheck = now;
      void native.check().catch(() => {});
    };
    runCheck();
    const subscription = AppState.addEventListener("change", (state) => {
      if (state === "active") runCheck();
    });
    return () => subscription.remove();
  }, [native.check, native.hydrate]);

  const resolved = resolveAppUpdateAction({
    otaStatus: ota.status,
    otaAvailableAt: ota.availableUpdateCreatedAt,
    otaPendingAt: ota.pendingUpdateCreatedAt,
    nativeStatus: native.status,
    nativeRelease: native.release,
    nativeDownloaded: !!native.downloadedUri,
  });

  const checkOta = ota.check;
  const checkNative = native.check;
  const check = useCallback(async () => {
    const results = await Promise.allSettled([checkOta(), checkNative(true)]);
    if (results.every((result) => result.status === "rejected")) {
      throw (results[0] as PromiseRejectedResult).reason;
    }
  }, [checkNative, checkOta]);

  const error = !!(ota.message || native.error);

  return {
    ota,
    native,
    action: resolved.action,
    kind: resolved.kind,
    phases: resolved.phases,
    checking: resolved.checking,
    downloading: resolved.downloading,
    error,
    enabled: ota.enabled || native.status !== "disabled",
    check,
  } as const;
}
