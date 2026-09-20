/** Extra browser origins. Empty = same-origin plus loopback (never echo strangers). */

export function normalizeOrigin(raw: string): string {
  return raw.trim().replace(/\/+$/, "");
}

export function parseCorsAllowlist(raw: string | undefined): string[] {
  if (!raw?.trim()) return [];
  return raw
    .split(",")
    .map((part) => normalizeOrigin(part))
    .filter(Boolean);
}

export function isLoopbackOrigin(origin: string): boolean {
  try {
    const host = new URL(origin).hostname.replace(/^\[|\]$/g, "").toLowerCase();
    return host === "localhost" || host === "127.0.0.1" || host === "::1";
  } catch {
    return false;
  }
}

/** Request bits CORS needs. `protocol`/`host` are the public API origin. */
export interface CorsSelf {
  protocol: string;
  host: string;
}

/**
 * Who may call this API from a browser.
 *
 * - No Origin (apps, curl) is always allowed.
 * - Exact allowlist matches always pass.
 * - Same origin as this API always passes.
 * - Loopback (`localhost`, `127.0.0.1`, `::1`) passes only when no allowlist
 *   is set, so Expo web can talk to a self-hosted API on another port.
 * - Anything else is denied. We never copy an unknown Origin.
 */
export function corsOriginAllowed(
  origin: string | undefined,
  self: CorsSelf,
  allowlist: readonly string[],
): boolean {
  if (!origin) return true;
  const incoming = normalizeOrigin(origin);
  if (!incoming) return true;
  if (allowlist.some((item) => normalizeOrigin(item) === incoming)) return true;
  const host = self.host?.trim();
  const protocol = self.protocol?.trim() || "http";
  if (host && incoming === normalizeOrigin(`${protocol}://${host}`)) return true;
  return allowlist.length === 0 && isLoopbackOrigin(incoming);
}
