import type { TelemetryPlatform } from "@ordo/shared";

export const TELEMETRY_PING_INTERVAL_MS = 24 * 60 * 60 * 1000;

export function shouldPing(
  lastPingAt: number | null,
  now: number,
  intervalMs = TELEMETRY_PING_INTERVAL_MS,
): boolean {
  if (lastPingAt == null || lastPingAt > now) return true;
  return now - lastPingAt >= intervalMs;
}

export function telemetryPlatform(os: string): TelemetryPlatform {
  if (os === "android" || os === "ios" || os === "web") return os;
  return "other";
}

export function isTelemetryInstallId(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
    value,
  );
}
