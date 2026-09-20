import type { TelemetryPlatform } from "@ordo/shared";

export const TELEMETRY_PING_INTERVAL_MS = 24 * 60 * 60 * 1000;

export interface TelemetryWebHints {
  userAgent?: string;
  maxTouchPoints?: number;
}

export function shouldPing(
  lastPingAt: number | null,
  now: number,
  intervalMs = TELEMETRY_PING_INTERVAL_MS,
): boolean {
  if (lastPingAt == null || lastPingAt > now) return true;
  return now - lastPingAt >= intervalMs;
}

/**
 * Native APK/IPA stay android/ios. A browser on a phone is web-android /
 * web-ios so Chrome-on-Android is not counted as the Android app. The user
 * agent never leaves the device — only this bucket is sent.
 */
export function telemetryPlatform(
  os: string,
  hints: TelemetryWebHints = {},
): TelemetryPlatform {
  if (os === "android" || os === "ios") return os;
  if (os !== "web") return "other";
  const ua = hints.userAgent?.trim();
  if (!ua) return "web";
  return webSurface(ua, hints.maxTouchPoints ?? 0);
}

export function existingOrNewInstallId(
  saved: string | null | undefined,
  mint: () => string,
): string {
  if (typeof saved === "string" && isTelemetryInstallId(saved)) return saved;
  return mint();
}

export function isTelemetryInstallId(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
    value,
  );
}

function webSurface(userAgent: string, maxTouchPoints: number): TelemetryPlatform {
  const hay = userAgent.toLowerCase();
  if (hay.includes("electron")) return "desktop";
  if (/iphone|ipod/.test(hay)) return "web-ios";
  if (/ipad/.test(hay) || (hay.includes("mac") && maxTouchPoints > 1)) return "web-ios";
  if (hay.includes("android")) return "web-android";
  if (hay.includes("mobile") && !hay.includes("ipad")) return "web";
  return "web-desktop";
}
