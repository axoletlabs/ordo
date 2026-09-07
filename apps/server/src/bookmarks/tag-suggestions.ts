/**
 * Deterministic tag-suggestion scoring. Given the user's existing tags and a
 * bookmark's extracted text fields, produces a ranked subset of tag IDs —
 * never new tags. Pure and dependency-free so it can be unit-tested directly.
 *
 * Signals (strongest first): title, description, domain, article body.
 * Matches require token/phrase boundaries so "rust" does not match "frustrate".
 * Body matches count once per term so long articles cannot dominate.
 */
export interface SuggestionCandidate {
  id: string;
  name: string;
}

export interface SuggestionContent {
  title: string | null;
  description: string | null;
  domain: string | null;
  body: string | null;
}

export interface ScoredSuggestion {
  id: string;
  name: string;
  score: number;
}

/** Minimum score before a tag is worth surfacing. */
const MIN_SCORE = 6;
/** How many suggestions to keep per bookmark. */
export const MAX_SUGGESTIONS = 3;
/** Body phrase match bonus; used to skip a full-body scan when it cannot change the ranking. */
const MAX_BODY_BONUS = 4;

function normalize(value: string | null | undefined): string {
  return (value ?? "").toLocaleLowerCase("en-US");
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** Case-insensitive match of `needle` in `haystack` on token boundaries. */
function matchesOnBoundary(haystack: string, needle: string): boolean {
  if (!needle || !haystack) return false;
  const pattern = new RegExp(
    `(?<![\\p{L}\\p{N}])${escapeRegExp(needle)}(?![\\p{L}\\p{N}])`,
    "u",
  );
  return pattern.test(haystack);
}

/** Split a tag name into significant tokens (length >= 3). */
function tokenize(name: string): string[] {
  return normalize(name)
    .split(/[^\p{L}\p{N}]+/u)
    .filter((token) => token.length >= 3);
}

export function scoreTagSuggestions(
  tags: readonly SuggestionCandidate[],
  content: SuggestionContent,
): ScoredSuggestion[] {
  const title = normalize(content.title);
  const description = normalize(content.description);
  const domain = normalize(content.domain);
  const body = normalize(content.body);

  const cheap: Array<{ id: string; name: string; score: number; phrase: string; tokens: string[] }> = [];
  for (const tag of tags) {
    const phrase = normalize(tag.name.trim());
    if (!phrase) continue;
    const tokens = tokenize(tag.name);
    cheap.push({
      id: tag.id,
      name: tag.name,
      phrase,
      tokens,
      score: cheapScore(phrase, tokens, title, description, domain),
    });
  }

  const ranked = (rows: Array<{ id: string; name: string; score: number }>) =>
    rows
      .filter((row) => row.score >= MIN_SCORE)
      .sort(
        (a, b) =>
          b.score - a.score ||
          a.name.toLocaleLowerCase("en-US").localeCompare(b.name.toLocaleLowerCase("en-US")) ||
          a.id.localeCompare(b.id),
      )
      .slice(0, MAX_SUGGESTIONS);

  if (!body || !bodyCanChangeRanking(cheap)) {
    return ranked(cheap);
  }

  const scored = cheap.map((row) => ({
    ...row,
    score: row.score + bodyBonus(row.phrase, row.tokens, body),
  }));
  return ranked(scored);
}

function cheapScore(
  phrase: string,
  tokens: string[],
  title: string,
  description: string,
  domain: string,
): number {
  let score = 0;
  if (matchesOnBoundary(title, phrase)) score += 10;
  else for (const token of tokens) if (matchesOnBoundary(title, token)) score += 4;
  if (matchesOnBoundary(description, phrase)) score += 6;
  else for (const token of tokens) if (matchesOnBoundary(description, token)) score += 2;
  if (matchesOnBoundary(domain, phrase)) score += 3;
  else for (const token of tokens) if (matchesOnBoundary(domain, token)) score += 2;
  return score;
}

function bodyBonus(phrase: string, tokens: string[], body: string): number {
  if (matchesOnBoundary(body, phrase)) return 4;
  let bonus = 0;
  for (const token of tokens) if (matchesOnBoundary(body, token)) bonus += 1;
  return bonus;
}

function bodyCanChangeRanking(
  cheap: Array<{ score: number }>,
): boolean {
  const sorted = [...cheap].sort((a, b) => b.score - a.score);
  const qualifying = sorted.filter((row) => row.score >= MIN_SCORE);
  if (qualifying.length < MAX_SUGGESTIONS) {
    const canAdmit = sorted.some((row) => row.score < MIN_SCORE && row.score + MAX_BODY_BONUS >= MIN_SCORE);
    const canReorder = qualifying.some(
      (row, i) => i < qualifying.length - 1 && qualifying[i].score - qualifying[i + 1].score < MAX_BODY_BONUS,
    );
    return canAdmit || canReorder;
  }
  const cutoff = qualifying[MAX_SUGGESTIONS - 1]?.score ?? 0;
  const next = sorted[MAX_SUGGESTIONS]?.score ?? 0;
  if (next + MAX_BODY_BONUS >= cutoff) return true;
  for (let i = 0; i < Math.min(MAX_SUGGESTIONS, sorted.length) - 1; i += 1) {
    if (sorted[i].score - sorted[i + 1].score < MAX_BODY_BONUS) return true;
  }
  return false;
}
