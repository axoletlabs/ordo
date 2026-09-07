import { Injectable, Logger, type OnModuleDestroy } from "@nestjs/common";
import { isIP } from "node:net";
import { setDefaultResultOrder } from "node:dns";
import { Agent } from "undici";
import { classifyDestination, type ReaderRejectionReason } from "./reader-classify.js";
import { UnsupportedContentError } from "./reader-errors.js";
import { DnsCache } from "./dns-cache.js";
import { HtmlCache } from "./html-cache.js";
import { ExtractPool } from "./reader-pool.js";
import {
  ampHtmlHref,
  ARTICLE_CUTOFF_MIN_BYTES,
  ARTICLE_CUTOFF_TRAIL_BYTES,
  classifyHtmlHead,
  classifyShellText,
  decodeHtmlBytes,
  EARLY_STOP_MIN_WORDS,
  HEAD_SNIFF_BYTES,
  headHasArticleEvidence,
  isAmpUrl,
  peekMetadata,
  roughWordCount,
  type ArticleMetadata,
  type ExtractedContent,
  type ExtractOptions as ParseOptions,
} from "./reader-parse.js";

export type { ReaderRejectionReason, ExtractedContent, ArticleMetadata };
export { UnsupportedContentError } from "./reader-errors.js";

export interface ExtractOptions extends ParseOptions {
  signal?: AbortSignal;
  html?: string;
  onHtml?: (html: string) => void;
  onMetadata?: (meta: ArticleMetadata) => void | Promise<void>;
}

const FETCH_TIMEOUT_MS = 8_000;
const CONNECT_TIMEOUT_MS = 4_000;
const MAX_RESPONSE_BYTES = 5 * 1024 * 1024;
const MAX_REDIRECTS = 5;
const USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36";

setDefaultResultOrder("ipv4first");

@Injectable()
export class ReaderService implements OnModuleDestroy {
  private readonly logger = new Logger(ReaderService.name);
  private readonly htmlCache = new HtmlCache();
  private readonly dnsCache = new DnsCache();
  private readonly pool = new ExtractPool();
  private readonly dispatcher = process.env.JEST_WORKER_ID
    ? null
    : new Agent({
        connections: 16,
        connect: { timeout: CONNECT_TIMEOUT_MS, lookup: this.dnsCache.asLookup() },
        bodyTimeout: FETCH_TIMEOUT_MS,
        headersTimeout: FETCH_TIMEOUT_MS,
        keepAliveTimeout: 30_000,
      });

  async onModuleDestroy(): Promise<void> {
    await this.pool.close();
    if (this.dispatcher) await this.dispatcher.close();
  }

  classifyShellText(text: string): ReaderRejectionReason | null {
    return classifyShellText(text);
  }

  /** Warm the HTML cache for a URL the user is about to save. */
  prefetch(url: string): void {
    try {
      this.rejectUnsupportedDestination(url, false);
    } catch {
      return;
    }
    void this.loadHtml(url, false).catch((err: unknown) => {
      this.logger.debug(`Prefetch skipped for ${safeHostname(url)}: ${(err as Error).message}`);
    });
  }

  async extract(url: string, options: ExtractOptions = {}): Promise<ExtractedContent> {
    const forceArticle = options.forceArticle === true;
    this.rejectUnsupportedDestination(url, forceArticle);

    const loaded = options.html
      ? { html: options.html }
      : await this.loadHtml(url, forceArticle, options.signal);
    options.onHtml?.(loaded.html);
    try {
      await options.onMetadata?.(peekMetadata(loaded.html, url));
    } catch (err) {
      this.logger.debug(`Early metadata failed for ${url}: ${(err as Error).message}`);
    }

    try {
      return await this.pool.parse(loaded.html, url, forceArticle);
    } catch (err) {
      if (!loaded.fallbackHtml) throw err;
      this.logger.debug(`AMP extract missed for ${url}; falling back to original HTML`);
      return this.pool.parse(loaded.fallbackHtml, url, forceArticle);
    }
  }

  async loadHtml(
    url: string,
    forceArticle = false,
    signal?: AbortSignal,
  ): Promise<{ html: string; fallbackHtml?: string }> {
    if (process.env.JEST_WORKER_ID) {
      return this.fetchAndMaybeAmp(url, forceArticle, signal);
    }
    const html = await this.htmlCache.remember(url, () =>
      this.fetchHtml(url, forceArticle, signal),
    );
    return this.followAmp(url, html, forceArticle, signal);
  }

  private async fetchAndMaybeAmp(
    url: string,
    forceArticle: boolean,
    signal?: AbortSignal,
  ): Promise<{ html: string; fallbackHtml?: string }> {
    const html = await this.fetchHtml(url, forceArticle, signal);
    return this.followAmp(url, html, forceArticle, signal);
  }

  private async followAmp(
    url: string,
    html: string,
    forceArticle: boolean,
    signal?: AbortSignal,
  ): Promise<{ html: string; fallbackHtml?: string }> {
    const amp = !isAmpUrl(url) ? ampHtmlHref(html, url) : null;
    if (!amp) return { html };
    try {
      this.rejectUnsupportedDestination(amp, forceArticle);
      const ampHtml = process.env.JEST_WORKER_ID
        ? await this.fetchHtml(amp, forceArticle, signal)
        : await this.htmlCache.remember(amp, () => this.fetchHtml(amp, forceArticle, signal));
      return { html: ampHtml, fallbackHtml: html };
    } catch (err) {
      this.logger.debug(`AMP fetch skipped for ${url}: ${(err as Error).message}`);
      return { html };
    }
  }

  private rejectUnsupportedDestination(url: string, forceArticle = false): void {
    let parsed: URL;
    try {
      parsed = new URL(url);
    } catch {
      throw new Error(`Invalid URL: ${url}`);
    }
    const reason = classifyDestination(parsed);
    if (!reason) return;
    if (forceArticle && reason === "not_an_article") return;
    throw new UnsupportedContentError(reason, `${parsed.hostname} is not an article source`);
  }

  private async fetchHtml(
    url: string,
    forceArticle: boolean,
    signal: AbortSignal | undefined,
  ): Promise<string> {
    let lastError: unknown;
    for (let attempt = 0; attempt < 2; attempt += 1) {
      try {
        return await this.fetchHtmlOnce(url, forceArticle, signal);
      } catch (err) {
        lastError = err;
        if (err instanceof UnsupportedContentError) throw err;
        if (signal?.aborted) throw err;
        if (attempt === 0 && isRetryableError(err)) continue;
        throw err;
      }
    }
    throw lastError instanceof Error ? lastError : new Error(String(lastError));
  }

  private async fetchHtmlOnce(
    url: string,
    forceArticle: boolean,
    signal: AbortSignal | undefined,
  ): Promise<string> {
    let current = new URL(url);
    let res: Response | null = null;
    const timeout = AbortSignal.timeout(FETCH_TIMEOUT_MS);
    const combined = signal ? AbortSignal.any([signal, timeout]) : timeout;

    for (let redirects = 0; redirects <= MAX_REDIRECTS; redirects += 1) {
      await this.assertPublicDestination(current);
      const request = {
        redirect: "manual" as const,
        signal: combined,
        headers: {
          "user-agent": USER_AGENT,
          accept: "text/html,application/xhtml+xml;q=0.9,*/*;q=0.8",
          "accept-language": "en-US,en;q=0.9",
        },
        ...(this.dispatcher ? { dispatcher: this.dispatcher } : {}),
      };
      res = await fetch(current, request as RequestInit);
      if (![301, 302, 303, 307, 308].includes(res.status)) break;
      const location = res.headers.get("location");
      if (!location) break;
      if (redirects === MAX_REDIRECTS) throw new Error("Too many redirects");
      current = new URL(location, current);
      this.rejectUnsupportedDestination(current.toString(), forceArticle);
    }
    if (!res) throw new Error(`Request to ${url} returned no response`);
    if (isRetryableStatus(res.status) && !combined.aborted) {
      throw new Error(`Request to ${url} failed with status ${res.status}`);
    }
    if (!res.ok) {
      throw new Error(`Request to ${url} failed with status ${res.status}`);
    }
    const type = res.headers.get("content-type") ?? "";
    if (!/text\/html|application\/xhtml\+xml/i.test(type)) {
      throw new UnsupportedContentError("non_html_content", `Unsupported content type ${type}`);
    }
    const declaredLength = Number(res.headers.get("content-length") ?? 0);
    if (declaredLength > MAX_RESPONSE_BYTES) {
      throw new UnsupportedContentError("non_html_content", "HTML response is too large");
    }

    const html = res.body
      ? await this.readStreamingBody(res, forceArticle, combined)
      : await res.text();
    this.rejectFromHead(html, forceArticle);
    return html;
  }

  private async readStreamingBody(
    res: Response,
    forceArticle: boolean,
    signal: AbortSignal,
  ): Promise<string> {
    const reader = res.body!.getReader();
    const chunks: Uint8Array[] = [];
    let bytes = 0;
    let headDone = false;
    let allowCutoff = false;
    let cutoffAt: number | null = null;
    const contentType = res.headers.get("content-type") ?? "text/html";

    const concat = () => concatChunks(chunks, bytes);

    while (true) {
      if (signal.aborted) {
        await reader.cancel().catch(() => undefined);
        throw signal.reason instanceof Error ? signal.reason : new Error("aborted");
      }
      const { done, value } = await reader.read();
      if (done) break;
      bytes += value.byteLength;
      if (bytes > MAX_RESPONSE_BYTES) {
        await reader.cancel().catch(() => undefined);
        throw new UnsupportedContentError("non_html_content", "HTML response is too large");
      }
      chunks.push(value);

      if (!headDone && bytes >= 8_192) {
        const decoded = decodeHtmlBytes(
          concat().subarray(0, Math.min(bytes, HEAD_SNIFF_BYTES)),
          contentType,
        );
        if (decoded.toLowerCase().includes("</head>") || bytes >= HEAD_SNIFF_BYTES) {
          headDone = true;
          allowCutoff = headHasArticleEvidence(decoded);
        }
      }

      if (allowCutoff && cutoffAt === null && bytes >= ARTICLE_CUTOFF_MIN_BYTES) {
        const soFar = decodeHtmlBytes(concat(), contentType);
        if (
          soFar.toLowerCase().includes("</article>") &&
          roughWordCount(soFar) >= EARLY_STOP_MIN_WORDS
        ) {
          cutoffAt = bytes + ARTICLE_CUTOFF_TRAIL_BYTES;
        }
      }
      if (cutoffAt !== null && bytes >= cutoffAt) {
        await reader.cancel().catch(() => undefined);
        break;
      }
    }

    return decodeHtmlBytes(concat(), contentType);
  }

  private rejectFromHead(html: string, forceArticle: boolean): void {
    if (forceArticle) return;
    const pageKind = classifyHtmlHead(html);
    if (pageKind) {
      throw new UnsupportedContentError(pageKind, "Page metadata is not an article");
    }
  }

  private async assertPublicDestination(url: URL): Promise<void> {
    if (url.protocol !== "http:" && url.protocol !== "https:") {
      throw new UnsupportedContentError("non_html_content", "Only HTTP pages are supported");
    }
    const host = url.hostname.toLowerCase().replace(/^\[|\]$/g, "");
    if (host === "localhost" || host.endsWith(".localhost")) {
      throw new UnsupportedContentError("non_html_content", "Private network URLs are not supported");
    }
    const addresses = isIP(host)
      ? [{ address: host }]
      : await this.dnsCache.lookupAll(host);
    if (addresses.length === 0 || addresses.some(({ address }) => !this.isPublicIp(address))) {
      throw new UnsupportedContentError("non_html_content", "Private network URLs are not supported");
    }
  }

  private isPublicIp(address: string): boolean {
    if (address.includes(":")) {
      const normalized = address.toLowerCase();
      const mapped = normalized.match(/::ffff:(\d+\.\d+\.\d+\.\d+)$/)?.[1];
      if (mapped) return this.isPublicIp(mapped);
      return !(
        normalized === "::" ||
        normalized === "::1" ||
        /^f[cd]/.test(normalized) ||
        /^fe[89ab]/.test(normalized) ||
        normalized.startsWith("2001:db8:")
      );
    }
    const octets = address.split(".").map(Number);
    if (octets.length !== 4 || octets.some((part) => !Number.isInteger(part) || part < 0 || part > 255)) {
      return false;
    }
    const [a, b, c] = octets;
    return !(
      a === 0 || a === 10 || a === 127 || a >= 224 ||
      (a === 100 && b >= 64 && b <= 127) ||
      (a === 169 && b === 254) ||
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 168) ||
      (a === 192 && b === 0 && (c === 0 || c === 2)) ||
      (a === 198 && (b === 18 || b === 19 || b === 51)) ||
      (a === 203 && b === 0 && c === 113)
    );
  }
}

function concatChunks(chunks: Uint8Array[], bytes: number): Uint8Array {
  const out = new Uint8Array(bytes);
  let offset = 0;
  for (const chunk of chunks) {
    out.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return out;
}

function isRetryableStatus(status: number): boolean {
  return status === 429 || status === 502 || status === 503 || status === 504;
}

function isRetryableError(err: unknown): boolean {
  const message = ((err as Error).message ?? "").toLowerCase();
  if (/too many redirects|invalid url/.test(message)) return false;
  return /timeout|network|econnreset|econnrefused|enotfound|fetch failed|status 429|status 502|status 503|status 504/.test(
    message,
  );
}

function safeHostname(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return url.slice(0, 255);
  }
}
