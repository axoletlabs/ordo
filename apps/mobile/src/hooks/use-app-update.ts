import { useCallback, useEffect } from "react";
import { AppState } from "react-native";
import { useNativeUpdateStore } from "../store/native-update";
import { resolveAppUpdateAction } from "../lib/app-update-action";

const FOREGROUND_RECHECK_MS = 60 * 60 * 1000;
let lastNativeForegroundCheck = 0;

export function useAppUpdate() {
  const native = useNativeUpdateStore();

  useEffect(() => {
    const runCheck = () => {
      const now = Date.now();
      if (now - lastNativeForegroundCheck < FOREGROUND_RECHECK_MS) return;
      lastNativeForegroundCheck = now;
      void native.check().catch(() => { lastNativeForegroundCheck = 0; });
    };
    runCheck();
    const subscription = AppState.addEventListener("change", (state) => {
      if (state === "active") runCheck();
    });
    return () => subscription.remove();
  }, [native.check, native.hydrate]);

  const resolved = resolveAppUpdateAction({
    // OTA is intentionally absent from all user-facing update state/actions.
    otaStatus: "disabled",
    otaAvailableAt: null,
    otaPendingAt: null,
    nativeStatus: native.status,
    nativeRelease: native.release,
    nativeDownloaded: !!native.downloadedUri,
  });

  const checkNative = native.check;
  const check = useCallback(async () => !!(await checkNative(true)), [checkNative]);

  const error = !!native.error;

  return {
    native,
    action: resolved.action,
    kind: resolved.kind,
    phases: resolved.phases,
    checking: resolved.checking,
    downloading: resolved.downloading,
    error,
    enabled: native.status !== "disabled",
    check,
  } as const;
}
