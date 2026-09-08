import type { ExtractionReason } from "@ordo/shared";
import unsupportedDomains from "./reader-unsupported-domains.json";

export type ReaderRejectionReason = Exclude<ExtractionReason, "fetch_error" | "interrupted">;

/** File extensions that can never be HTML articles. */
export const NON_HTML_EXTENSIONS = new Set([
  "pdf", "doc", "docx", "ppt", "pptx", "xls", "xlsx", "odt", "ods", "odp", "rtf", "epub", "mobi",
  "zip", "gz", "tgz", "bz2", "xz", "tar", "rar", "7z", "dmg", "iso", "exe", "msi", "apk", "deb", "rpm", "bin",
  "mp3", "wav", "ogg", "flac", "m4a", "aac", "mp4", "avi", "mkv", "mov", "webm", "flv", "wmv", "m4v",
  "png", "jpg", "jpeg", "gif", "webp", "svg", "bmp", "ico", "tif", "tiff", "heic", "avif",
  "css", "js", "mjs", "json", "xml", "rss", "atom", "csv", "tsv", "txt",
]);

const APP_HOSTS = new Set(unsupportedDomains.appHosts);
const COMMERCE_HOSTS = new Set(unsupportedDomains.commerceHosts);

/** Pathnames that, combined with a query parameter, are search result pages. */
const SEARCH_PATHS = new Set(["/search", "/results", "/search/", "/results/"]);

/**
 * Path segments that mark commerce, cart, and catalog destinations.
 * `/p/` is intentionally omitted — Substack and others use it for articles.
 */
const COMMERCE_SEGMENTS = new Set([
  "products",
  "product",
  "collections",
  "collection",
  "cart",
  "carts",
  "checkout",
  "basket",
  "baskets",
  "dp",
  "itm",
  "listing",
  "listings",
  "pricing",
  "browse",
]);

const ARTICLE_SCHEMA_TYPES = new Set([
  "article",
  "newsarticle",
  "blogposting",
  "techarticle",
  "scholarlyarticle",
  "reportage",
  "socialmediaposting",
  "liveblogposting",
]);

const REJECT_SCHEMA_TYPES = new Set([
  "product",
  "productgroup",
  "individualproduct",
  "vehicle",
  "offer",
  "aggregateoffer",
  "offercatalog",
  "itemlist",
  "searchresultspage",
  "collectionpage",
  "softwareapplication",
  "webapplication",
  "movie",
  "tvseason",
  "tvepisode",
  "tvseries",
  "videogame",
  "store",
]);

const COMMERCE_CTA = /\b(add to (cart|bag|basket)|buy now|shop now)\b/i;

export interface PageSignals {
  ogType: string | null;
  schemaTypes: string[];
}

export function stripWww(host: string): string {
  return host.toLowerCase().replace(/^www\./, "");
}

export function hostMatches(host: string, configured: string): boolean {
  return host === configured || host.endsWith(`.${configured}`);
}

/** Classify destinations an article reader can never handle, before fetching. */
export function classifyDestination(url: URL): ReaderRejectionReason | null {
  const path = url.pathname.toLowerCase();
  const filename = path.slice(path.lastIndexOf("/") + 1);
  const dot = filename.lastIndexOf(".");
  if (dot !== -1 && NON_HTML_EXTENSIONS.has(filename.slice(dot + 1))) {
    return "non_html_content";
  }

  const host = stripWww(url.hostname);

  const knownShell =
    APP_HOSTS.has(host) ||
    unsupportedDomains.socialVideoAppHosts.some((configured) => hostMatches(host, configured)) ||
    unsupportedDomains.appHostPrefixes.some((prefix) => host.startsWith(prefix));
  if (knownShell) return "social_video_or_app";

  if (COMMERCE_HOSTS.size > 0) {
    for (const configured of COMMERCE_HOSTS) {
      if (hostMatches(host, configured)) return "not_an_article";
    }
  }

  const github = classifyGitHubDestination(host, url);
  if (github) return github;

  // Site roots are not skipped: many essays live at `/` (grugbrain.dev, …).
  // Link-heavy homepages still fail Readability / quality gates after fetch.

  if (pathnameLooksLikeCommerce(path)) return "not_an_article";

  if (
    SEARCH_PATHS.has(path) &&
    (url.searchParams.get("q") ?? url.searchParams.get("query") ?? url.searchParams.get("search"))
  ) {
    return "not_an_article";
  }

  return null;
}

/** Markdown-like files GitHub serves as readable HTML on `/blob/` pages. */
const GITHUB_DOC_EXTENSIONS = new Set([
  "md",
  "markdown",
  "mdx",
  "rst",
  "adoc",
  "asciidoc",
  "org",
]);

/**
 * Repo homepages (`github.com/owner/repo`) render the README, so Readability
 * treats them as essays. They are project surfaces, not posts. Allow markdown
 * blobs, wiki pages, Gists, and GitHub Pages (`*.github.io`).
 */
export function classifyGitHubDestination(host: string, url: URL): ReaderRejectionReason | null {
  if (host.endsWith(".github.io")) return null;
  if (host === "gist.github.com" || host === "github.blog" || host === "docs.github.com") {
    return null;
  }
  if (host !== "github.com") return null;

  const segments = url.pathname.split("/").filter(Boolean);
  if (segments.length <= 2) return "not_an_article";

  const section = segments[2].toLowerCase();
  if (section === "wiki") return null;
  if (section === "blob") {
    const file = segments[segments.length - 1] ?? "";
    const dot = file.lastIndexOf(".");
    if (dot !== -1 && GITHUB_DOC_EXTENSIONS.has(file.slice(dot + 1).toLowerCase())) {
      return null;
    }
    return "not_an_article";
  }
  return "not_an_article";
}

export function pathnameLooksLikeCommerce(pathname: string): boolean {
  const segments = pathname.toLowerCase().split("/").filter(Boolean);
  if (segments.some((segment) => COMMERCE_SEGMENTS.has(segment))) return true;
  if (segments[0] === "gp" && (segments[1] === "product" || segments[1] === "aw")) return true;
  if (segments[0] === "catalog" && segments[1] === "product") return true;
  return false;
}

export function collectPageSignals(document: Document): PageSignals {
  const ogType =
    document
      .querySelector('meta[property="og:type"], meta[name="og:type"]')
      ?.getAttribute("content")
      ?.trim()
      .toLowerCase() ?? null;

  const schemaTypes = new Set<string>();
  for (const node of flattenJsonLd(document)) {
    for (const type of normalizeSchemaTypes(node?.["@type"])) schemaTypes.add(type);
  }
  for (const el of Array.from(document.querySelectorAll("[itemtype]"))) {
    for (const type of normalizeSchemaTypes(el.getAttribute("itemtype"))) schemaTypes.add(type);
  }

  return { ogType, schemaTypes: [...schemaTypes] };
}

export function hasArticleEvidence(signals: PageSignals): boolean {
  if (signals.ogType === "article" || (signals.ogType?.startsWith("article:") ?? false)) return true;
  return signals.schemaTypes.some((type) => ARTICLE_SCHEMA_TYPES.has(type));
}

/** Hard-reject commerce/app page types. Article evidence does not override Product. */
export function classifyPageSignals(signals: PageSignals): ReaderRejectionReason | null {
  const og = signals.ogType ?? "";
  if (
    og === "product" ||
    og.startsWith("product.") ||
    og.startsWith("video.") ||
    og.startsWith("music.") ||
    og === "profile"
  ) {
    return "not_an_article";
  }
  if (signals.schemaTypes.some((type) => REJECT_SCHEMA_TYPES.has(type))) {
    return "not_an_article";
  }
  return null;
}

/** Buy/cart CTAs on a page that never claimed to be an article. */
export function hasCommerceCta(document: Document): boolean {
  for (const el of Array.from(
    document.querySelectorAll('button, a, input[type="submit"], input[type="button"], [role="button"]'),
  )) {
    const text = `${el.getAttribute("value") ?? ""} ${el.textContent ?? ""}`.replace(/\s+/g, " ").trim();
    if (COMMERCE_CTA.test(text)) return true;
  }
  return false;
}

function normalizeSchemaTypes(value: unknown): string[] {
  const values = Array.isArray(value) ? value : value != null ? [value] : [];
  return values
    .map((entry) => String(entry).trim())
    .filter(Boolean)
    .map((entry) => entry.split(/[/#]/).pop()!.toLowerCase());
}

function flattenJsonLd(document: Document): Record<string, unknown>[] {
  const nodes: Record<string, unknown>[] = [];
  for (const script of Array.from(document.querySelectorAll('script[type="application/ld+json"]'))) {
    try {
      collectJsonLd(JSON.parse(script.textContent || ""), nodes);
    } catch {
      // Malformed JSON-LD is common and must not fail extraction.
    }
  }
  return nodes;
}

function collectJsonLd(value: unknown, output: Record<string, unknown>[]): void {
  if (!value) return;
  if (Array.isArray(value)) {
    for (const item of value) collectJsonLd(item, output);
    return;
  }
  if (typeof value !== "object") return;
  const record = value as Record<string, unknown>;
  output.push(record);
  for (const key of ["@graph", "mainEntity", "mainEntityOfPage", "hasPart", "isPartOf", "itemListElement"]) {
    if (record[key]) collectJsonLd(record[key], output);
  }
}
