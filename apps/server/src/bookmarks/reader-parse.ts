import { isProbablyReaderable, Readability } from "@mozilla/readability";
import { JSDOM, VirtualConsole } from "jsdom";
import sanitizeHtml from "sanitize-html";
import {
  classifyPageSignals,
  collectPageSignals,
  hasArticleEvidence,
  hasCommerceCta,
  type ReaderRejectionReason,
} from "./reader-classify.js";
import { UnsupportedContentError } from "./reader-errors.js";

export type { ReaderRejectionReason };
export { UnsupportedContentError } from "./reader-errors.js";

export interface ExtractedContent {
  title: string;
  description: string | null;
  author: string | null;
  publishedAt: string | null;
  domain: string;
  readingTimeMinutes: number;
  contentHtml: string;
  contentMarkdown: string;
  contentText: string;
}

export interface ExtractOptions {
  forceArticle?: boolean;
}

export interface ArticleMetadata {
  title: string | null;
  description: string | null;
  author: string | null;
  publishedAt: string | null;
}

const MIN_WORDS = 70;
const MIN_WORDS_UNMARKED = 280;
const MAX_LINK_DENSITY = 0.4;
const MAX_LINK_DENSITY_UNMARKED = 0.3;
const SHELL_TEXT_LIMIT = 2_000;
const WORDS_PER_MINUTE = 200;
const MAX_IMAGE_DIMENSION = 10_000;
const HEAD_SNIFF_CHARS = 128_000;

export const EARLY_STOP_MIN_WORDS = 280;
export const HEAD_SNIFF_BYTES = 128_000;
export const ARTICLE_CUTOFF_MIN_BYTES = 256 * 1024;
export const ARTICLE_CUTOFF_TRAIL_BYTES = 32 * 1024;

const JS_REQUIRED_PATTERNS: RegExp[] = [
  /(?:please|kindly) (?:enable|turn on|activate) (?:javascript|js)\b/,
  /enable (?:javascript|js) to (?:continue|view|read|use|see|access)/,
  /javascript (?:is|must be|needs to be|has to be|appears to be|seems to be) (?:not )?(?:enabled|disabled|required|turned on|turned off|activated|supported)/,
  /\bjs (?:is|must be|needs to be) (?:not )?(?:enabled|disabled|required)/,
  /(?:javascript|js) (?:is )?required/,
  /browser (?:does not|doesn'?t|doesnt) support (?:javascript|js)/,
  /without (?:javascript|js)/,
];

const LOGIN_PAYWALL_PATTERNS: RegExp[] = [
  /sign ?in (?:to|in order to) (?:continue|read|view|access|see)/,
  /log ?in (?:to|in order to) (?:continue|read|view|access|see)/,
  /(?:create|register) (?:a )?(?:free )?account to (?:continue|read|view|access)/,
  /subscribe to (?:continue|read|view|keep reading)/,
  /subscription (?:is )?required/,
  /paid (?:subscription|account|plan) required/,
  /already a subscriber/,
  /members[- ]only (?:content|article)/,
];

const BOT_CHALLENGE_PATTERNS: RegExp[] = [
  /verify (?:that )?you'?re? (?:a )?human/,
  /are you a robot/,
  /checking your browser/,
  /just a moment\.\.\./,
  /unusual traffic/,
  /(?:ddos|bot) protection/,
  /complete the (?:security check|captcha)/,
  /(?:verify|solve) (?:the )?captcha/,
  /access (?:denied|blocked)/,
];

const CONSENT_WALL_PATTERNS: RegExp[] = [
  /before you continue (?:to|with)/,
  /accept (?:all )?cookies to (?:continue|proceed|read|view)/,
  /cookies? must be (?:enabled|accepted)/,
  /consent (?:is )?required/,
  /this site uses cookies[\s\S]*by using this site,? you agree/,
];

function pixelSizeFromStyle(
  style: string | undefined,
  property: "width" | "height",
): string | undefined {
  return new RegExp(`(?:^|;)\\s*${property}\\s*:\\s*(\\d{1,5})\\s*px(?:\\s*(?:;|$))`, "i")
    .exec(style ?? "")?.[1];
}

function normalizeImageAttributes(tagName: string, attributes: Record<string, string>) {
  const next = { ...attributes };
  delete next.style;

  for (const dimension of ["width", "height"] as const) {
    const attribute = next[dimension]?.trim();
    const numericAttribute = attribute && /^\d{1,5}$/.test(attribute) ? Number(attribute) : 0;
    if (numericAttribute >= 1 && numericAttribute <= MAX_IMAGE_DIMENSION) {
      next[dimension] = String(numericAttribute);
      continue;
    }

    const styleValue = pixelSizeFromStyle(attributes.style, dimension);
    const numericStyle = styleValue ? Number(styleValue) : 0;
    if (numericStyle >= 1 && numericStyle <= MAX_IMAGE_DIMENSION) {
      next[dimension] = String(numericStyle);
    } else {
      delete next[dimension];
    }
  }

  return { tagName, attribs: next };
}

const SANITIZE_OPTIONS: sanitizeHtml.IOptions = {
  allowedTags: [
    "p", "br", "hr", "h1", "h2", "h3", "h4", "h5", "h6",
    "ul", "ol", "li", "blockquote", "pre", "code",
    "em", "strong", "b", "i", "u", "s", "del", "mark", "sub", "sup", "abbr", "kbd", "cite", "q", "small",
    "a", "img", "figure", "figcaption", "picture", "source",
    "table", "thead", "tbody", "tfoot", "tr", "th", "td", "caption",
    "time",
  ],
  allowedAttributes: {
    a: ["href", "title", "rel"],
    img: ["src", "alt", "title", "width", "height", "loading"],
    source: ["srcset", "type", "media"],
    time: ["datetime"],
  },
  allowedSchemes: ["http", "https", "mailto"],
  allowedSchemesByTag: { img: ["http", "https"], source: ["http", "https"] },
  transformTags: { img: normalizeImageAttributes },
  exclusiveFilter: (frame) => frame.tag === "img" && !frame.attribs.src,
  disallowedTagsMode: "discard",
};

function normalizeSpace(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

function normalizeForCompare(text: string): string {
  return text
    .toLowerCase()
    .replace(/[\p{P}\p{S}]/gu, "")
    .replace(/\s+/g, " ")
    .trim();
}

function wordCount(text: string): number {
  const trimmed = text.trim();
  if (!trimmed) return 0;
  return trimmed.split(/\s+/).length;
}

function linkDensity(element: Element): number {
  const total = (element.textContent ?? "").length;
  if (total === 0) return 1;
  let linkText = 0;
  for (const a of Array.from(element.querySelectorAll("a"))) {
    linkText += (a.textContent ?? "").length;
  }
  return linkText / total;
}

function hasSameText(a: string, b: string): boolean {
  const na = normalizeForCompare(a);
  const nb = normalizeForCompare(b);
  return !!na && na === nb;
}

function duplicatesTitle(a: string, b: string): boolean {
  const na = normalizeForCompare(a);
  const nb = normalizeForCompare(b);
  if (!na || !nb) return false;
  if (na === nb) return true;
  const shorter = na.length < nb.length ? na : nb;
  const longer = na.length < nb.length ? nb : na;
  if (shorter.length < 8 || shorter.length / longer.length < 0.8) return false;
  return longer.startsWith(shorter) || longer.endsWith(shorter);
}

function toIsoDate(value: string | null | undefined): string | null {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

export function stripHeavyMarkup(html: string): string {
  return html
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, "")
    .replace(/<script\b([^>]*)>[\s\S]*?<\/script>/gi, (full, attrs: string) =>
      /type\s*=\s*["']application\/ld\+json["']/i.test(attrs) ? full : "",
    )
    .replace(/<link\b[^>]*rel\s*=\s*["'][^"']*stylesheet[^"']*["'][^>]*>/gi, "");
}

export function ensureBaseHref(html: string, url: string): string {
  if (/<base\b/i.test(html)) return html;
  const href = url.replace(/&/g, "&amp;").replace(/"/g, "&quot;");
  const tag = `<base href="${href}">`;
  if (/<head\b[^>]*>/i.test(html)) return html.replace(/<head\b[^>]*>/i, (open) => `${open}${tag}`);
  return `<head>${tag}</head>${html}`;
}

export function sliceHead(html: string): string {
  const lower = html.slice(0, HEAD_SNIFF_CHARS).toLowerCase();
  const end = lower.indexOf("</head>");
  if (end >= 0) return html.slice(0, Math.min(html.length, end + 7));
  return html.slice(0, HEAD_SNIFF_CHARS);
}

const virtualConsole = new VirtualConsole();
virtualConsole.on("jsdomError", () => undefined);

function createDom(html: string, url?: string): JSDOM {
  return new JSDOM(url ? ensureBaseHref(html, url) : html, {
    url,
    virtualConsole,
    pretendToBeVisual: false,
  });
}

function parseDocument(html: string, url: string): { document: Document; close: () => void } {
  const dom = createDom(html, url);
  return { document: dom.window.document, close: () => dom.window.close() };
}

function readMeta(document: Document, name: string): string | null {
  const selector = name.includes(":") ? `meta[property="${name}"]` : `meta[name="${name}"]`;
  const elements = Array.from(document.querySelectorAll(selector));
  const content =
    elements.find((el) => el.getAttribute("content")?.trim())?.getAttribute("content") ?? null;
  return content?.trim() || null;
}

export function peekMetadata(html: string, url: string): ArticleMetadata {
  const { document, close } = parseDocument(sliceHead(html), url);
  try {
    return {
      title:
        readMeta(document, "og:title") ||
        document.querySelector("title")?.textContent?.trim() ||
        null,
      description: readMeta(document, "og:description") || readMeta(document, "description"),
      author: readMeta(document, "author") || readMeta(document, "article:author"),
      publishedAt: toIsoDate(readMeta(document, "article:published_time")),
    };
  } finally {
    close();
  }
}

export function classifyHtmlHead(html: string): ReaderRejectionReason | null {
  const { document, close } = parseDocument(sliceHead(html), "https://example.invalid/");
  try {
    return classifyPageSignals(collectPageSignals(document));
  } finally {
    close();
  }
}

export function headHasArticleEvidence(html: string): boolean {
  const { document, close } = parseDocument(sliceHead(html), "https://example.invalid/");
  try {
    return hasArticleEvidence(collectPageSignals(document));
  } finally {
    close();
  }
}

export function ampHtmlHref(html: string, baseUrl: string): string | null {
  const { document, close } = parseDocument(sliceHead(html), baseUrl);
  try {
    const href =
      document.querySelector('link[rel="amphtml"]')?.getAttribute("href")?.trim() ||
      document.querySelector('link[rel="alternate"][type="text/amp+html"]')?.getAttribute("href")?.trim() ||
      null;
    if (!href) return null;
    try {
      const resolved = new URL(href, baseUrl);
      if (resolved.protocol !== "http:" && resolved.protocol !== "https:") return null;
      return resolved.toString();
    } catch {
      return null;
    }
  } finally {
    close();
  }
}

export function isAmpUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    const host = parsed.hostname.replace(/^www\./, "").toLowerCase();
    if (host.startsWith("amp.") || host.includes(".amp.")) return true;
    if (/\/amp(\/|$)/i.test(parsed.pathname)) return true;
    if (parsed.searchParams.has("amp") || parsed.searchParams.get("output") === "amp") return true;
    return false;
  } catch {
    return false;
  }
}

export function roughWordCount(html: string): number {
  return wordCount(
    html
      .replace(/<script\b[\s\S]*?<\/script>/gi, " ")
      .replace(/<style\b[\s\S]*?<\/style>/gi, " ")
      .replace(/<[^>]+>/g, " "),
  );
}

export function decodeHtmlBytes(bytes: Uint8Array, contentType: string): string {
  const headerCharset = /charset\s*=\s*["']?([\w-]+)/i.exec(contentType)?.[1]?.trim();
  const sniff = new TextDecoder("latin1").decode(bytes.subarray(0, Math.min(bytes.length, 4096)));
  const metaCharset =
    /<meta[^>]+charset\s*=\s*["']?([\w-]+)/i.exec(sniff)?.[1] ??
    /<meta[^>]+content=["'][^"']*charset=([\w-]+)/i.exec(sniff)?.[1];
  const label = (headerCharset || metaCharset || "utf-8").toLowerCase();
  try {
    return new TextDecoder(label).decode(bytes);
  } catch {
    return new TextDecoder("utf-8").decode(bytes);
  }
}

export function classifyShellText(text: string): ReaderRejectionReason | null {
  if (text.length > SHELL_TEXT_LIMIT) return null;
  const t = text.toLowerCase();
  for (const pattern of BOT_CHALLENGE_PATTERNS) {
    if (pattern.test(t)) return "bot_challenge";
  }
  for (const pattern of JS_REQUIRED_PATTERNS) {
    if (pattern.test(t)) return "js_required";
  }
  for (const pattern of LOGIN_PAYWALL_PATTERNS) {
    if (pattern.test(t)) return "login_or_paywall";
  }
  for (const pattern of CONSENT_WALL_PATTERNS) {
    if (pattern.test(t)) return "consent_wall";
  }
  return null;
}

export function extractFromHtml(html: string, url: string, options: ExtractOptions = {}): ExtractedContent {
  const forceArticle = options.forceArticle === true;
  const domain = safeHostname(url);
  const page = parseDocument(stripHeavyMarkup(html), url);
  let fragmentClose: (() => void) | undefined;
  try {
    const document = page.document;

    const signals = collectPageSignals(document);
    const pageKind = classifyPageSignals(signals);
    if (pageKind && !forceArticle) {
      throw new UnsupportedContentError(pageKind, "Page metadata is not an article");
    }
    const articleEvidence = hasArticleEvidence(signals);
    if (!articleEvidence && !forceArticle && hasCommerceCta(document)) {
      throw new UnsupportedContentError("not_an_article", "Page looks like a store, not an article");
    }

    // Drop script/style after JSON-LD is read so a huge bundle cannot hide a
    // short noscript warning, without cloning the tree.
    document.querySelectorAll("script, style, template, svg, canvas").forEach((el) => el.remove());
    const visibleText = normalizeSpace(document.body?.textContent ?? "");
    if (!visibleText) {
      throw new UnsupportedContentError("too_short", "Page contains no readable text");
    }
    const shell = classifyShellText(visibleText);
    if (shell) {
      throw new UnsupportedContentError(shell, `Page looks like a ${shell.replace(/_/g, " ")} shell`);
    }

    stripNonContentTags(document);

    const meta = {
      title: readMeta(document, "og:title") || document.title?.trim() || domain,
      description: readMeta(document, "description") || readMeta(document, "og:description"),
      author: readMeta(document, "author"),
      publishedTime: readMeta(document, "article:published_time"),
    };

    // Unmarked pages still go through Readability; og:type/JSON-LD is a hint,
    // not a requirement. Many real essays (grugbrain.dev, indie blogs) never
    // declare Article schema. Forced extracts also try parse when the
    // readerable heuristic is false (short paragraphs, unusual markup).
    const readerable = isProbablyReaderable(document);
    let parsed: ReturnType<Readability["parse"]> = null;
    if (readerable || forceArticle) {
      try {
        parsed = new Readability(document.cloneNode(true) as Document).parse();
      } catch {
        parsed = null;
      }
    }

    let contentRoot: Element;
    if (parsed?.content) {
      const fragment = parseFragment(parsed.content);
      fragmentClose = fragment.close;
      contentRoot = fragment.root;
    } else if (articleEvidence || forceArticle) {
      const fallback =
        narrowArticleFallback(document) ??
        (forceArticle ? wideBodyFallback(document) : null);
      if (!fallback) {
        throw new UnsupportedContentError("not_an_article", "No readable article content found");
      }
      contentRoot = fallback;
    } else {
      throw new UnsupportedContentError("not_an_article", "No readable article content found");
    }
    unwrapLayoutRoots(contentRoot);

    const text = normalizeSpace(contentRoot.textContent ?? "");
    const extractedShell = classifyShellText(text);
    if (extractedShell) {
      throw new UnsupportedContentError(
        extractedShell,
        `Extracted content is a ${extractedShell.replace(/_/g, " ")} shell`,
      );
    }
    const lenient = articleEvidence || forceArticle;
    const minWords = lenient ? MIN_WORDS : MIN_WORDS_UNMARKED;
    const maxLinkDensity = lenient ? MAX_LINK_DENSITY : MAX_LINK_DENSITY_UNMARKED;
    if (wordCount(text) < minWords) {
      throw new UnsupportedContentError("too_short", "Extracted content is too short to read");
    }
    if (linkDensity(contentRoot) > maxLinkDensity) {
      throw new UnsupportedContentError("not_an_article", "Content is mostly links, not an article");
    }

    const title = parsed?.title?.trim() || meta.title;
    const description = meta.description || (parsed?.excerpt ? normalizeSpace(parsed.excerpt) : null);

    convertEmbedsToLinks(contentRoot, url);
    removeDuplicateLeadingHeading(contentRoot, title);
    removeDuplicateLeadingParagraph(contentRoot, description);

    const contentHtml = sanitizeHtml(contentRoot.innerHTML, SANITIZE_OPTIONS).trim();
    if (!contentHtml) {
      throw new UnsupportedContentError("too_short", "Extracted content is empty after sanitizing");
    }
    const contentText = toPlainText(contentHtml);
    const readingTimeMinutes = Math.max(1, Math.round(wordCount(contentText) / WORDS_PER_MINUTE));

    return {
      title: title.slice(0, 500),
      description: description ? description.slice(0, 1000) : null,
      author: (parsed?.byline?.trim() || meta.author)?.slice(0, 200) ?? null,
      publishedAt: toIsoDate(parsed?.publishedTime ?? meta.publishedTime),
      domain,
      readingTimeMinutes,
      contentHtml,
      contentMarkdown: "",
      contentText: contentText.slice(0, 200_000),
    };
  } finally {
    fragmentClose?.();
    page.close();
  }
}

function stripNonContentTags(document: Document): void {
  document
    .querySelectorAll("script, style, noscript, template, form, button, input, select, textarea, canvas, svg, dialog")
    .forEach((el) => el.remove());
}

function narrowArticleFallback(document: Document): Element | null {
  const viable = Array.from(document.querySelectorAll("article"))
    .filter((el) => wordCount(el.textContent ?? "") >= MIN_WORDS)
    .filter((el) => linkDensity(el) <= MAX_LINK_DENSITY)
    .sort((a, b) => (b.textContent ?? "").length - (a.textContent ?? "").length);
  if (viable.length === 0) return null;
  return viable[0].cloneNode(true) as Element;
}

/** Last-resort body capture for a user-forced article with no <article> node. */
function wideBodyFallback(document: Document): Element | null {
  const body = document.body;
  if (!body) return null;
  if (wordCount(body.textContent ?? "") < MIN_WORDS) return null;
  if (linkDensity(body) > MAX_LINK_DENSITY) return null;
  return body.cloneNode(true) as Element;
}

function parseFragment(html: string): { root: Element; close: () => void } {
  const dom = createDom(`<!doctype html><body>${html}</body>`);
  return {
    root: (dom.window.document.body ?? dom.window.document.documentElement) as Element,
    close: () => dom.window.close(),
  };
}

function unwrapLayoutRoots(root: Element): void {
  for (let guard = 0; guard < 10; guard += 1) {
    const meaningful = Array.from(root.childNodes).filter(
      (node) =>
        !(node.nodeType === 3 && !(node.textContent ?? "").trim()) && node.nodeType !== 8,
    );
    const only = meaningful.length === 1 && meaningful[0].nodeType === 1
      ? (meaningful[0] as Element)
      : null;
    if (!only) return;
    const tag = only.tagName.toLowerCase();
    if (tag !== "div" && tag !== "article" && tag !== "section") return;
    const parent = only.parentNode;
    if (!parent) return;
    while (only.firstChild) parent.insertBefore(only.firstChild, only);
    parent.removeChild(only);
  }
}

function convertEmbedsToLinks(root: Element, baseUrl: string): void {
  for (const el of Array.from(root.querySelectorAll("iframe, embed, object"))) {
    const src =
      el.getAttribute("src") ??
      el.querySelector('param[name="movie"]')?.getAttribute("value") ??
      "";
    let href: string | null = null;
    if (src) {
      try {
        const resolved = new URL(src, baseUrl);
        if (resolved.protocol === "http:" || resolved.protocol === "https:") {
          href = resolved.toString();
        }
      } catch {
        href = null;
      }
    }
    if (!href) {
      el.remove();
      continue;
    }
    const doc = el.ownerDocument;
    if (!doc) {
      el.remove();
      continue;
    }
    const p = doc.createElement("p");
    const a = doc.createElement("a");
    a.setAttribute("href", href);
    a.textContent = href;
    p.appendChild(a);
    el.replaceWith(p);
  }
}

function removeDuplicateLeadingHeading(root: Element, title: string): void {
  const first = firstLeadingContentElement(root);
  if (!first) return;
  const tag = first.tagName.toLowerCase();
  if (tag !== "h1" && tag !== "h2") return;
  if (duplicatesTitle(title, first.textContent ?? "")) first.remove();
}

function removeDuplicateLeadingParagraph(root: Element, description: string | null): void {
  if (!description) return;
  const first = firstLeadingContentElement(root);
  if (!first || first.tagName.toLowerCase() !== "p") return;
  if (hasSameText(description, first.textContent ?? "")) first.remove();
}

function firstLeadingContentElement(root: Element): Element | null {
  for (const node of Array.from(root.childNodes)) {
    if (node.nodeType === 3) {
      if (!(node.textContent ?? "").trim()) continue;
      return null;
    }
    if (node.nodeType === 8) continue;
    if (node.nodeType !== 1) return null;

    const element = node as Element;
    const tag = element.tagName.toLowerCase();
    if (["figure", "picture", "img"].includes(tag)) continue;
    if (
      tag === "a" &&
      !normalizeSpace(element.textContent ?? "") &&
      element.querySelector("img, picture")
    ) {
      continue;
    }
    if (["article", "div", "header", "section"].includes(tag)) {
      const nested = firstLeadingContentElement(element);
      if (nested) return nested;
      if (!normalizeSpace(element.textContent ?? "")) continue;
    }
    return element;
  }
  return null;
}

function toPlainText(html: string): string {
  const dom = createDom(`<!doctype html><body>${html}</body>`);
  try {
    return (dom.window.document.body?.textContent ?? "").replace(/\s+\n/g, "\n").trim();
  } finally {
    dom.window.close();
  }
}

function safeHostname(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return url.slice(0, 255);
  }
}
