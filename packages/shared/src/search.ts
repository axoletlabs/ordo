/**
 * Bookmark search matching. Literal case-insensitive substring matching
 * (not fuzzy): every query token must appear in title, URL, domain,
 * description, author, tags, or article text. Title prefix ranks first.
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

/** Trim, collapse whitespace, and lowercase. */
export function normalizeSearchQuery(query: string): string {
  return query.trim().replace(/\s+/g, " ").toLocaleLowerCase("en-US");
}

export function tokenizeSearchQuery(query: string): string[] {
  const q = normalizeSearchQuery(query);
  return q ? q.split(" ") : [];
}

function fold(value: string | null | undefined): string {
  return (value ?? "").toLocaleLowerCase("en-US");
}

/** Lowercased blob used for `includes` checks. */
export function bookmarkSearchHaystack(bookmark: SearchableBookmark): string {
  return [
    bookmark.title,
    bookmark.url,
    bookmark.domain,
    bookmark.description ?? "",
    bookmark.author ?? "",
    bookmark.tags?.map((tag) => tag.name).join(" ") ?? "",
    bookmark.contentText ?? "",
  ]
    .join("\n")
    .toLocaleLowerCase("en-US");
}

export function bookmarkMatchesQuery(bookmark: SearchableBookmark, query: string): boolean {
  const tokens = tokenizeSearchQuery(query);
  if (tokens.length === 0) return true;
  const haystack = bookmarkSearchHaystack(bookmark);
  return tokens.every((token) => haystack.includes(token));
}

/**
 * 3 = title starts with the query, 2 = title contains it, 1 = another field,
 * 0 = no visible-field match (body-only hits from the server stay 0).
 */
export function bookmarkMatchRank(bookmark: SearchableBookmark, query: string): number {
  const q = normalizeSearchQuery(query);
  if (!q) return 0;
  const title = fold(bookmark.title);
  if (title.startsWith(q)) return 3;
  if (title.includes(q)) return 2;
  const tokens = q.split(" ");
  if (tokens.length > 1 && tokens.every((token) => title.includes(token))) return 2;
  if (bookmarkMatchesQuery(bookmark, q)) return 1;
  return 0;
}

/** Sort already-matched bookmarks. Does not drop rank-0 (body-only) hits. */
export function rankSearchResults<T extends SearchableBookmark>(items: readonly T[], query: string): T[] {
  const q = normalizeSearchQuery(query);
  if (!q) {
    return [...items].sort(compareByDateThenId);
  }
  const ranked = items.map((item) => ({ item, rank: bookmarkMatchRank(item, q) }));
  ranked.sort((a, b) => {
    if (a.rank !== b.rank) return b.rank - a.rank;
    return compareByDateThenId(a.item, b.item);
  });
  return ranked.map((row) => row.item);
}

function compareByDateThenId(a: SearchableBookmark, b: SearchableBookmark): number {
  const byDate = b.createdAt.localeCompare(a.createdAt);
  if (byDate !== 0) return byDate;
  return (a.id ?? a.title).localeCompare(b.id ?? b.title);
}
