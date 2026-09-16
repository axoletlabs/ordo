/**
 * Recent self-hosted server URLs. Caps at three distinct origins, most recent
 * first, and never includes the server you are currently pointed at.
 *
 * Recents are a client-side convenience for the LAN ↔ Tailscale ↔ localhost
 * dance — not a multi-account model. Auth stays global and is cleared on switch.
 */
import { normalizeServerUrl } from "./server-probe";

export const SERVER_HISTORY_LIMIT = 3;

export interface ServerHistoryEntry {
  url: string;
  lastConnectedAt: number;
}

export function parseServerHistory(raw: unknown): ServerHistoryEntry[] {
  if (!Array.isArray(raw)) return [];
  const seen = new Set<string>();
  const out: ServerHistoryEntry[] = [];
  for (const item of raw) {
    if (!item || typeof item !== "object") continue;
    const rec = item as Record<string, unknown>;
    const url = typeof rec.url === "string" ? normalizeServerUrl(rec.url) : null;
    const lastConnectedAt = Number(rec.lastConnectedAt);
    if (!url || !Number.isFinite(lastConnectedAt)) continue;
    if (seen.has(url)) continue;
    seen.add(url);
    out.push({ url, lastConnectedAt });
    if (out.length >= SERVER_HISTORY_LIMIT) break;
  }
  return out;
}

/**
 * Remember the server we are leaving, drop the destination if it was already
 * in the list (it is about to become current), and keep the newest three.
 */
export function recordServerSwitch(
  history: ServerHistoryEntry[],
  departingUrl: string,
  nextUrl: string,
  now = Date.now(),
): ServerHistoryEntry[] {
  const next = normalizeServerUrl(nextUrl);
  const departing = normalizeServerUrl(departingUrl);
  const withoutNext = next ? history.filter((entry) => entry.url !== next) : history;
  if (!departing || departing === next) {
    return withoutNext.slice(0, SERVER_HISTORY_LIMIT);
  }
  const rest = withoutNext.filter((entry) => entry.url !== departing);
  return [{ url: departing, lastConnectedAt: now }, ...rest].slice(0, SERVER_HISTORY_LIMIT);
}

export function removeServerHistoryEntry(
  history: ServerHistoryEntry[],
  url: string,
): ServerHistoryEntry[] {
  const origin = normalizeServerUrl(url);
  if (!origin) return history;
  return history.filter((entry) => entry.url !== origin);
}

export function visibleServerHistory(
  history: ServerHistoryEntry[],
  currentUrl: string,
  exclude: readonly string[] = [],
): ServerHistoryEntry[] {
  const hidden = new Set<string>();
  const current = normalizeServerUrl(currentUrl);
  if (current) hidden.add(current);
  for (const url of exclude) {
    const origin = normalizeServerUrl(url);
    if (origin) hidden.add(origin);
  }
  return history
    .filter((entry) => !hidden.has(entry.url))
    .slice(0, SERVER_HISTORY_LIMIT);
}
