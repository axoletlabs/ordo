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

type IndexedField = { folded: string; words: readonly string[] };
const documents = new WeakMap<SearchableBookmark, ReturnType<typeof indexDocument>>();
function indexField(text: string | null | undefined): IndexedField {
  const folded = fold(text);
  return { folded, words: folded.match(new RegExp(WORD_PATTERN, "gu")) ?? [] };
}
function indexDocument(bookmark: SearchableBookmark) {
  return {
    title: indexField(bookmark.title), domain: indexField(bookmark.domain), url: indexField(bookmark.url),
    tags: namedTags(bookmark.tags, emptyOmit).map((tag) => ({ ...tag, indexed: indexField(tag.name) })),
    description: indexField(`${bookmark.description ?? ""} ${bookmark.author ?? ""}`),
    // Reader details can contain megabytes of text. A metadata/title query
    // must not tokenize that body before the five-letter secondary-field gate.
    body: undefined as IndexedField | undefined,
  };
}
/** DTOs are immutable: retain tokenized fields until that record is replaced. */
function indexedDocument(bookmark: SearchableBookmark) {
  let indexed = documents.get(bookmark);
  if (!indexed) { indexed = indexDocument(bookmark); documents.set(bookmark, indexed); }
  return indexed;
}
export function prepareBookmarkSearch(bookmark: SearchableBookmark): void {
  indexedDocument(bookmark);
}

function qualityAgainstText({ folded, words }: IndexedField, token: string, fuzzy: boolean): SearchMatchQuality {
  if (!folded || !token) return SEARCH_MATCH_QUALITY.none;
  if (folded.startsWith(token)) return SEARCH_MATCH_QUALITY.starts;
  let best: SearchMatchQuality = SEARCH_MATCH_QUALITY.none;
  for (const word of words) {
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
): { id?: string; name: string }[] {
  if (!Array.isArray(tags)) return [];
  return tags.filter(
    (tag): tag is { id?: string; name: string } =>
      !!tag &&
      typeof tag.name === "string" &&
      (!tag.id || !omit.has(tag.id)),
  );
}

function fieldMatch(field: SearchMatchField, quality: SearchMatchQuality) {
  return { field, quality, usedFuzzy: quality === SEARCH_MATCH_QUALITY.fuzzy };
}

function bestFieldForToken(
  bookmark: ReturnType<typeof indexDocument>,
  source: SearchableBookmark,
  token: string,
  fuzzy: boolean,
  allowSecondary: boolean,
  omit: ReadonlySet<string>,
): { field: SearchMatchField; quality: SearchMatchQuality; usedFuzzy: boolean } | null {
  const titleQ = qualityAgainstText(bookmark.title, token, fuzzy);
  if (titleQ) return fieldMatch("title", titleQ);
  const domainQ = qualityAgainstText(bookmark.domain, token, fuzzy);
  if (domainQ) return fieldMatch("domain", domainQ);
  const urlQ = qualityAgainstText(bookmark.url, token, fuzzy);
  if (urlQ) return fieldMatch("url", urlQ);
  let tagQ: SearchMatchQuality = SEARCH_MATCH_QUALITY.none;
  for (const tag of bookmark.tags) {
    if (tag.id && omit.has(tag.id)) continue;
    const next = qualityAgainstText(tag.indexed, token, fuzzy);
    if (next > tagQ) tagQ = next;
    if (tagQ === SEARCH_MATCH_QUALITY.starts) break;
  }

  if (tagQ) return fieldMatch("tag", tagQ);
  if (allowSecondary) {
    const descriptionQ = qualityAgainstText(bookmark.description, token, fuzzy);
    if (descriptionQ) return fieldMatch("description", descriptionQ);
    bookmark.body ??= indexField(source.contentText);
    const bodyQ = qualityAgainstText(bookmark.body, token, fuzzy);
    if (bodyQ) return fieldMatch("body", bodyQ);
  }
  return null;
}

function weakerField(a: SearchMatchField, b: SearchMatchField): SearchMatchField {
  return FIELD_SCORE[a] <= FIELD_SCORE[b] ? a : b;
}

export function bookmarkSearchRank(
  bookmark: SearchableBookmark,
  query: string,
  opts: SearchRankOptions = {},
): BookmarkSearchRank {
  return createBookmarkSearchMatcher(query, opts)(bookmark);
}

/** Compile the query once, not once per row on every key press. */
export function createBookmarkSearchMatcher(query: string, opts: SearchRankOptions = {}) {
  const tokens = tokenizeSearchQuery(query);
  const fuzzy = !!opts.fuzzy;
  const omit = omitSet(opts.omitTagIds);
  const allowSecondary = opts.allowSecondary ?? tokensAllowArticleText(tokens);
  const full = tokens.join(" ");
  return (source: SearchableBookmark): BookmarkSearchRank => {
    if (tokens.length === 0) return { ...UNMATCHED, matched: true, clause: "and", field: "title", hits: 0 };
    const bookmark = indexedDocument(source);

    let count = 0;
    let weakestField: SearchMatchField = "title";
    let strongestField: SearchMatchField = "body";
    let lowestQuality: SearchMatchQuality = SEARCH_MATCH_QUALITY.starts;
    let highestQuality: SearchMatchQuality = SEARCH_MATCH_QUALITY.none;
    let usedFuzzy = false;
    for (const token of tokens) {
      const hit = bestFieldForToken(bookmark, source, token, fuzzy, allowSecondary, omit);
      if (!hit) continue;
      count++;
      weakestField = weakerField(weakestField, hit.field);
      if (FIELD_SCORE[hit.field] > FIELD_SCORE[strongestField]) strongestField = hit.field;
      lowestQuality = Math.min(lowestQuality, hit.quality) as SearchMatchQuality;
      highestQuality = Math.max(highestQuality, hit.quality) as SearchMatchQuality;
      usedFuzzy ||= hit.usedFuzzy;
    }
    if (count === 0) return UNMATCHED;

    const all = count === tokens.length;
    const clause: SearchMatchClause = all ? "and" : "or";
    if (!all && tokens.length < 2) return UNMATCHED;

    let field = all ? weakestField : strongestField;
    let quality = all ? lowestQuality : highestQuality;

    if (all && bookmark.title.folded.startsWith(full)) {
      field = "title";
      quality = SEARCH_MATCH_QUALITY.starts;
    }

    return {
      matched: true,
      clause,
      field,
      quality,
      hits: count,
      usedFuzzy: usedFuzzy && quality === SEARCH_MATCH_QUALITY.fuzzy,
    };
  };
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
  const match = createBookmarkSearchMatcher(q, opts);
  const ranked = items
    .map((item) => ({ item, rank: match(item) }))
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
