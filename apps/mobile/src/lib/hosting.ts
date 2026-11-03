/**
 * Cloud vs self-host. Fresh installs talk to ordo Cloud. A saved self-host
 * URL is kept; Cloud API hosts are always the HTTPS Cloud origin of their
 * tier (stable / preview / development).
 */
import { APP_VARIANT } from "./app-variant";

/**
 * Hosted API origin per app variant: stable ships the prod door, the preview
 * and development apps get -preview / -dev doors of the same name.
 * Trailing slashes are not part of the origin.
 */
const CLOUD_SERVER_URLS = {
  stable: "https://ordo-cloud.axolet.com",
  preview: "https://ordo-cloud-preview.axolet.com",
  development: "https://ordo-cloud-dev.axolet.com",
} as const;

/** Hosted API origin for this build. */
export const CLOUD_SERVER_URL: string = CLOUD_SERVER_URLS[APP_VARIANT];

/** Every hosted API hostname, mapped to its tier's canonical origin. */
const CLOUD_API_ORIGINS: Readonly<Record<string, string>> = {
  // legacy prod host, DNS removed — kept so saved URLs migrate to the stable origin
  "api.ordo.axolet.com": CLOUD_SERVER_URLS.stable,
  "api-ordo.axolet.com": CLOUD_SERVER_URLS.stable,
  "ordo-api.axolet.com": CLOUD_SERVER_URLS.stable,
  "ordo-cloud.axolet.com": CLOUD_SERVER_URLS.stable,
  "api-ordo-preview.axolet.com": CLOUD_SERVER_URLS.preview,
  "ordo-api-preview.axolet.com": CLOUD_SERVER_URLS.preview,
  "ordo-cloud-preview.axolet.com": CLOUD_SERVER_URLS.preview,
  "api-ordo-dev.axolet.com": CLOUD_SERVER_URLS.development,
  "ordo-api-dev.axolet.com": CLOUD_SERVER_URLS.development,
  "ordo-cloud-dev.axolet.com": CLOUD_SERVER_URLS.development,
};

const CLOUD_ORIGINS = new Set<string>(Object.values(CLOUD_API_ORIGINS));

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

/**
 * Origin for a typed server URL. Cloud API hosts always become the HTTPS
 * Cloud origin of their tier so cleartext cannot be used against ordo Cloud.
 */
export function canonicalizeServerUrl(raw: string): string | null {
  let value = raw.trim();
  if (!value) return null;
  if (!/^https?:\/\//i.test(value)) value = `https://${value}`;
  try {
    const url = new URL(value);
    if (!url.hostname) return null;
    const cloudOrigin = CLOUD_API_ORIGINS[url.hostname.toLowerCase()];
    if (cloudOrigin) return cloudOrigin;
    return url.origin;
  } catch {
    return null;
  }
}

export function isCloudServerUrl(url: string | null | undefined): boolean {
  const origin = url ? originOf(url) : null;
  return origin ? CLOUD_ORIGINS.has(origin) : false;
}

export function hostingModeOf(url: string): HostingMode {
  return isCloudServerUrl(url) ? "cloud" : "selfHosted";
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
  return origin !== null && !CLOUD_ORIGINS.has(origin);
}
