/**
 * TextQuoteSelector-style article highlights.
 *
 * Anchors are the selected quote plus nearby prefix/suffix, so they survive
 * re-extraction better than HTML offsets. Rendering wraps matching text nodes
 * in `<mark id="ordo-hl-{id}">` without rewriting the stored article HTML.
 */
import type { HighlightDto } from "./types.js";

/** Keep in sync with HIGHLIGHT_MARK_ID_PREFIX / HIGHLIGHT_CONTEXT_LENGTH. */
const MARK_ID_PREFIX = "ordo-hl-";
const DEFAULT_CONTEXT = 32;

export interface HighlightAnchor {
  exact: string;
  prefix?: string;
  suffix?: string;
  href?: string | null;
}

export interface HighlightRange {
  start: number;
  end: number;
}

const BLOCK_TAGS = new Set([
  "p",
  "div",
  "h1",
  "h2",
  "h3",
  "h4",
  "h5",
  "h6",
  "li",
  "ul",
  "ol",
  "blockquote",
  "pre",
  "figure",
  "figcaption",
  "table",
  "thead",
  "tbody",
  "tfoot",
  "tr",
  "td",
  "th",
  "hr",
  "br",
  "section",
  "article",
  "header",
  "footer",
]);

const VOID_TAGS = new Set(["br", "hr", "img", "source"]);

interface TextPiece {
  decoded: string;
  href: string | null;
  /** Inserted between block tags for matching; never written back to HTML. */
  synthetic?: boolean;
}

interface TagPiece {
  raw: string;
  name: string;
  closing: boolean;
  block: boolean;
}

type Piece = { kind: "text"; text: TextPiece } | { kind: "tag"; tag: TagPiece };

export function highlightMarkId(id: string): string {
  return `${MARK_ID_PREFIX}${id}`;
}

export function highlightIdFromMark(domId: string | null | undefined): string | null {
  if (!domId?.startsWith(MARK_ID_PREFIX)) return null;
  const id = domId.slice(MARK_ID_PREFIX.length);
  return id || null;
}

/** Trim ends of a range and copy nearby context, W3C Text Quote style. */
export function quoteFromRange(
  text: string,
  start: number,
  end: number,
  context = DEFAULT_CONTEXT,
): HighlightAnchor | null {
  const length = text.length;
  let from = Math.max(0, Math.min(start, length));
  let to = Math.max(from, Math.min(end, length));
  while (from < to && /\s/.test(text[from] ?? "")) from += 1;
  while (to > from && /\s/.test(text[to - 1] ?? "")) to -= 1;
  if (from >= to) return null;
  return {
    exact: text.slice(from, to),
    prefix: text.slice(Math.max(0, from - context), from),
    suffix: text.slice(to, to + context),
  };
}

/**
 * Lift a selection inside a block onto the article's plain text so prefix
 * and suffix are document-global (needed when the block is not the first).
 *
 * Selection offsets come from the native text view, which collapses HTML
 * indent/newlines. Adding those offsets onto article plain (which still has
 * the raw whitespace) cuts the quote short — e.g. "graphical\\n                interface"
 * vs "graphical interface". Match the visual quote instead.
 */
export function quoteFromBlock(
  articlePlain: string,
  blockText: string,
  start: number,
  end: number,
  context = DEFAULT_CONTEXT,
): HighlightAnchor | null {
  const local = quoteFromRange(blockText, start, end, context);
  if (!local) return null;
  if (!articlePlain) return local;
  const range = findQuoteInPlain(articlePlain, local);
  if (!range) return local;
  return {
    exact: local.exact,
    prefix: articlePlain.slice(Math.max(0, range.start - context), range.start),
    suffix: articlePlain.slice(range.end, range.end + context),
  };
}

const QUOTE_MAX = 2000;
const POINT_WINDOW = 400;

/** Expand a caret in a block to a sentence (or a nearby window if it's huge). */
export function sentenceRange(text: string, index: number): HighlightRange | null {
  if (!text) return null;
  let caret = Math.max(0, Math.min(index, text.length));
  if (caret === text.length && caret > 0) caret -= 1;

  let start = 0;
  for (let i = 1; i <= caret; i += 1) {
    if (isSentenceBreak(text, i)) start = i;
  }
  let end = text.length;
  for (let i = caret + 1; i < text.length; i += 1) {
    if (isSentenceBreak(text, i)) {
      end = i;
      break;
    }
  }
  while (start < end && /\s/.test(text[start] ?? "")) start += 1;
  while (end > start && /\s/.test(text[end - 1] ?? "")) end -= 1;
  if (start >= end) return null;
  if (end - start > QUOTE_MAX) {
    start = Math.max(0, caret - POINT_WINDOW);
    end = Math.min(text.length, caret + POINT_WINDOW);
    while (start < end && /\s/.test(text[start] ?? "")) start += 1;
    while (end > start && /\s/.test(text[end - 1] ?? "")) end -= 1;
  }
  return start < end ? { start, end } : null;
}

function isSentenceBreak(text: string, i: number): boolean {
  const prev = text[i - 1];
  if (prev === "\n") return true;
  if ((prev === "." || prev === "!" || prev === "?") && (i === text.length || /\s/.test(text[i] ?? ""))) {
    return true;
  }
  return false;
}

/** Map a press inside a block onto a TextQuoteSelector-style anchor. */
export function quoteFromCaret(
  articlePlain: string,
  blockText: string,
  index: number,
  context = DEFAULT_CONTEXT,
): HighlightAnchor | null {
  const range = sentenceRange(blockText, index);
  if (!range) return quoteFromRange(blockText, 0, blockText.length, context);
  return quoteFromBlock(articlePlain, blockText, range.start, range.end, context);
}

export function htmlToPlainText(html: string): string {
  return buildPlain(tokenize(html)).plain;
}

export function canAnchorHighlight(html: string, anchor: HighlightAnchor): boolean {
  return findHighlightRange(html, anchor) !== null;
}

export function findHighlightRange(html: string, anchor: HighlightAnchor): HighlightRange | null {
  const { plain, pieces } = buildPlain(tokenize(html));
  const quote = findQuoteInPlain(plain, anchor);
  if (quote) return quote;
  if (!anchor.href) return null;
  return findHrefRange(plain, pieces, anchor.href, anchor.exact);
}

type HighlightQuote = Pick<HighlightDto, "id" | "exact" | "prefix" | "suffix" | "href">;

/**
 * Highlight whose wrapped range fully contains the current selection.
 * Used to offer "Remove highlight" when the user selects already-highlighted text.
 */
export function findHighlightForSelection(
  html: string,
  highlights: readonly HighlightQuote[],
  selection: HighlightAnchor,
): string | null {
  if (highlights.length === 0) return null;
  if (html) {
    const selected = findHighlightRange(html, selection);
    if (selected) {
      let best: { id: string; span: number } | null = null;
      for (const highlight of highlights) {
        const range = findHighlightRange(html, highlight);
        if (!range) continue;
        if (selected.start >= range.start && selected.end <= range.end) {
          const span = range.end - range.start;
          if (!best || span < best.span) best = { id: highlight.id, span };
        }
      }
      if (best) return best.id;
    }
  }
  const prefix = selection.prefix ?? "";
  const suffix = selection.suffix ?? "";
  const tight = highlights.find(
    (row) => row.exact === selection.exact && row.prefix === prefix && row.suffix === suffix,
  );
  if (tight) return tight.id;
  const sameExact = highlights.filter((row) => row.exact === selection.exact);
  return sameExact.length === 1 ? sameExact[0]!.id : null;
}

/** Wrap every anchored highlight in `<mark id="ordo-hl-…">`. Unmatched rows are skipped. */
export function applyHighlightsToHtml(
  html: string,
  highlights: readonly Pick<HighlightDto, "id" | "exact" | "prefix" | "suffix" | "href">[],
): string {
  if (!html || highlights.length === 0) return html;
  const ordered = [...highlights].sort((a, b) => a.id.localeCompare(b.id));
  const ranges: Array<HighlightRange & { id: string }> = [];
  for (const highlight of ordered) {
    const range = findHighlightRange(html, highlight);
    if (!range) continue;
    if (ranges.some((existing) => overlaps(existing, range))) continue;
    ranges.push({ ...range, id: highlight.id });
  }
  ranges.sort((a, b) => a.start - b.start || a.end - b.end);
  if (ranges.length === 0) return html;
  return wrapRanges(html, ranges);
}

function overlaps(a: HighlightRange, b: HighlightRange): boolean {
  return a.start < b.end && b.start < a.end;
}

function findQuoteInPlain(plain: string, anchor: HighlightAnchor): HighlightRange | null {
  const exact = collapseWs(anchor.exact);
  if (!exact) return null;
  const prefix = collapseWs(anchor.prefix ?? "", { keepEdges: true });
  const suffix = collapseWs(anchor.suffix ?? "", { keepEdges: true });
  const { text, toOrig } = collapseMap(plain);
  let from = 0;
  while (from <= text.length - exact.length) {
    const index = text.indexOf(exact, from);
    if (index < 0) return null;
    const before = text.slice(0, index);
    const after = text.slice(index + exact.length);
    if (endsWithCollapsed(before, prefix) && startsWithCollapsed(after, suffix)) {
      const start = toOrig[index];
      const last = toOrig[index + exact.length - 1];
      if (start === undefined || last === undefined) return null;
      return { start, end: last + 1 };
    }
    from = index + 1;
  }
  return null;
}

function endsWithCollapsed(haystack: string, needle: string): boolean {
  if (!needle) return true;
  return haystack.endsWith(needle) || needle.endsWith(haystack);
}

function startsWithCollapsed(haystack: string, needle: string): boolean {
  if (!needle) return true;
  return haystack.startsWith(needle) || needle.startsWith(haystack);
}

function findHrefRange(
  plain: string,
  pieces: readonly Piece[],
  href: string,
  exact: string,
): HighlightRange | null {
  let offset = 0;
  let start = -1;
  let end = -1;
  const flush = (): HighlightRange | null => {
    if (start < 0 || end <= start) return null;
    const inner = findQuoteInPlain(plain.slice(start, end), { exact, prefix: "", suffix: "" });
    return inner ? { start: start + inner.start, end: start + inner.end } : { start, end };
  };
  for (const piece of pieces) {
    if (piece.kind === "tag") continue;
    const length = piece.text.decoded.length;
    if (piece.text.href === href && !piece.text.synthetic) {
      if (start < 0) start = offset;
      end = offset + length;
    } else if (start >= 0) {
      const range = flush();
      if (range) return range;
      start = -1;
      end = -1;
    }
    offset += length;
  }
  return flush();
}

function wrapRanges(html: string, ranges: Array<HighlightRange & { id: string }>): string {
  const pieces = tokenize(html);
  let offset = 0;
  let openId: string | null = null;
  let out = "";

  const closeMark = () => {
    if (!openId) return;
    out += "</mark>";
    openId = null;
  };
  const rangeAt = (at: number) => ranges.find((range) => at >= range.start && at < range.end) ?? null;

  for (const piece of pieces) {
    if (piece.kind === "tag") {
      closeMark();
      out += piece.tag.raw;
      continue;
    }
    if (piece.text.synthetic) {
      offset += piece.text.decoded.length;
      continue;
    }
    const decoded = piece.text.decoded;
    let local = 0;
    while (local < decoded.length) {
      const range = rangeAt(offset + local);
      const id = range?.id ?? null;
      if (id && openId !== id) {
        closeMark();
        out += `<mark id="${escapeAttr(highlightMarkId(id))}">`;
        openId = id;
      } else if (!id) {
        closeMark();
      }
      let next = local + 1;
      while (next < decoded.length) {
        const nextId = rangeAt(offset + next)?.id ?? null;
        if (nextId !== id) break;
        next += 1;
      }
      out += encodeHtml(decoded.slice(local, next));
      local = next;
    }
    offset += decoded.length;
  }
  closeMark();
  return out;
}

function tokenize(html: string): Piece[] {
  const pieces: Piece[] = [];
  const hrefStack: Array<string | null> = [];
  const re = /<!--[\s\S]*?-->|<\/?([a-zA-Z][a-zA-Z0-9]*)\b[^>]*>|[^<]+/g;
  let match: RegExpExecArray | null;
  const lastText = () => {
    for (let i = pieces.length - 1; i >= 0; i -= 1) {
      const piece = pieces[i];
      if (piece?.kind === "text") return piece.text.decoded;
    }
    return "";
  };
  while ((match = re.exec(html))) {
    const raw = match[0];
    if (raw.startsWith("<!--")) continue;
    if (raw.startsWith("<")) {
      const name = (match[1] ?? "").toLowerCase();
      const closing = raw.startsWith("</");
      const selfClosing = /\/\s*>$/.test(raw) || VOID_TAGS.has(name);
      if (name === "a") {
        if (closing) hrefStack.pop();
        else if (!selfClosing) hrefStack.push(attr(raw, "href"));
      }
      const opensBlock = BLOCK_TAGS.has(name) && (selfClosing || !closing);
      if (opensBlock && lastText() !== "" && !/[ \t\n\r]$/.test(lastText())) {
        pieces.push({
          kind: "text",
          text: { decoded: " ", href: hrefStack[hrefStack.length - 1] ?? null, synthetic: true },
        });
      }
      pieces.push({
        kind: "tag",
        tag: { raw, name, closing, block: BLOCK_TAGS.has(name) },
      });
      continue;
    }
    pieces.push({
      kind: "text",
      text: {
        decoded: decodeHtml(raw),
        href: hrefStack[hrefStack.length - 1] ?? null,
      },
    });
  }
  return pieces;
}

function buildPlain(pieces: readonly Piece[]): { plain: string; pieces: readonly Piece[] } {
  let plain = "";
  for (const piece of pieces) {
    if (piece.kind === "text") plain += piece.text.decoded;
  }
  return { plain, pieces };
}

function attr(raw: string, name: string): string | null {
  const match = new RegExp(`\\b${name}\\s*=\\s*("([^"]*)"|'([^']*)')`, "i").exec(raw);
  if (!match) return null;
  return decodeHtml(match[2] ?? match[3] ?? "");
}

function collapseWs(input: string, opts?: { keepEdges?: boolean }): string {
  const collapsed = collapseMap(input).text;
  if (!opts?.keepEdges) return collapsed;
  const lead = /^\s/.test(input) && collapsed.length > 0 ? " " : "";
  const trail = /\s$/.test(input) && collapsed.length > 0 ? " " : "";
  return `${lead}${collapsed}${trail}`.replace(/ {2,}/g, " ");
}

function collapseMap(input: string): { text: string; toOrig: number[] } {
  const toOrig: number[] = [];
  let text = "";
  let i = 0;
  while (i < input.length) {
    const ch = input[i]!;
    if (/\s/.test(ch)) {
      const start = i;
      while (i < input.length && /\s/.test(input[i] ?? "")) i += 1;
      if (text.length > 0 && i < input.length) {
        text += " ";
        toOrig.push(start);
      }
      continue;
    }
    text += ch;
    toOrig.push(i);
    i += 1;
  }
  return { text, toOrig };
}

function decodeHtml(value: string): string {
  return value
    .replace(/&nbsp;/gi, "\u00a0")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&#x([0-9a-f]+);/gi, (_, hex: string) => codePoint(parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_, dec: string) => codePoint(Number(dec)));
}

function encodeHtml(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function escapeAttr(value: string): string {
  return encodeHtml(value).replace(/"/g, "&quot;");
}

function codePoint(value: number): string {
  if (!Number.isFinite(value) || value < 0) return "";
  try {
    return String.fromCodePoint(value);
  } catch {
    return "";
  }
}
