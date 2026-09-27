/**
 * Release notes for published updates.
 * Bodies are GitHub-flavored Markdown: headings, emphasis, links, images,
 * lists, quotes, tables, and fenced code. Raw HTML stays text.
 */
import {
  classifyReleaseVersion,
  compareReleaseCandidates,
  compareVersions,
  isNewerVersion,
  parseVersion,
  type VersionedRelease,
} from "./app-version";

export interface ChangelogRelease extends VersionedRelease {
  tagName: string;
  body: string;
}

export type ChangelogInline =
  | { type: "text"; text: string }
  | { type: "code"; text: string }
  | { type: "break" }
  | { type: "strong"; inlines: ChangelogInline[] }
  | { type: "em"; inlines: ChangelogInline[] }
  | { type: "del"; inlines: ChangelogInline[] }
  | { type: "link"; href: string; inlines: ChangelogInline[] }
  | { type: "image"; alt: string; href: string };

export type ChangelogAlign = "left" | "center" | "right";

export interface ChangelogListItem {
  kind: "bullet" | "number" | "task";
  index: number;
  checked: boolean | null;
  blocks: ChangelogBlock[];
}

export type ChangelogBlock =
  | { type: "paragraph"; inlines: ChangelogInline[] }
  | { type: "heading"; level: 1 | 2 | 3 | 4 | 5 | 6; inlines: ChangelogInline[] }
  | { type: "list"; items: ChangelogListItem[] }
  | { type: "quote"; blocks: ChangelogBlock[] }
  | { type: "code"; lang: string; text: string }
  | { type: "rule" }
  | { type: "table"; align: ChangelogAlign[]; header: ChangelogInline[][]; rows: ChangelogInline[][][] };

export type ChangelogMark = "installed" | "available" | "early";

export interface GithubReleaseNote {
  tag_name?: string;
  body?: string;
  draft?: boolean;
  prerelease?: boolean;
  published_at?: string;
}

const REF_DEF = /^ {0,3}\[([^\]]+)\]:\s+(<[^>\s]+>|\S+)(?:\s+\S.*)?$/;

/** https only, no embedded credentials. */
export function changelogHref(value: string): string | null {
  try {
    const url = new URL(value);
    if (url.protocol !== "https:") return null;
    if (url.username || url.password) return null;
    return url.toString();
  } catch {
    return null;
  }
}

type RefMap = Map<string, string>;

function trimUrlTail(value: string): { href: string; rest: string } {
  let href = value;
  let rest = "";
  while (href.length > 0 && /[.,;:!?)]$/.test(href)) {
    rest = href.slice(-1) + rest;
    href = href.slice(0, -1);
  }
  return { href, rest };
}

function compact(inlines: ChangelogInline[]): ChangelogInline[] {
  const out: ChangelogInline[] = [];
  for (const part of inlines) {
    if (part.type === "text" && part.text.length === 0) continue;
    const prev = out[out.length - 1];
    if (part.type === "text" && prev?.type === "text") {
      prev.text += part.text;
      continue;
    }
    out.push(part);
  }
  return out;
}

function readCodeSpan(source: string, index: number): { text: string; end: number } | null {
  let width = 0;
  while (source[index + width] === "`") width += 1;
  if (width === 0) return null;
  const closer = "`".repeat(width);
  const from = index + width;
  const at = source.indexOf(closer, from);
  if (at < 0) return null;
  let text = source.slice(from, at).replace(/\n/g, " ");
  if (text.startsWith(" ") && text.endsWith(" ") && text.trim().length > 0) text = text.slice(1, -1);
  return { text, end: at + width };
}

function findClosingBracket(source: string, index: number): number {
  let depth = 1;
  for (let i = index; i < source.length; i += 1) {
    if (source[i] === "\\") {
      i += 1;
      continue;
    }
    if (source[i] === "[") depth += 1;
    else if (source[i] === "]") {
      depth -= 1;
      if (depth === 0) return i;
    }
  }
  return -1;
}

function readDestination(source: string, index: number): { url: string; end: number } | null {
  let i = index;
  while (source[i] === " ") i += 1;
  let url = "";
  if (source[i] === "<") {
    const end = source.indexOf(">", i + 1);
    if (end < 0) return null;
    url = source.slice(i + 1, end);
    i = end + 1;
  } else {
    let depth = 0;
    while (i < source.length && source[i] !== " " && source[i] !== "\n") {
      if (source[i] === "(") depth += 1;
      if (source[i] === ")") {
        if (depth === 0) break;
        depth -= 1;
      }
      if (source[i] === "\\") {
        url += source[i + 1] ?? "";
        i += 2;
        continue;
      }
      url += source[i];
      i += 1;
    }
  }
  if (!url) return null;
  while (source[i] === " ") i += 1;
  const quote = source[i];
  if (quote === '"' || quote === "'") {
    const end = source.indexOf(quote, i + 1);
    if (end < 0) return null;
    i = end + 1;
    while (source[i] === " ") i += 1;
  }
  if (source[i] !== ")") return null;
  return { url, end: i + 1 };
}

function findCloser(source: string, from: number, mark: string, width: number): number {
  for (let i = from; i <= source.length - width; i += 1) {
    if (source[i] === "\\") {
      i += 1;
      continue;
    }
    if (source[i] === "`") {
      const code = readCodeSpan(source, i);
      if (code) {
        i = code.end - 1;
        continue;
      }
    }
    if (source[i] !== mark) continue;
    let run = 0;
    while (source[i + run] === mark) run += 1;
    if (run < width) {
      i += run - 1;
      continue;
    }
    const before = source[i - 1] ?? "";
    if (!before || /\s/.test(before)) {
      i += run - 1;
      continue;
    }
    return i;
  }
  return -1;
}

function emphasize(width: number, inlines: ChangelogInline[]): ChangelogInline {
  const inner = compact(inlines);
  if (width >= 3) return { type: "em", inlines: [{ type: "strong", inlines: inner }] };
  if (width === 2) return { type: "strong", inlines: inner };
  return { type: "em", inlines: inner };
}

function parseInlines(source: string, refs: RefMap): ChangelogInline[] {
  const nodes: ChangelogInline[] = [];
  let text = "";
  const flush = () => {
    if (!text) return;
    nodes.push({ type: "text", text });
    text = "";
  };

  let i = 0;
  while (i < source.length) {
    const ch = source[i] ?? "";
    if (ch === "\\") {
      const next = source[i + 1];
      if (next && /[\\`*_{}[\]()#+\-.!|~<>]/.test(next)) {
        text += next;
        i += 2;
        continue;
      }
    }
    if (ch === "\n") {
      flush();
      nodes.push({ type: "break" });
      i += 1;
      continue;
    }
    if (ch === "`") {
      const code = readCodeSpan(source, i);
      if (code) {
        flush();
        nodes.push({ type: "code", text: code.text });
        i = code.end;
        continue;
      }
    }
    if (source.startsWith("![", i)) {
      const image = readLink(source, i + 1, refs);
      if (image) {
        flush();
        const alt = inlinePlain(image.nodes);
        const link = image.nodes.find((part) => part.type === "link");
        if (link?.type === "link") nodes.push({ type: "image", alt, href: link.href });
        else nodes.push(...image.nodes);
        i = image.end;
        continue;
      }
    }
    if (ch === "[") {
      const link = readLink(source, i, refs);
      if (link) {
        flush();
        nodes.push(...link.nodes);
        i = link.end;
        continue;
      }
    }
    if (ch === "<") {
      const auto = source.slice(i).match(/^<(https:\/\/[^>\s]+)>/);
      if (auto) {
        const href = changelogHref(auto[1]);
        if (href) {
          flush();
          nodes.push({ type: "link", href, inlines: [{ type: "text", text: auto[1] }] });
          i += auto[0].length;
          continue;
        }
      }
    }
    if (source.startsWith("~~", i)) {
      const closer = findCloser(source, i + 2, "~", 2);
      if (closer > i + 2) {
        flush();
        nodes.push({ type: "del", inlines: parseInlines(source.slice(i + 2, closer), refs) });
        i = closer + 2;
        continue;
      }
    }
    if (ch === "*" || ch === "_") {
      const emphasis = readEmphasis(source, i, ch, refs);
      if (emphasis) {
        flush();
        nodes.push(emphasis.node);
        i = emphasis.end;
        continue;
      }
    }
    if (source.startsWith("https://", i)) {
      const raw = source.slice(i).match(/^https:\/\/[^\s<>)\]]+/)?.[0];
      if (raw) {
        const trimmed = trimUrlTail(raw);
        const href = changelogHref(trimmed.href);
        if (href) {
          flush();
          nodes.push({ type: "link", href, inlines: [{ type: "text", text: trimmed.href }] });
          text += trimmed.rest;
          i += raw.length;
          continue;
        }
      }
    }
    text += ch;
    i += 1;
  }
  flush();
  return compact(nodes);
}

function readEmphasis(
  source: string,
  index: number,
  mark: string,
  refs: RefMap,
): { node: ChangelogInline; end: number } | null {
  let run = 0;
  while (source[index + run] === mark) run += 1;
  const before = index === 0 ? "" : (source[index - 1] ?? "");
  const after = source[index + run] ?? "";
  if (!after || /\s/.test(after)) return null;
  if (mark === "_" && /[\p{L}\p{N}]/u.test(before)) return null;
  if (mark === "_" && /[\p{L}\p{N}]/u.test(before) && /[\p{L}\p{N}]/u.test(after)) return null;
  const widths = [3, 2, 1].filter((width) => width <= run);
  for (const width of widths) {
    const closer = findCloser(source, index + width, mark, width);
    if (closer < 0) continue;
    const inner = source.slice(index + width, closer);
    if (!inner.trim()) continue;
    return { node: emphasize(width, parseInlines(inner, refs)), end: closer + width };
  }
  return null;
}

function readLink(
  source: string,
  index: number,
  refs: RefMap,
): { nodes: ChangelogInline[]; end: number } | null {
  if (source[index] !== "[") return null;
  const labelEnd = findClosingBracket(source, index + 1);
  if (labelEnd < 0) return null;
  const label = source.slice(index + 1, labelEnd);
  const after = labelEnd + 1;

  if (source[after] === "(") {
    const dest = readDestination(source, after + 1);
    if (!dest) return null;
    const href = changelogHref(dest.url);
    const inlines = parseInlines(label, refs);
    if (!href) return { nodes: inlines.length > 0 ? inlines : [{ type: "text", text: label }], end: dest.end };
    return { nodes: [{ type: "link", href, inlines }], end: dest.end };
  }

  let ref = label;
  let end = labelEnd + 1;
  if (source[after] === "[") {
    if (source[after + 1] === "]") {
      end = after + 2;
    } else {
      const refEnd = findClosingBracket(source, after + 1);
      if (refEnd < 0) return null;
      ref = source.slice(after + 1, refEnd);
      end = refEnd + 1;
    }
  } else if (!refs.has(label.toLowerCase())) {
    return null;
  }

  const href = changelogHref(refs.get(ref.toLowerCase()) ?? "");
  const inlines = parseInlines(label, refs);
  if (!href) return { nodes: inlines.length > 0 ? inlines : [{ type: "text", text: label }], end };
  return { nodes: [{ type: "link", href, inlines }], end };
}

function inlinePlain(inlines: ChangelogInline[]): string {
  return inlines
    .map((part) => {
      if (part.type === "text" || part.type === "code") return part.text;
      if (part.type === "image") return part.alt;
      if (part.type === "break") return " ";
      if (part.type === "link" || part.type === "strong" || part.type === "em" || part.type === "del") {
        return inlinePlain(part.inlines);
      }
      return "";
    })
    .join("");
}

/** Split release-note text into inline markdown. */
export function parseChangelogInlines(source: string, refs: RefMap = new Map()): ChangelogInline[] {
  return parseInlines(source, refs);
}

function isRule(line: string): boolean {
  return /^ {0,3}(?:(?:-\s*){3,}|(?:\*\s*){3,}|(?:_\s*){3,})\s*$/.test(line);
}

function isSetextUnderline(line: string): boolean {
  return /^ {0,3}(?:=+|-+)\s*$/.test(line) && (line.match(/=|-/g)?.length ?? 0) >= 3;
}

function isFenceOpen(line: string): { mark: string; width: number; lang: string } | null {
  const match = line.match(/^ {0,3}(`{3,}|~{3,})\s*([^`]*)$/);
  if (!match) return null;
  const lang = match[2].trim().split(/\s+/)[0] ?? "";
  return { mark: match[1][0] ?? "`", width: match[1].length, lang };
}

function isFenceClose(line: string, mark: string, width: number): boolean {
  const match = line.match(/^ {0,3}([`~]+)\s*$/);
  if (!match) return false;
  const run = match[1];
  return run[0] === mark && run.length >= width && new Set(run).size === 1;
}

function matchItem(line: string): ChangelogListItem & { indent: number; text: string } | null {
  const match = line.match(/^(\s*)([-+*]|\d+[.)])\s+(?:\[([ xX])\]\s+)?(.*)$/);
  if (!match) return null;
  const indent = match[1]?.length ?? 0;
  const marker = match[2] ?? "";
  const task = match[3];
  const text = match[4] ?? "";
  if (task != null && marker.length === 1) {
    return { indent, kind: "task", index: 0, checked: task.toLowerCase() === "x", blocks: [], text };
  }
  if (marker === "-" || marker === "+" || marker === "*") {
    return { indent, kind: "bullet", index: 0, checked: null, blocks: [], text };
  }
  const index = Number.parseInt(marker, 10);
  if (!Number.isFinite(index)) return null;
  return { indent, kind: "number", index, checked: null, blocks: [], text };
}

function splitRow(line: string): string[] {
  let row = line.trim();
  if (row.startsWith("|")) row = row.slice(1);
  if (row.endsWith("|")) row = row.slice(0, -1);
  const cells: string[] = [];
  let current = "";
  for (let i = 0; i < row.length; i += 1) {
    if (row[i] === "\\") {
      current += row[i + 1] ?? "";
      i += 1;
      continue;
    }
    if (row[i] === "|") {
      cells.push(current.trim());
      current = "";
      continue;
    }
    current += row[i];
  }
  cells.push(current.trim());
  return cells;
}

function separatorAlign(line: string): ChangelogAlign[] | null {
  if (!line.includes("|") && !line.includes("-")) return null;
  const cells = splitRow(line);
  if (cells.length === 0) return null;
  const align: ChangelogAlign[] = [];
  for (const cell of cells) {
    const token = cell.trim();
    if (!/^:?-+:?$/.test(token)) return null;
    if (token.startsWith(":") && token.endsWith(":")) align.push("center");
    else if (token.endsWith(":")) align.push("right");
    else align.push("left");
  }
  return align;
}

function extractRefs(body: string): { lines: string[]; refs: RefMap } {
  const refs: RefMap = new Map();
  const lines: string[] = [];
  for (const line of body.split("\n")) {
    const match = line.match(REF_DEF);
    if (!match) {
      lines.push(line);
      continue;
    }
    const url = (match[2] ?? "").replace(/^<|>$/g, "");
    refs.set((match[1] ?? "").toLowerCase(), url);
  }
  return { lines, refs };
}

function paragraphFrom(lines: string[], refs: RefMap): ChangelogBlock | null {
  let source = "";
  lines.forEach((raw, index) => {
    let text = raw.replace(/^\s+/, "");
    let hard = false;
    if (text.endsWith("\\")) {
      hard = true;
      text = text.slice(0, -1).replace(/\s+$/, "");
    } else if (/\s{2}$/.test(text)) {
      hard = true;
      text = text.replace(/\s+$/, "");
    } else {
      text = text.replace(/\s+$/, "");
    }
    source += text;
    if (index < lines.length - 1) source += hard ? "\n" : " ";
  });
  const inlines = parseInlines(source, refs);
  if (inlines.length === 0) return null;
  return { type: "paragraph", inlines };
}

function isBlockStart(lines: string[], index: number): boolean {
  const line = lines[index] ?? "";
  if (line.trim() === "") return true;
  if (isFenceOpen(line)) return true;
  if (/^ {0,3}#{1,6}(\s|$)/.test(line)) return true;
  if (isRule(line)) return true;
  if (/^ {0,3}>\s?/.test(line)) return true;
  const item = matchItem(line);
  if (item && item.indent <= 3) return true;
  if (index + 1 < lines.length && line.includes("|") && separatorAlign(lines[index + 1] ?? "")) return true;
  return false;
}

function parseList(
  lines: string[],
  start: number,
  end: number,
  baseIndent: number,
  refs: RefMap,
): { block: ChangelogBlock; next: number } {
  const items: ChangelogListItem[] = [];
  let i = start;
  while (i < end) {
    if ((lines[i] ?? "").trim() === "") {
      let look = i + 1;
      while (look < end && (lines[look] ?? "").trim() === "") look += 1;
      const upcoming = look < end ? matchItem(lines[look] ?? "") : null;
      if (upcoming && upcoming.indent >= baseIndent) {
        i = look;
        continue;
      }
      break;
    }
    const item = matchItem(lines[i] ?? "");
    if (!item || item.indent < baseIndent) break;
    if (item.indent > baseIndent) {
      if (items.length === 0) break;
      const nested = parseList(lines, i, end, item.indent, refs);
      items[items.length - 1]?.blocks.push(nested.block);
      i = nested.next;
      continue;
    }
    i += 1;
    const extra: string[] = [];
    while (i < end && (lines[i] ?? "").trim() !== "") {
      const nestedItem = matchItem(lines[i] ?? "");
      if (nestedItem) break;
      const indent = (lines[i] ?? "").match(/^\s*/)?.[0].length ?? 0;
      if (indent <= baseIndent || isBlockStart(lines, i)) break;
      extra.push((lines[i] ?? "").trim());
      i += 1;
    }
    const text = [item.text, ...extra].filter((part) => part.length > 0).join(" ");
    const blocks: ChangelogBlock[] = [];
    if (text) {
      const paragraph = paragraphFrom([text], refs);
      if (paragraph) blocks.push(paragraph);
    }
    items.push({ kind: item.kind, index: item.index, checked: item.checked, blocks });
  }
  return { block: { type: "list", items }, next: i };
}

function parseBlockLines(lines: string[], start: number, end: number, refs: RefMap): ChangelogBlock[] {
  const blocks: ChangelogBlock[] = [];
  let i = start;
  while (i < end) {
    const line = lines[i] ?? "";
    if (line.trim() === "") {
      i += 1;
      continue;
    }

    const fence = isFenceOpen(line);
    if (fence) {
      const content: string[] = [];
      i += 1;
      while (i < end && !isFenceClose(lines[i] ?? "", fence.mark, fence.width)) {
        content.push(lines[i] ?? "");
        i += 1;
      }
      if (i < end) i += 1;
      blocks.push({ type: "code", lang: fence.lang, text: content.join("\n").replace(/\n$/, "") });
      continue;
    }

    const heading = line.match(/^ {0,3}(#{1,6})\s+(\S.*?)\s*#*\s*$/);
    if (heading?.[1] && heading[2]) {
      blocks.push({
        type: "heading",
        level: heading[1].length as 1 | 2 | 3 | 4 | 5 | 6,
        inlines: parseInlines(heading[2].trim(), refs),
      });
      i += 1;
      continue;
    }

    if (/^ {0,3}>\s?/.test(line)) {
      const quoted: string[] = [];
      while (i < end && /^ {0,3}>\s?/.test(lines[i] ?? "")) {
        quoted.push((lines[i] ?? "").replace(/^ {0,3}>\s?/, ""));
        i += 1;
      }
      blocks.push({ type: "quote", blocks: parseBlockLines(quoted, 0, quoted.length, refs) });
      continue;
    }

    const item = matchItem(line);
    if (item && item.indent <= 3) {
      const list = parseList(lines, i, end, item.indent, refs);
      blocks.push(list.block);
      i = list.next;
      continue;
    }

    if (i + 1 < end && line.includes("|") && separatorAlign(lines[i + 1] ?? "")) {
      const align = separatorAlign(lines[i + 1] ?? "") ?? [];
      const header = splitRow(line).map((cell) => parseInlines(cell, refs));
      i += 2;
      const rows: ChangelogInline[][][] = [];
      while (i < end && (lines[i] ?? "").trim() !== "" && (lines[i] ?? "").includes("|") && !isRule(lines[i] ?? "")) {
        rows.push(splitRow(lines[i] ?? "").map((cell) => parseInlines(cell, refs)));
        i += 1;
      }
      blocks.push({ type: "table", align, header, rows });
      continue;
    }

    if (/^(?: {4}|\t)/.test(line)) {
      const code: string[] = [];
      while (i < end && (/^(?: {4}|\t)/.test(lines[i] ?? "") || (lines[i] ?? "").trim() === "")) {
        if ((lines[i] ?? "").trim() === "") {
          let look = i + 1;
          while (look < end && (lines[look] ?? "").trim() === "") look += 1;
          if (look < end && /^(?: {4}|\t)/.test(lines[look] ?? "")) {
            code.push("");
            i += 1;
            continue;
          }
          break;
        }
        code.push((lines[i] ?? "").replace(/^(?: {4}|\t)/, ""));
        i += 1;
      }
      blocks.push({ type: "code", lang: "", text: code.join("\n") });
      continue;
    }

    const paragraph: string[] = [];
    while (i < end && !isBlockStart(lines, i)) {
      if (paragraph.length > 0 && isSetextUnderline(lines[i] ?? "")) break;
      paragraph.push(lines[i] ?? "");
      i += 1;
    }
    if (paragraph.length === 0) {
      if (isRule(line)) blocks.push({ type: "rule" });
      i += 1;
      continue;
    }
    const next = lines[i] ?? "";
    if (paragraph.length === 1 && isSetextUnderline(next)) {
      const text = paragraph[0]?.trim() ?? "";
      if (text) {
        blocks.push({
          type: "heading",
          level: next.trim().startsWith("=") ? 1 : 2,
          inlines: parseInlines(text, refs),
        });
      }
      i += 1;
      continue;
    }
    const block = paragraphFrom(paragraph, refs);
    if (block) blocks.push(block);
    if (isRule(next)) {
      blocks.push({ type: "rule" });
      i += 1;
    }
  }
  return blocks;
}

/** Turn a GitHub release body into blocks the changelog screen can render. */
export function parseChangelogBody(body: string): ChangelogBlock[] {
  const normalized = body.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
  const { lines, refs } = extractRefs(normalized);
  return parseBlockLines(lines, 0, lines.length, refs);
}

export function versionsMatch(left: string, right: string): boolean {
  if (!parseVersion(left) || !parseVersion(right)) return false;
  return compareVersions(left, right) === 0;
}

/**
 * Installed wins over an offered update. An offered newer build is Available.
 * Other pre-releases stay Early access. An unreadable current version matches nothing.
 */
export function changelogMark(
  release: Pick<ChangelogRelease, "version" | "prerelease">,
  currentVersion: string,
  availableVersion: string | null,
): ChangelogMark | null {
  if (versionsMatch(release.version, currentVersion)) return "installed";
  if (
    availableVersion &&
    versionsMatch(release.version, availableVersion) &&
    isNewerVersion(release.version, currentVersion)
  ) {
    return "available";
  }
  if (release.prerelease) return "early";
  return null;
}

export function changelogReleaseFromGithub(release: GithubReleaseNote): ChangelogRelease | null {
  if (release.draft) return null;
  const version = classifyReleaseVersion(release.tag_name ?? "")?.version ?? null;
  if (!version || !release.published_at) return null;
  const classified = classifyReleaseVersion(version);
  return {
    version,
    tagName: release.tag_name!.trim(),
    publishedAt: release.published_at,
    prerelease: !!release.prerelease || classified?.kind === "prerelease",
    body: release.body?.trim() ?? "",
  };
}

/** Newest first. The same tag keeps the later payload. Drafts and non-versions drop out. */
export function changelogFromGithubPayload(releases: GithubReleaseNote[]): ChangelogRelease[] {
  const byTag = new Map<string, ChangelogRelease>();
  for (const release of releases) {
    const entry = changelogReleaseFromGithub(release);
    if (entry) byTag.set(entry.tagName, entry);
  }
  return [...byTag.values()].sort((left, right) => compareReleaseCandidates(right, left));
}

export function isChangelogReleaseList(value: unknown): value is ChangelogRelease[] {
  if (!Array.isArray(value)) return false;
  return value.every((item) => {
    if (!item || typeof item !== "object") return false;
    const row = item as Partial<ChangelogRelease>;
    return (
      typeof row.version === "string" &&
      typeof row.tagName === "string" &&
      typeof row.publishedAt === "string" &&
      typeof row.body === "string" &&
      typeof row.prerelease === "boolean"
    );
  });
}
