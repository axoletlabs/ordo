import { normalizeUrlForMatch } from "@ordo/shared";

const TTL_MS = 15 * 60 * 1000;
const MAX_BYTES = 64 * 1024 * 1024;
const TRACKING_PARAM = /^(utm_|fbclid$|gclid$|gclsrc$|dclid$|yclid$|mc_eid$|mc_cid$|igshid$|_hsenc$|_hsmi$)/i;

interface Entry {
  html: string;
  bytes: number;
  expiresAt: number;
}

interface Flight {
  promise: Promise<string>;
  controller: AbortController;
  waiters: number;
}

/** In-process HTML cache with inflight coalescing for retries, prefetch, and duplicates. */
export class HtmlCache {
  private readonly entries = new Map<string, Entry>();
  private readonly inflight = new Map<string, Flight>();
  private totalBytes = 0;

  key(url: string, mode = "article"): string {
    return JSON.stringify([mode, htmlCacheKey(url)]);
  }

  get(url: string, mode = "article"): string | undefined {
    const key = this.key(url, mode);
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

  set(url: string, html: string, mode = "article"): void {
    const key = this.key(url, mode);
    const bytes = Buffer.byteLength(html);
    this.delete(key);
    this.entries.set(key, { html, bytes, expiresAt: Date.now() + TTL_MS });
    this.totalBytes += bytes;
    this.evict();
  }

  /**
   * Share one fetch between callers, but tie the fetch to the set of callers
   * rather than to whichever request happened to arrive first. Aborting one
   * caller (deleted bookmark, closed reader) must not cancel the shared
   * download for the others; the fetch is only aborted when the last waiter
   * leaves.
   */
  async remember(
    url: string,
    loader: (signal: AbortSignal) => Promise<string>,
    signal?: AbortSignal,
    mode = "article",
  ): Promise<string> {
    if (signal?.aborted) throw abortError();
    const hit = this.get(url, mode);
    if (hit !== undefined) return hit;
    const key = this.key(url, mode);
    let flight = this.inflight.get(key);
    if (!flight) {
      const controller = new AbortController();
      const promise = loader(controller.signal)
        .then((html) => {
          if (!controller.signal.aborted && this.inflight.get(key) === flight) this.set(url, html, mode);
          return html;
        })
        .finally(() => {
          if (this.inflight.get(key) === flight) this.inflight.delete(key);
        });
      // A caller can abort before the loader settles; the shared promise then
      // has no observer, and an unhandled rejection would crash the process.
      promise.catch(() => undefined);
      flight = { promise, controller, waiters: 0 };
      this.inflight.set(key, flight);
    }
    flight.waiters += 1;
    try {
      return await waitFor(flight.promise, signal);
    } finally {
      flight.waiters -= 1;
      if (flight.waiters === 0) {
        // Nobody is waiting any more: stop the fetch and let a new caller
        // start from a clean flight.
        if (this.inflight.get(key) === flight) this.inflight.delete(key);
        flight.controller.abort();
      }
    }
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

function abortError(): Error {
  return new DOMException("The operation was aborted.", "AbortError");
}

/** Await a shared promise but reject with AbortError as soon as this caller aborts. */
function waitFor<T>(promise: Promise<T>, signal?: AbortSignal): Promise<T> {
  if (!signal) return promise;
  if (signal.aborted) return Promise.reject(abortError());
  return new Promise<T>((resolve, reject) => {
    const onAbort = () => {
      cleanup();
      reject(abortError());
    };
    const cleanup = () => signal.removeEventListener("abort", onAbort);
    signal.addEventListener("abort", onAbort, { once: true });
    promise.then(
      (value) => {
        cleanup();
        resolve(value);
      },
      (error: unknown) => {
        cleanup();
        reject(error);
      },
    );
  });
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
