/**
 * Anonymous once-a-day install ping to ordo Cloud.
 * Counts app installs (including self-host). No account, email, or server URL.
 */
import { Platform } from "react-native";
import Constants from "expo-constants";
import * as Crypto from "expo-crypto";
import { TelemetryRoutes, type TelemetryHeartbeatInput } from "@ordo/shared";
import { CLOUD_SERVER_URL, resolvePersistedServerUrl, telemetryHosting } from "./hosting";
import { prefsGet, prefsSet, StorageKeys } from "./storage";
import { useSettingsStore } from "../store/settings";
import { useOnlineStore } from "./online";
import {
  REQUEST_HARD_TIMEOUT_MS,
  REQUEST_TIMEOUT_MS,
  createTimeoutSignal,
  raceDeadline,
} from "./fetch-timeout";
import {
  isTelemetryInstallId,
  shouldPing,
  telemetryPlatform,
} from "./telemetry-policy";

const RETRY_GAP_MS = 15 * 60 * 1000;

interface TelemetryPrefs {
  installId: string;
  lastPingAt: number | null;
}

let inflight: Promise<void> | null = null;
let lastAttemptAt = 0;

export { shouldPing, telemetryPlatform } from "./telemetry-policy";

export function telemetryAppVersion(): string {
  const version = Constants.nativeAppVersion ?? Constants.expoConfig?.version ?? "unknown";
  return version.trim().slice(0, 32) || "unknown";
}

export async function pingCloudTelemetry(now = Date.now()): Promise<void> {
  if (inflight) return inflight;
  inflight = runPing(now).finally(() => {
    inflight = null;
  });
  return inflight;
}

async function runPing(now: number): Promise<void> {
  if (!useOnlineStore.getState().online) return;
  if (now - lastAttemptAt < RETRY_GAP_MS) return;
  lastAttemptAt = now;

  const saved = await prefsGet<TelemetryPrefs>(StorageKeys.TELEMETRY);
  if (!shouldPing(saved?.lastPingAt ?? null, now)) return;

  const installId =
    saved?.installId && isTelemetryInstallId(saved.installId)
      ? saved.installId
      : Crypto.randomUUID();
  const payload: TelemetryHeartbeatInput = {
    installId,
    platform: telemetryPlatform(Platform.OS),
    hosting: telemetryHosting(await resolveServerUrl()),
    appVersion: telemetryAppVersion(),
  };

  const timeout = createTimeoutSignal(REQUEST_TIMEOUT_MS);
  try {
    const response = await raceDeadline(
      fetch(`${CLOUD_SERVER_URL}${TelemetryRoutes.heartbeat.path}`, {
        method: TelemetryRoutes.heartbeat.method,
        headers: { Accept: "application/json", "Content-Type": "application/json" },
        body: JSON.stringify(payload),
        credentials: "omit",
        signal: timeout.signal,
      }),
      REQUEST_HARD_TIMEOUT_MS,
    );
    if (!response.ok) return;
    await prefsSet(StorageKeys.TELEMETRY, { installId, lastPingAt: now });
  } catch {
    /* best-effort — retry on a later launch */
  } finally {
    timeout.clear();
  }
}

async function resolveServerUrl(): Promise<string> {
  const settings = useSettingsStore.getState();
  if (settings.hydrated) return settings.serverUrl;
  const saved = await prefsGet<{ serverUrl?: string }>(StorageKeys.SETTINGS);
  return resolvePersistedServerUrl(saved?.serverUrl);
}
