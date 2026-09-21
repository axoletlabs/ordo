/**
 * Cloud vs self-host. Fresh installs talk to ordo Cloud. A saved self-host
 * URL is kept; Cloud API hosts are always the HTTPS Cloud origin.
 */
import type { TelemetryHosting } from "@ordo/shared";

/** Hosted API origin. Trailing slashes are not part of the origin. */
export const CLOUD_SERVER_URL = "https://api.ordo.axolet.com";
const CLOUD_API_HOST = "api.ordo.axolet.com";

export const CLOUD_DISPLAY_NAME = "ordo Cloud";

/** Public product site. Pretty paths are canonical (`/privacy.html` 308s). */
export const CLOUD_WEBSITE_URL = "https://ordo.axolet.com";
export const CLOUD_TERMS_URL = `${CLOUD_WEBSITE_URL}/terms`;
export const CLOUD_PRIVACY_URL = `${CLOUD_WEBSITE_URL}/privacy`;

/** Product default for new installs (no saved server URL). */
export const DEFAULT_SERVER_URL = CLOUD_SERVER_URL;

export type HostingMode = "cloud" | "selfHosted";

function originOf(raw: string): string | null {
  return canonicalizeServerUrl(raw);
}

function isCloudApiHost(hostname: string): boolean {
  return hostname.toLowerCase() === CLOUD_API_HOST;
}

/**
 * Origin for a typed server URL. Cloud API hosts always become the HTTPS
 * Cloud origin so cleartext cannot be used against ordo Cloud.
 */
export function canonicalizeServerUrl(raw: string): string | null {
  let value = raw.trim();
  if (!value) return null;
  if (!/^https?:\/\//i.test(value)) value = `https://${value}`;
  try {
    const url = new URL(value);
    if (!url.hostname) return null;
    if (isCloudApiHost(url.hostname)) return CLOUD_SERVER_URL;
    return url.origin;
  } catch {
    return null;
  }
}

export function isCloudServerUrl(url: string | null | undefined): boolean {
  return url ? originOf(url) === CLOUD_SERVER_URL : false;
}

export function hostingModeOf(url: string): HostingMode {
  return isCloudServerUrl(url) ? "cloud" : "selfHosted";
}

/** Wire value for the anonymous install ping. Never includes the server URL. */
export function telemetryHosting(url: string): TelemetryHosting {
  return hostingModeOf(url) === "cloud" ? "cloud" : "selfhosted";
}

export function hostingDisplayName(url: string): string {
  return isCloudServerUrl(url) ? CLOUD_DISPLAY_NAME : "Your server";
}

/**
 * Keep whatever the client already stored. Empty / missing falls back to cloud
 * (or whatever default the caller passes).
 */
export function resolvePersistedServerUrl(
  saved: string | null | undefined,
  fallback: string = DEFAULT_SERVER_URL,
): string {
  const trimmed = saved?.trim();
  if (!trimmed) return fallback;
  return canonicalizeServerUrl(trimmed) ?? fallback;
}

/** Cloud is not a self-host destination — send people back to the hosted path. */
export function isSelfHostDestination(url: string | null | undefined): boolean {
  const origin = url ? originOf(url) : null;
  return Boolean(origin) && origin !== CLOUD_SERVER_URL;
}
