import { normalizeUrlForMatch } from "@ordo/shared";

const TTL_MS = 15 * 60 * 1000;
const MAX_BYTES = 64 * 1024 * 1024;
const TRACKING_PARAM = /^(utm_|fbclid$|gclid$|gclsrc$|dclid$|yclid$|mc_eid$|mc_cid$|igshid$|_hsenc$|_hsmi$)/i;

interface Entry {
  html: string;
  bytes: number;
  expiresAt: number;
}

/** In-process HTML cache with inflight coalescing for retries, prefetch, and duplicates. */
export class HtmlCache {
  private readonly entries = new Map<string, Entry>();
  private readonly inflight = new Map<string, Promise<string>>();
  private totalBytes = 0;

  key(url: string): string {
    return htmlCacheKey(url);
  }

  get(url: string): string | undefined {
    const key = this.key(url);
    const entry = this.entries.get(key);
    if (!entry) return undefined;
    if (entry.expiresAt <= Date.now()) {
      this.delete(key);
      return undefined;
    }
    // Refresh LRU order.
    this.entries.delete(key);
    this.entries.set(key, entry);
    return entry.html;
  }

  set(url: string, html: string): void {
    const key = this.key(url);
    const bytes = Buffer.byteLength(html);
    this.delete(key);
    this.entries.set(key, { html, bytes, expiresAt: Date.now() + TTL_MS });
    this.totalBytes += bytes;
    this.evict();
  }

  async remember(url: string, loader: () => Promise<string>): Promise<string> {
    const hit = this.get(url);
    if (hit !== undefined) return hit;
    const key = this.key(url);
    const pending = this.inflight.get(key);
    if (pending) return pending;
    const next = loader()
      .then((html) => {
        this.set(url, html);
        return html;
      })
      .finally(() => {
        this.inflight.delete(key);
      });
    this.inflight.set(key, next);
    return next;
  }

  private delete(key: string): void {
    const entry = this.entries.get(key);
    if (!entry) return;
    this.totalBytes -= entry.bytes;
    this.entries.delete(key);
  }

  private evict(): void {
    while (this.totalBytes > MAX_BYTES && this.entries.size > 0) {
      const oldest = this.entries.keys().next().value;
      if (oldest === undefined) break;
      this.delete(oldest);
    }
  }
}

/** Normalize a URL for HTML reuse: drop tracking params, keep the rest. */
export function htmlCacheKey(raw: string): string {
  const normalized = normalizeUrlForMatch(raw);
  try {
    const url = new URL(normalized);
    const kept: Array<[string, string]> = [];
    url.searchParams.forEach((value, key) => {
      if (!TRACKING_PARAM.test(key)) kept.push([key, value]);
    });
    kept.sort(([a], [b]) => a.localeCompare(b));
    url.search = "";
    for (const [key, value] of kept) url.searchParams.append(key, value);
    return url.toString();
  } catch {
    return normalized;
  }
}
