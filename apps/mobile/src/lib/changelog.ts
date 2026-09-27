/**
 * Release notes for published updates.
 * GitHub release bodies are short prose: paragraphs, lists, `code`, **bold**,
 * and https links. Everything else stays as written.
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
  | { type: "strong"; text: string }
  | { type: "link"; text: string; href: string };

export type ChangelogBlock =
  | { type: "paragraph"; inlines: ChangelogInline[] }
  | { type: "heading"; text: string }
  | { type: "list"; items: ChangelogInline[][] };

export type ChangelogMark = "installed" | "available" | "early";

export interface GithubReleaseNote {
  tag_name?: string;
  body?: string;
  draft?: boolean;
  prerelease?: boolean;
  published_at?: string;
}

const TOKEN =
  /(`[^`\n]+`)|(\*\*[^*\n]+\*\*)|(\[([^\]\n]+)\]\(([^)\s]+)\))|(https:\/\/[^\s<>)\]]+)/g;

const LIST_ITEM = /^\s*(?:[-*•]|\d+[.)])\s+(\S.*)$/;
const HEADING = /^#{1,3}\s+(\S.*)$/;
const RULE = /^\s*([-*_])\1{2,}\s*$/;

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

function trimUrlTail(value: string): { href: string; rest: string } {
  let href = value;
  let rest = "";
  while (href.length > 0 && /[.,;:!?)]$/.test(href)) {
    rest = href.slice(-1) + rest;
    href = href.slice(0, -1);
  }
  return { href, rest };
}

/** Split one line of release notes into text, code, emphasis, and links. */
export function parseChangelogInlines(source: string): ChangelogInline[] {
  const inlines: ChangelogInline[] = [];
  let last = 0;
  for (const match of source.matchAll(TOKEN)) {
    const index = match.index ?? 0;
    if (index > last) inlines.push({ type: "text", text: source.slice(last, index) });
    if (match[1]) {
      inlines.push({ type: "code", text: match[1].slice(1, -1) });
    } else if (match[2]) {
      inlines.push({ type: "strong", text: match[2].slice(2, -2) });
    } else if (match[4] && match[5]) {
      const href = changelogHref(match[5]);
      inlines.push(href ? { type: "link", text: match[4], href } : { type: "text", text: match[4] });
    } else if (match[6]) {
      const trimmed = trimUrlTail(match[6]);
      const href = changelogHref(trimmed.href);
      if (href) {
        inlines.push({ type: "link", text: trimmed.href, href });
        if (trimmed.rest) inlines.push({ type: "text", text: trimmed.rest });
      } else {
        inlines.push({ type: "text", text: match[6] });
      }
    }
    last = index + match[0].length;
  }
  if (last < source.length) inlines.push({ type: "text", text: source.slice(last) });
  return inlines.filter((part) => part.type !== "text" || part.text.length > 0);
}

function pushParagraph(blocks: ChangelogBlock[], lines: string[]): void {
  const text = lines.join(" ").replace(/[ \t]+/g, " ").trim();
  if (!text) return;
  const inlines = parseChangelogInlines(text);
  if (inlines.length === 0) return;
  blocks.push({ type: "paragraph", inlines });
}

/** Turn a GitHub release body into blocks the changelog screen can render. */
export function parseChangelogBody(body: string): ChangelogBlock[] {
  const lines = body.replace(/\r\n/g, "\n").split("\n");
  const blocks: ChangelogBlock[] = [];
  let paragraph: string[] = [];
  let list: ChangelogInline[][] | null = null;

  const flushParagraph = () => {
    if (paragraph.length === 0) return;
    pushParagraph(blocks, paragraph);
    paragraph = [];
  };
  const flushList = () => {
    if (!list || list.length === 0) {
      list = null;
      return;
    }
    blocks.push({ type: "list", items: list });
    list = null;
  };

  for (const line of lines) {
    if (line.trim() === "" || RULE.test(line)) {
      flushParagraph();
      flushList();
      continue;
    }
    const heading = line.match(HEADING);
    if (heading) {
      flushParagraph();
      flushList();
      blocks.push({ type: "heading", text: heading[1].trim() });
      continue;
    }
    const item = line.match(LIST_ITEM);
    if (item) {
      flushParagraph();
      const inlines = parseChangelogInlines(item[1].trim());
      if (inlines.length === 0) continue;
      list ??= [];
      list.push(inlines);
      continue;
    }
    flushList();
    paragraph.push(line.trim());
  }
  flushParagraph();
  flushList();
  return blocks;
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
