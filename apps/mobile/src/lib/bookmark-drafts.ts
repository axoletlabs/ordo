import { isSupportedUrl, normalizeUrlForMatch } from "@ordo/shared";

export interface BookmarkDraft {
  id: number;
  url: string;
  error?: string;
}

export function bookmarkDraftsFromUrls(urls: readonly string[]): BookmarkDraft[] {
  return (urls.length ? urls : [""]).map((url, id) => ({ id, url }));
}

/** Replace the paste target and insert the remaining links directly after it.
 * Existing rows retain their identity, text, and validation. */
export function pasteBookmarkDrafts(drafts: BookmarkDraft[], targetId: number, urls: readonly string[], nextId: () => number): BookmarkDraft[] {
  if (!urls.length || !drafts.some(draft => draft.id === targetId)) return drafts;
  const seen = new Set(drafts.filter(draft => draft.id !== targetId && draft.url.trim())
    .map(draft => normalizeUrlForMatch(normalizeBookmarkDraft(draft.url))));
  seen.add(normalizeUrlForMatch(urls[0]));
  const inserted: BookmarkDraft[] = [];
  for (const url of urls.slice(1)) {
    const key = normalizeUrlForMatch(url);
    if (seen.has(key)) continue;
    seen.add(key);
    inserted.push({ id: nextId(), url });
  }
  return drafts.flatMap(draft => draft.id === targetId
    ? [{ ...draft, url: urls[0], error: undefined }, ...inserted] : [draft]);
}

export function normalizeBookmarkDraft(value: string): string {
  const trimmed = value.trim();
  const hasScheme = /^[a-z][a-z\d+.-]*:/i.test(trimmed)
    && !/^[^/?#\s]+:\d+(?:[/?#]|$)/.test(trimmed);
  return trimmed && !hasScheme ? `https://${trimmed}` : trimmed;
}

/** Validate the whole collection before starting any writes. Empty extra rows
 * are harmless; duplicate links stay editable rather than being saved twice. */
export function validateBookmarkDrafts(drafts: BookmarkDraft[]) {
  const seen = new Set<string>();
  const hasLinks = drafts.some((draft) => draft.url.trim());
  return drafts.map((draft, index) => {
    const url = normalizeBookmarkDraft(draft.url);
    // React Native's URL polyfill accepts spaces in a hostname that the
    // server's URL parser rejects. Check the authority before any writes.
    const authority = url.match(/^https?:\/\/([^/?#]*)/i)?.[1];
    let error: string | undefined;
    if (!url) {
      if (!hasLinks && index === 0) error = "Enter a link to save.";
    } else if (url.length > 2048) {
      error = "This link is too long. Use a link under 2,048 characters.";
    } else if (!authority || /[\s<>"`{}|\\^]/.test(authority) || !isSupportedUrl(url)) {
      error = "Enter a valid web address.";
    } else {
      const key = normalizeUrlForMatch(url);
      if (seen.has(key)) error = "This link is already in your list.";
      seen.add(key);
    }
    return { ...draft, error };
  });
}
