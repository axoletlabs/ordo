/**
 * Cloud vs self-host. Fresh installs talk to ordo Cloud; a saved URL is never
 * rewritten. Self-host is opt-in and stays a different origin.
 */

/** Hosted API origin. Trailing slashes are not part of the origin. */
export const CLOUD_SERVER_URL = "https://api.ordo.axolet.com";

export const CLOUD_DISPLAY_NAME = "ordo Cloud";

/** Product default for new installs (no saved server URL). */
export const DEFAULT_SERVER_URL = CLOUD_SERVER_URL;

/** Typed exactly on the self-host acknowledgement step. */
export const SELF_HOST_CONFIRMATION = "I understand";

export type HostingMode = "cloud" | "selfHosted";

function originOf(raw: string): string | null {
  let value = raw.trim();
  if (!value) return null;
  if (!/^https?:\/\//i.test(value)) value = `https://${value}`;
  try {
    const url = new URL(value);
    if (!url.hostname) return null;
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
  return trimmed ? trimmed : fallback;
}

export function canAcknowledgeSelfHost(input: {
  acceptedResponsibility: boolean;
  acceptedLimitations: boolean;
  confirmation: string;
}): boolean {
  return (
    input.acceptedResponsibility &&
    input.acceptedLimitations &&
    input.confirmation.trim() === SELF_HOST_CONFIRMATION
  );
}

/** Cloud is not a self-host destination — send people back to the hosted path. */
export function isSelfHostDestination(url: string | null | undefined): boolean {
  const origin = url ? originOf(url) : null;
  return Boolean(origin) && origin !== CLOUD_SERVER_URL;
}
