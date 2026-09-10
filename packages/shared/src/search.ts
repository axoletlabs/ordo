/**
 * Bookmark search. Default matching is a case-insensitive word prefix
 * (hel → hello, help, helpful; not shelf). Fuzzy (edit distance 1) is opt-in.
 *
 * Ranking, best first:
 *   1. AND (every token) before OR (some tokens, multi-word queries only)
 *   2. Title → domain → URL → tag → description → article body
 *   3. Field starts with the query, then exact word, then prefix, then fuzzy
 *   4. More matching tokens, then exact over fuzzy, then newest
 *
 * Description / author / body only participate when every token is 5+ letters,
 * and those hits always sort below title / URL / domain / tag hits.
 */

export interface SearchableBookmark {
  id?: string;
  title: string;
  url: string;
  domain: string;
  description: string | null;
  author?: string | null;
  tags: { id?: string; name: string }[];
  createdAt: string;
  contentText?: string | null;
}

export type SearchMatchClause = "and" | "or";
export type SearchMatchField = "title" | "domain" | "url" | "tag" | "description" | "body";

export const SEARCH_MATCH_QUALITY = {
  none: 0,
  fuzzy: 1,
  prefix: 2,
  exact: 3,
  starts: 4,
} as const;

export type SearchMatchQuality = (typeof SEARCH_MATCH_QUALITY)[keyof typeof SEARCH_MATCH_QUALITY];

export interface BookmarkSearchRank {
  matched: boolean;
  clause: SearchMatchClause;
  field: SearchMatchField;
  quality: SearchMatchQuality;
  hits: number;
  usedFuzzy: boolean;
}

export interface SearchRankOptions {
  fuzzy?: boolean;
  /** Tag ids whose names must not satisfy the typed query (active tag filters). */
  omitTagIds?: ReadonlySet<string> | readonly string[];
  /** Override the 5-letter gate. Default follows `tokensAllowArticleText`. */
  allowSecondary?: boolean;
}

/** Trim, collapse whitespace, and lowercase. */
export function normalizeSearchQuery(query: string): string {
  return query.trim().replace(/\s+/g, " ").toLocaleLowerCase("en-US");
}

export function tokenizeSearchQuery(query: string): string[] {
  const q = normalizeSearchQuery(query);
  return q ? q.split(" ") : [];
}

/** Article body, description, and author are searched only when every token is this long. */
export const MIN_ARTICLE_TEXT_QUERY_LENGTH = 5;

/** Fuzzy matching ignores tokens shorter than this so `he` does not match `the`. */
export const MIN_FUZZY_TOKEN_LENGTH = 3;

const FIELD_SCORE: Record<SearchMatchField, number> = {
  title: 50,
  domain: 40,
  url: 35,
  tag: 30,
  description: 20,
  body: 10,
};

const PRIMARY_FIELDS: ReadonlySet<SearchMatchField> = new Set(["title", "domain", "url", "tag"]);

/** Characters that start a new URL / title token for SQL prefix recall. */
export const SEARCH_BOUNDARY_CHARS = [" ", ".", "-", "_", "/", "?", "=", "#", ":", "@", "&", "+", "[", "(", '"', "'"] as const;

const WORD_PATTERN = "[\\p{L}\\p{N}]+";

export function tokensAllowArticleText(tokens: readonly string[]): boolean {
  return tokens.length > 0 && tokens.every((token) => token.length >= MIN_ARTICLE_TEXT_QUERY_LENGTH);
}

export function isPrimarySearchField(field: SearchMatchField): boolean {
  return PRIMARY_FIELDS.has(field);
}

function fold(value: string | null | undefined): string {
  return (value ?? "").toLocaleLowerCase("en-US");
}

function omitSet(omitTagIds: SearchRankOptions["omitTagIds"]): ReadonlySet<string> {
  if (!omitTagIds) return emptyOmit;
  return omitTagIds instanceof Set ? omitTagIds : new Set(omitTagIds);
}

const emptyOmit: ReadonlySet<string> = new Set();

const UNMATCHED: BookmarkSearchRank = {
  matched: false,
  clause: "or",
  field: "body",
  quality: SEARCH_MATCH_QUALITY.none,
  hits: 0,
  usedFuzzy: false,
};

/** LIKE-safe token; empty means skip SQL recall for this token. */
export function searchSqlToken(token: string): string {
  return fold(token).replace(/[%_]/g, "");
}

/**
 * `startsWith` plus `contains` needles that only match at a token boundary.
 * Used by the server so SQL recall stays aligned with word-prefix matching.
 */
export function searchTokenPrefixPatterns(token: string): { startsWith: string; contains: string[] } {
  const t = searchSqlToken(token);
  if (!t) return { startsWith: "", contains: [] };
  return {
    startsWith: t,
    contains: SEARCH_BOUNDARY_CHARS.map((ch) => `${ch}${t}`),
  };
}

export function searchWords(text: string | null | undefined): string[] {
  const folded = fold(text);
  if (!folded) return [];
  return folded.match(new RegExp(WORD_PATTERN, "gu")) ?? [];
}

/** True when `a` can become `b` with one insert, delete, substitute, or transpose. */
export function withinOneEdit(a: string, b: string): boolean {
  if (a === b) return true;
  const la = a.length;
  const lb = b.length;
  if (Math.abs(la - lb) > 1) return false;
  if (la === lb) {
    let i = 0;
    while (i < la && a[i] === b[i]) i++;
    if (i === la) return true;
    if (a.slice(i + 1) === b.slice(i + 1)) return true;
    return (
      i + 1 < la &&
      a[i] === b[i + 1] &&
      a[i + 1] === b[i] &&
      a.slice(i + 2) === b.slice(i + 2)
    );
  }
  const shorter = la < lb ? a : b;
  const longer = la < lb ? b : a;
  let i = 0;
  let j = 0;
  let skipped = false;
  while (i < shorter.length && j < longer.length) {
    if (shorter[i] === longer[j]) {
      i++;
      j++;
      continue;
    }
    if (skipped) return false;
    skipped = true;
    j++;
  }
  return true;
}

function qualityAgainstText(text: string | null | undefined, token: string, fuzzy: boolean): SearchMatchQuality {
  const folded = fold(text);
  if (!folded || !token) return SEARCH_MATCH_QUALITY.none;
  if (folded.startsWith(token)) return SEARCH_MATCH_QUALITY.starts;
  let best: SearchMatchQuality = SEARCH_MATCH_QUALITY.none;
  for (const word of searchWords(folded)) {
    if (word === token) return SEARCH_MATCH_QUALITY.exact;
    if (word.startsWith(token)) {
      if (best < SEARCH_MATCH_QUALITY.prefix) best = SEARCH_MATCH_QUALITY.prefix;
      continue;
    }
    if (
      fuzzy &&
      token.length >= MIN_FUZZY_TOKEN_LENGTH &&
      best < SEARCH_MATCH_QUALITY.fuzzy &&
      withinOneEdit(word, token)
    ) {
      best = SEARCH_MATCH_QUALITY.fuzzy;
    }
  }
  return best;
}

function namedTags(
  tags: SearchableBookmark["tags"] | unknown,
  omit: ReadonlySet<string>,
): { name: string }[] {
  if (!Array.isArray(tags)) return [];
  return tags.filter(
    (tag): tag is { id?: string; name: string } =>
      !!tag &&
      typeof tag.name === "string" &&
      (!tag.id || !omit.has(tag.id)),
  );
}

function pickBestField(
  candidates: readonly { field: SearchMatchField; quality: SearchMatchQuality }[],
): { field: SearchMatchField; quality: SearchMatchQuality; usedFuzzy: boolean } | null {
  let bestField: SearchMatchField | null = null;
  let bestQuality: SearchMatchQuality = SEARCH_MATCH_QUALITY.none;
  for (const candidate of candidates) {
    if (candidate.quality === SEARCH_MATCH_QUALITY.none) continue;
    if (
      !bestField ||
      FIELD_SCORE[candidate.field] > FIELD_SCORE[bestField] ||
      (candidate.field === bestField && candidate.quality > bestQuality)
    ) {
      bestField = candidate.field;
      bestQuality = candidate.quality;
    }
  }
  if (!bestField) return null;
  return { field: bestField, quality: bestQuality, usedFuzzy: bestQuality === SEARCH_MATCH_QUALITY.fuzzy };
}

function bestFieldForToken(
  bookmark: SearchableBookmark,
  token: string,
  fuzzy: boolean,
  allowSecondary: boolean,
  omit: ReadonlySet<string>,
): { field: SearchMatchField; quality: SearchMatchQuality; usedFuzzy: boolean } | null {
  const titleQ = qualityAgainstText(bookmark.title, token, fuzzy);
  const domainQ = qualityAgainstText(bookmark.domain, token, fuzzy);
  const urlQ = qualityAgainstText(bookmark.url, token, fuzzy);
  let tagQ: SearchMatchQuality = SEARCH_MATCH_QUALITY.none;
  for (const tag of namedTags(bookmark.tags, omit)) {
    const next = qualityAgainstText(tag.name, token, fuzzy);
    if (next > tagQ) tagQ = next;
    if (tagQ === SEARCH_MATCH_QUALITY.starts) break;
  }

  const candidates: { field: SearchMatchField; quality: SearchMatchQuality }[] = [
    { field: "title", quality: titleQ },
    { field: "domain", quality: domainQ },
    { field: "url", quality: urlQ },
    { field: "tag", quality: tagQ },
  ];
  if (allowSecondary) {
    candidates.push(
      { field: "description", quality: qualityAgainstText(`${bookmark.description ?? ""} ${bookmark.author ?? ""}`, token, fuzzy) },
      { field: "body", quality: qualityAgainstText(bookmark.contentText, token, fuzzy) },
    );
  }
  return pickBestField(candidates);
}

function weakerField(a: SearchMatchField, b: SearchMatchField): SearchMatchField {
  return FIELD_SCORE[a] <= FIELD_SCORE[b] ? a : b;
}

export function bookmarkSearchRank(
  bookmark: SearchableBookmark,
  query: string,
  opts: SearchRankOptions = {},
): BookmarkSearchRank {
  const tokens = tokenizeSearchQuery(query);
  if (tokens.length === 0) return { ...UNMATCHED, matched: true, clause: "and", field: "title", hits: 0 };
  const fuzzy = !!opts.fuzzy;
  const omit = omitSet(opts.omitTagIds);
  const allowSecondary = opts.allowSecondary ?? tokensAllowArticleText(tokens);

  const perToken = tokens.map((token) => bestFieldForToken(bookmark, token, fuzzy, allowSecondary, omit));
  const hits = perToken.filter((row): row is NonNullable<typeof row> => row != null);
  if (hits.length === 0) return UNMATCHED;

  const all = hits.length === tokens.length;
  const clause: SearchMatchClause = all ? "and" : "or";
  if (!all && tokens.length < 2) return UNMATCHED;

  let field = hits[0]!.field;
  let quality: SearchMatchQuality = hits[0]!.quality;
  let usedFuzzy = hits[0]!.usedFuzzy;
  for (let i = 1; i < hits.length; i++) {
    const row = hits[i]!;
    field = all ? weakerField(field, row.field) : FIELD_SCORE[row.field] > FIELD_SCORE[field] ? row.field : field;
    if (all) quality = Math.min(quality, row.quality) as SearchMatchQuality;
    else if (row.quality > quality) quality = row.quality;
    usedFuzzy = usedFuzzy || row.usedFuzzy;
  }

  if (all) {
    const full = tokens.join(" ");
    const titleStarts = fold(bookmark.title).startsWith(full);
    if (titleStarts) {
      field = "title";
      quality = SEARCH_MATCH_QUALITY.starts;
    }
  }

  return {
    matched: true,
    clause,
    field,
    quality,
    hits: hits.length,
    usedFuzzy: usedFuzzy && quality === SEARCH_MATCH_QUALITY.fuzzy,
  };
}

export function bookmarkMatchesQuery(
  bookmark: SearchableBookmark,
  query: string,
  opts: SearchRankOptions = {},
): boolean {
  const tokens = tokenizeSearchQuery(query);
  if (tokens.length === 0) return true;
  return bookmarkSearchRank(bookmark, query, opts).matched;
}

/**
 * @deprecated Use `bookmarkSearchRank`. Kept as a coarse 0–3 for older call sites.
 */
export function bookmarkMatchRank(
  bookmark: SearchableBookmark,
  query: string,
  opts: SearchRankOptions = {},
): number {
  const rank = bookmarkSearchRank(bookmark, query, opts);
  if (!rank.matched) return 0;
  if (rank.field === "title" && rank.quality === SEARCH_MATCH_QUALITY.starts) return 3;
  if (rank.field === "title") return 2;
  return 1;
}

export function compareBookmarkSearchRanks(a: BookmarkSearchRank, b: BookmarkSearchRank): number {
  if (a.matched !== b.matched) return Number(b.matched) - Number(a.matched);
  if (a.clause !== b.clause) return a.clause === "and" ? -1 : 1;
  if (a.field !== b.field) return FIELD_SCORE[b.field] - FIELD_SCORE[a.field];
  if (a.quality !== b.quality) return b.quality - a.quality;
  if (a.hits !== b.hits) return b.hits - a.hits;
  if (a.usedFuzzy !== b.usedFuzzy) return Number(a.usedFuzzy) - Number(b.usedFuzzy);
  return 0;
}

function compareByDateThenId(a: SearchableBookmark, b: SearchableBookmark): number {
  const byDate = b.createdAt.localeCompare(a.createdAt);
  if (byDate !== 0) return byDate;
  return (a.id ?? a.title).localeCompare(b.id ?? b.title);
}

/** Sort already-loaded bookmarks. Drops rows that do not match. */
export function rankSearchResults<T extends SearchableBookmark>(
  items: readonly T[],
  query: string,
  opts: SearchRankOptions = {},
): T[] {
  const q = normalizeSearchQuery(query);
  if (!q) {
    return [...items].sort(compareByDateThenId);
  }
  const ranked = items
    .map((item) => ({ item, rank: bookmarkSearchRank(item, q, opts) }))
    .filter((row) => row.rank.matched);
  ranked.sort((a, b) => {
    const byRank = compareBookmarkSearchRanks(a.rank, b.rank);
    if (byRank !== 0) return byRank;
    return compareByDateThenId(a.item, b.item);
  });
  return ranked.map((row) => row.item);
}

/**
 * First highlighted span in `text` for the query's first token (word prefix,
 * or the whole word when the hit is fuzzy).
 */
export function firstSearchHighlight(
  text: string,
  query: string,
  fuzzy = false,
): { start: number; end: number } | null {
  const token = tokenizeSearchQuery(query)[0];
  if (!token || !text) return null;
  const folded = fold(text);
  if (folded.startsWith(token)) return { start: 0, end: token.length };
  const wordRe = new RegExp(WORD_PATTERN, "gu");
  let match: RegExpExecArray | null;
  while ((match = wordRe.exec(text))) {
    const word = fold(match[0]);
    if (word.startsWith(token)) {
      return { start: match.index, end: match.index + token.length };
    }
    if (fuzzy && token.length >= MIN_FUZZY_TOKEN_LENGTH && withinOneEdit(word, token)) {
      return { start: match.index, end: match.index + match[0].length };
    }
  }
  return null;
}
