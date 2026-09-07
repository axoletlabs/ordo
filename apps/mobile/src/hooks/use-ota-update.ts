/**
 * OTA update state, derived reactively from expo-updates' `useUpdates()` so it
 * always reflects the native module's truth: a downloaded update stays "ready"
 * across remounts (the previous useState-driven version lost that). Actions
 * route through the `Updates` module, whose emitted events drive the reactive
 * state. expo-updates is disabled in dev builds, so everything guards on
 * `enabled` and surfaces a disabled state.
 */
import { useCallback, useEffect } from "react";
import { AppState } from "react-native";
import * as Updates from "expo-updates";
import { restartForUpdate } from "../store/update-restart";

export type OtaStatus =
  | "disabled"
  | "idle"
  | "checking"
  | "up-to-date"
  | "available"
  | "downloading"
  | "ready"
  | "error";

export interface UseOtaUpdate {
  enabled: boolean;
  status: OtaStatus;
  message: string | null;
  /** EAS Update channel the build is configured for, if any. */
  channel: string | null;
  /** Runtime fingerprint (compatibility key) for the current build. */
  runtimeVersion: string | null;
  /** True when the running code is the binary's embedded bundle (not an OTA). */
  isEmbeddedLaunch: boolean;
  /** Update id of the currently running OTA bundle, if any. */
  runningUpdateId: string | null;
  /** Publish time of the running OTA bundle, if any. */
  runningUpdateCreatedAt: Date | null;
  /** Update id of the most recently downloaded (pending) update, if any. */
  pendingUpdateId: string | null;
  pendingUpdateCreatedAt: Date | null;
  /** Update id advertised by the latest check, before it is downloaded. */
  availableUpdateId: string | null;
  availableUpdateCreatedAt: Date | null;
  /** When we last checked for an update this session. */
  lastChecked: Date | null;
  check: () => Promise<void>;
  download: () => Promise<void>;
  restart: () => Promise<void>;
}

/** Minimum gap between automatic foreground checks. */
const FOREGROUND_RECHECK_MS = 60 * 60 * 1000;
let lastForegroundCheck = 0;

export function useOtaUpdate(): UseOtaUpdate {
  const enabled = Updates.isEnabled;
  const {
    currentlyRunning,
    isChecking,
    isDownloading,
    isUpdateAvailable,
    isUpdatePending,
    availableUpdate,
    downloadedUpdate,
    checkError,
    downloadError,
    initializationError,
    lastCheckForUpdateTimeSinceRestart,
  } = Updates.useUpdates();

  // Auto-check on first mount and when the app returns to the foreground
  // (throttled), so updates are picked up without a manual tap.
  useEffect(() => {
    if (!enabled) return;

    const runCheck = () => {
      const now = Date.now();
      if (now - lastForegroundCheck < FOREGROUND_RECHECK_MS) return;
      lastForegroundCheck = now;
      Updates.checkForUpdateAsync().catch(() => {});
    };

    runCheck();

    const sub = AppState.addEventListener("change", (state) => {
      if (state === "active") runCheck();
    });
    return () => sub.remove();
  }, [enabled]);

  const runningId = currentlyRunning.updateId ?? null;
  const availableId = availableUpdate?.updateId ?? null;
  const pendingId = downloadedUpdate?.updateId ?? null;
  // A pending bundle that's older than the one just advertised should Download,
  // not Restart into the stale copy. Same-id available+pending is Restart.
  const newerThanPending =
    isUpdateAvailable &&
    availableId != null &&
    availableId !== runningId &&
    availableId !== pendingId;

  const status: OtaStatus = (() => {
    if (!enabled) return "disabled";
    if (isDownloading) return "downloading";
    if (newerThanPending) return "available";
    if (isUpdatePending) return "ready";
    if (isChecking) return "checking";
    if (isUpdateAvailable) return "available";
    if (checkError || downloadError || initializationError) return "error";
    if (lastCheckForUpdateTimeSinceRestart) return "up-to-date";
    return "idle";
  })();

  const message =
    checkError?.message ?? downloadError?.message ?? initializationError?.message ?? null;

  const check = useCallback(async () => {
    if (!enabled) return;
    await Updates.checkForUpdateAsync();
  }, [enabled]);

  const download = useCallback(async () => {
    if (!enabled) return;
    await Updates.fetchUpdateAsync();
  }, [enabled]);

  const restart = useCallback(async () => {
    if (!enabled) return;
    // Reloads into the downloaded update after the branded fallback paints.
    await restartForUpdate();
  }, [enabled]);

  return {
    enabled,
    status,
    message,
    channel: currentlyRunning.channel ?? Updates.channel ?? null,
    runtimeVersion: currentlyRunning.runtimeVersion ?? Updates.runtimeVersion ?? null,
    isEmbeddedLaunch: currentlyRunning.isEmbeddedLaunch,
    runningUpdateId: currentlyRunning.updateId ?? null,
    runningUpdateCreatedAt: currentlyRunning.createdAt ?? null,
    pendingUpdateId: downloadedUpdate?.updateId ?? null,
    pendingUpdateCreatedAt: downloadedUpdate?.createdAt ?? null,
    availableUpdateId: availableUpdate?.updateId ?? null,
    availableUpdateCreatedAt: availableUpdate?.createdAt ?? null,
    lastChecked: lastCheckForUpdateTimeSinceRestart ?? null,
    check,
    download,
    restart,
  };
}
