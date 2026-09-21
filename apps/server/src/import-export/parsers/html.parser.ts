/**
 * Netscape bookmark HTML parser.
 *
 * Walks the well-known `<DL><p> / <DT><H3> / <DT><A>` structure with a small
 * tag tokenizer: folder headings push onto a path stack when their `<DL>`
 * opens and pop when it closes, links become entries tagged with the current
 * path. Tolerant of attribute order, quoting style, case, and missing pieces.
 */
import { isSupportedUrl } from "@ordo/shared";
import type { InvalidRow, ParseResult, ParsedEntry } from "./parse-utils";
import { coerceDate, decodeEntities, sanitizeTitle, stripBrowserRootFolders, ensureImportRowBudget } from "./parse-utils";

interface TagMatch {
  tag: string;
  closing: boolean;
  attrs: string;
  index: number;
}

function readAttrs(source: string): Record<string, string> {
  const attrs: Record<string, string> = {};
  const attrRe = /([\w:-]+)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'>]+))/gi;
  let m: RegExpExecArray | null;
  while ((m = attrRe.exec(source)) !== null) {
    const name = m[1].toLowerCase();
    attrs[name] = decodeEntities(m[2] ?? m[3] ?? m[4] ?? "");
  }
  return attrs;
}

function textUntil(html: string, from: number, closingTag: RegExp): string {
  const slice = html.slice(from);
  const end = slice.search(closingTag);
  const text = end === -1 ? slice : slice.slice(0, end);
  return decodeEntities(text);
}

function countLine(html: string, index: number): number {
  let line = 1;
  for (let i = 0; i < index && i < html.length; i += 1) {
    if (html.charCodeAt(i) === 10) line += 1;
  }
  return line;
}

/**
 * Parse Netscape bookmark HTML. `invalid` collects rows with unusable hrefs
 * (missing, non-http(s), too long); their titles/paths are still reported.
 */
export function parseNetscapeHtml(html: string): ParseResult {
  const entries: ParsedEntry[] = [];
  const invalid: InvalidRow[] = [];

  // Folder path stack. `null` marks a DL that opened without a heading —
  // a transparent level that contributes nothing to the path.
  const stack: (string | null)[] = [];
  let pendingFolder: string | null = null;

  const tagRe = /<(\/?)(dl|h3|a)\b([^>]*)>/gi;
  let m: RegExpExecArray | null;
  while ((m = tagRe.exec(html)) !== null) {
    const match: TagMatch = {
      tag: m[2].toLowerCase(),
      closing: m[1] === "/",
      attrs: m[3] ?? "",
      index: m.index,
    };

    if (match.tag === "dl") {
      if (match.closing) {
        stack.pop();
      } else {
        stack.push(pendingFolder);
        pendingFolder = null;
      }
      continue;
    }

    if (match.tag === "h3" && !match.closing) {
      const attrs = readAttrs(match.attrs);
      const name = sanitizeTitle(textUntil(html, tagRe.lastIndex, /<\/h3>/i));
      const transparent =
        truthyAttr(attrs.personal_toolbar_folder) || truthyAttr(attrs.unfiled_bookmarks_folder);
      pendingFolder = transparent ? null : name || null;
      continue;
    }

    if (match.tag === "a" && !match.closing) {
      const attrs = readAttrs(match.attrs);
      const title = sanitizeTitle(textUntil(html, tagRe.lastIndex, /<\/a>/i));
      const href = (attrs.href ?? "").trim();
      const folderPath = stripBrowserRootFolders(stack.filter((s): s is string => s !== null));

      if (!href) {
        invalid.push({ line: countLine(html, match.index), reason: "Missing URL.", url: null });
        continue;
      }
      if (!isSupportedUrl(href)) {
        invalid.push({
          line: countLine(html, match.index),
          reason: "Only http(s) URLs can be imported.",
          url: href.slice(0, 200),
        });
        continue;
      }
      if (href.length > 2048) {
        invalid.push({
          line: countLine(html, match.index),
          reason: "URL is longer than 2048 characters.",
          url: href.slice(0, 200),
        });
        continue;
      }

      const createdAt = coerceDate(attrs.add_date);
      const tags = (attrs.tags ?? "")
        .split(",")
        .map((t) => t.trim())
        .filter((t) => t.length > 0)
        .slice(0, 20);

      ensureImportRowBudget(entries.length);
      entries.push({
        url: href,
        title,
        folderPath,
        tags,
        isRead: false,
        readProgress: 0,
        completedAt: null,
        createdAt,
        updatedAt: createdAt,
        description: null,
        author: null,
        publishedAt: null,
        readingTimeMinutes: null,
      });
    }
  }

  return { format: "netscape-html", entries, invalid, folders: [] };
}

function truthyAttr(value: string | undefined): boolean {
  return (value ?? "").trim().toLowerCase() === "true";
}
