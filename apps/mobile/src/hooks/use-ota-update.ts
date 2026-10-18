/**
 * OTA update state, derived reactively from expo-updates' `useUpdates()` so it
 * always reflects the native module's truth: a downloaded update stays "ready"
 * across remounts. This is read-only build/debug metadata; all fetching is
 * owned by the silent root updater, never by a user-facing update action.
 */
import * as Updates from "expo-updates";
import { resolveOtaStatus, type OtaStatus } from "../lib/ota-update-state";
import { otaUpdatesEnabled } from "../lib/ota-update-actions";

export type { OtaStatus } from "../lib/ota-update-state";

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
  downloadProgress: number | undefined;
}

export function useOtaUpdate(): UseOtaUpdate {
  const enabled = otaUpdatesEnabled;
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
    lastCheckForUpdateTimeSinceRestart,
    downloadProgress,
  } = Updates.useUpdates();

  const runningId = currentlyRunning.updateId ?? null;
  const availableId = availableUpdate?.updateId ?? null;
  const pendingId = downloadedUpdate?.updateId ?? null;
  // A pending bundle that's older than the one just advertised should Download,
  // not Restart into the stale copy. Same-id available+pending is Restart.
  const status = resolveOtaStatus({
    enabled, isChecking, isDownloading, isUpdateAvailable, isUpdatePending,
    runningId, availableId, pendingId,
    availableAt: availableUpdate?.createdAt ?? null,
    pendingAt: downloadedUpdate?.createdAt ?? null,
    hasError: !!(checkError || downloadError),
    hasChecked: !!lastCheckForUpdateTimeSinceRestart,
  });

  const message =
    checkError?.message ?? downloadError?.message ?? null;

  // Web config can expose an unresolved fingerprint policy object despite
  // expo-updates' string type. Only resolved strings are displayable metadata.
  const runtime = currentlyRunning.runtimeVersion ?? Updates.runtimeVersion;
  const channel = currentlyRunning.channel ?? Updates.channel;
  return {
    enabled,
    status,
    message,
    channel: typeof channel === "string" && channel.length > 0 ? channel : null,
    runtimeVersion: typeof runtime === "string" && runtime.length > 0 ? runtime : null,
    isEmbeddedLaunch: currentlyRunning.isEmbeddedLaunch,
    runningUpdateId: currentlyRunning.updateId ?? null,
    runningUpdateCreatedAt: currentlyRunning.createdAt ?? null,
    pendingUpdateId: downloadedUpdate?.updateId ?? null,
    pendingUpdateCreatedAt: downloadedUpdate?.createdAt ?? null,
    availableUpdateId: availableUpdate?.updateId ?? null,
    availableUpdateCreatedAt: availableUpdate?.createdAt ?? null,
    lastChecked: lastCheckForUpdateTimeSinceRestart ?? null,
    downloadProgress,
  };
}
