/** URL helpers shared by clients and the server; no schema dependencies. */

/**
 * Normalize a URL for duplicate matching: lowercase scheme/host, drop default
 * ports, drop a trailing slash on the root path, and drop empty fragments.
 * Query strings and non-root paths are preserved exactly.
 */
export function normalizeUrlForMatch(raw: string): string {
  const trimmed = raw.trim();
  let url: URL;
  try {
    url = new URL(trimmed);
  } catch {
    return trimmed;
  }
  let out = `${url.protocol}//${url.hostname}`;
  const isDefaultPort =
    (url.protocol === "https:" && url.port === "443") ||
    (url.protocol === "http:" && url.port === "80");
  if (url.port && !isDefaultPort) out += `:${url.port}`;
  if (url.pathname && url.pathname !== "/") out += url.pathname;
  if (url.search) out += url.search;
  if (url.hash && url.hash !== "#") out += url.hash;
  return out;
}

/** True when a URL is absolute http(s) — the only schemes Ordo stores. */
export function isSupportedUrl(value: string): boolean {
  try {
    const url = new URL(value.trim());
    return url.protocol === "http:" || url.protocol === "https:";
  } catch {
    return false;
  }
}
