import { normalizeUrlForMatch } from "@ordo/shared";

function normalizeSharedUrl(candidate: string): string | null {
  let trimmed = candidate.replace(/[.,;:!?]+$/, "");
  for (const [opening, closing] of [["(", ")"], ["[", "]"], ["{", "}"]]) {
    while (trimmed.endsWith(closing) && trimmed.split(closing).length > trimmed.split(opening).length) {
      trimmed = trimmed.slice(0, -1);
    }
  }
  // RN's URL polyfill is more permissive about malformed authorities.
  const authority = trimmed.match(/^https?:\/\/([^/?#]*)/i)?.[1];
  if (!authority || /[\s<>"`{}|\\^]/.test(authority)) return null;
  try {
    const url = new URL(trimmed);
    return url.hostname && (url.protocol === "http:" || url.protocol === "https:") ? url.toString() : null;
  } catch {
    return null;
  }
}

/** Extract every HTTP(S) link, in order, from a share or clipboard. The share
 * library's webUrl is a best-effort excerpt of text and can truncate paths;
 * use it only when the original text contains no links.
 * Keep query strings, fragments, and balanced URL parentheses intact. */
export function extractSharedUrls(webUrl?: string | null, text?: string | null): string[] {
  const urls: string[] = [];
  const seen = new Set<string>();
  for (const source of [text, webUrl]) {
    for (const match of source?.matchAll(/https?:\/\/[^\s<>"']+/gi) ?? []) {
      // Also accept comma/semicolon separated lists without breaking commas
      // inside an individual URL or a nested URL in a query parameter.
      for (const candidate of match[0].split(/[,;](?=https?:\/\/)/i)) {
        const url = normalizeSharedUrl(candidate);
        if (!url) continue;
        const key = normalizeUrlForMatch(url);
        if (seen.has(key)) continue;
        seen.add(key);
        urls.push(url);
      }
    }
    if (urls.length) break;
  }
  return urls;
}

/** Single-link compatibility for callers that explicitly need one URL. */
export function extractSharedUrl(webUrl?: string | null, text?: string | null): string | null {
  return extractSharedUrls(webUrl, text)[0] ?? null;
}
