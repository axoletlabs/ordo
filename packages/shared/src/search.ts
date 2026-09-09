/**
 * Bookmark search matching and ranking. Used by the server (order of
 * /bookmarks/search) and the client (instant local reordering while typing).
 */

export interface SearchableBookmark {
  id?: string;
  title: string;
  url: string;
  domain: string;
  description: string | null;
  author?: string | null;
  tags: { name: string }[];
  createdAt: string;
  contentText?: string | null;
}

/** Trim, collapse whitespace, and lowercase for matching. */
export function normalizeSearchQuery(query: string): string {
  return query.trim().replace(/\s+/g, " ").toLocaleLowerCase("en-US");
}

function fold(value: string | null | undefined): string {
  return (value ?? "").toLocaleLowerCase("en-US");
}

function fieldScore(field: string, query: string, starts: number, includes: number): number {
  if (!field || !query) return 0;
  if (field === query) return starts + 20;
  if (field.startsWith(query)) return starts;
  if (field.includes(query)) return includes;
  return 0;
}

function tokensMatch(haystack: string, tokens: readonly string[]): boolean {
  return tokens.every((token) => haystack.includes(token));
}

/**
 * Higher is a better match. `0` means the visible fields do not contain the
 * query (article-body-only hits still score 0 when `contentText` is omitted).
 */
export function scoreBookmarkMatch(bookmark: SearchableBookmark, query: string): number {
  const q = normalizeSearchQuery(query);
  if (!q) return 0;

  const title = fold(bookmark.title);
  const domain = fold(bookmark.domain);
  const url = fold(bookmark.url);
  const description = fold(bookmark.description);
  const author = fold(bookmark.author);
  const tags = bookmark.tags.map((tag) => fold(tag.name));
  const body = fold(bookmark.contentText);
  const tagHaystack = tags.join(" ");
  const haystack = [title, domain, url, description, author, tagHaystack, body].join("\n");

  const tokens = q.split(" ").filter(Boolean);
  if (!haystack.includes(q) && !tokensMatch(haystack, tokens)) return 0;

  let score = 0;
  score += fieldScore(title, q, 100, 80);
  const tagExact = tags.some((name) => name === q);
  const tagStarts = tags.some((name) => name.startsWith(q));
  const tagIncludes = tags.some((name) => name.includes(q));
  if (tagExact) score += 70;
  else if (tagStarts) score += 60;
  else if (tagIncludes) score += 50;
  score += fieldScore(domain, q, 55, 45);
  score += fieldScore(url, q, 40, 30);
  score += fieldScore(description, q, 28, 22);
  score += fieldScore(author, q, 18, 14);
  if (body.includes(q)) score += 8;

  if (score === 0 && tokens.length > 1 && tokensMatch(haystack, tokens)) {
    score += 16;
  }

  const created = Date.parse(bookmark.createdAt);
  if (Number.isFinite(created)) {
    const ageDays = Math.max(0, (Date.now() - created) / 86_400_000);
    score += Math.max(0, 8 - Math.min(8, ageDays / 45));
  }

  return score;
}

export function bookmarkMatchesQuery(bookmark: SearchableBookmark, query: string): boolean {
  return scoreBookmarkMatch(bookmark, query) > 0;
}

/** Sort already-matched bookmarks. Does not drop zero-score (body-only) hits. */
export function rankSearchResults<T extends SearchableBookmark>(items: readonly T[], query: string): T[] {
  const q = normalizeSearchQuery(query);
  if (!q) {
    return [...items].sort((a, b) => {
      const byDate = b.createdAt.localeCompare(a.createdAt);
      if (byDate !== 0) return byDate;
      return (a.id ?? a.title).localeCompare(b.id ?? b.title);
    });
  }
  return [...items].sort((a, b) => {
    const delta = scoreBookmarkMatch(b, q) - scoreBookmarkMatch(a, q);
    if (delta !== 0) return delta;
    const byDate = b.createdAt.localeCompare(a.createdAt);
    if (byDate !== 0) return byDate;
    return (a.id ?? a.title).localeCompare(b.id ?? b.title);
  });
}
