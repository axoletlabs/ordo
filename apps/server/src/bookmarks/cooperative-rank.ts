/**
 * Server-only cooperative processing for the encrypted-library full scans.
 *
 * Encrypted rows cannot be filtered, ranked, or sorted in SQL, so
 * `searchEncrypted` / `paginateDecryptedTitles` read every visible row and do
 * per-row decrypt + strip + score work in JavaScript. Done in one synchronous
 * loop, that work starves the event loop for the whole scan (measured: >5s on
 * a 4.5k bookmark library) and every concurrent request stalls behind it.
 *
 * These helpers run the exact same per-row work in bounded time chunks
 * (~CHUNK_BUDGET_MS of synchronous work, then a setImmediate yield) so
 * unrelated requests keep being served while a scan is in flight. Ranking,
 * ordering, tie-breaks, and outputs stay byte-identical to the shared
 * synchronous implementations; only the scheduling changes. A single
 * pathological row (e.g. a 200KB article body) is still atomic — that residual,
 * plus the unbounded database fetch itself, remain known limitations.
 */
import { performance } from "node:perf_hooks";
import {
  compareBookmarkSearchRanks,
  createBookmarkSearchMatcher,
  normalizeSearchQuery,
  type BookmarkSearchRank,
  type SearchRankOptions,
  type SearchableBookmark,
} from "@ordo/shared";

/** Synchronous work budget per chunk before yielding (~4-8ms target). */
const CHUNK_BUDGET_MS = 6;

function yieldToEventLoop(): Promise<void> {
  return new Promise<void>((resolve) => setImmediate(resolve));
}

/**
 * Apply `fn` to every row in chunked synchronous batches, yielding to the
 * event loop between chunks. Always processes at least one row per chunk, so
 * progress is guaranteed regardless of per-row cost. Output order and error
 * behavior match a plain `rows.map(fn)`.
 */
export async function mapCooperative<Row, Out>(
  rows: readonly Row[],
  fn: (row: Row, index: number) => Out,
): Promise<Out[]> {
  const out = new Array<Out>(rows.length);
  let index = 0;
  while (index < rows.length) {
    const chunkStart = performance.now();
    while (index < rows.length) {
      out[index] = fn(rows[index] as Row, index);
      index += 1;
      if (performance.now() - chunkStart >= CHUNK_BUDGET_MS) break;
    }
    if (index < rows.length) await yieldToEventLoop();
  }
  return out;
}

/** Like `mapCooperative`, but for side-effecting passes. */
export async function forEachCooperative<Row>(
  rows: readonly Row[],
  fn: (row: Row, index: number) => void,
): Promise<void> {
  await mapCooperative<Row, unknown>(rows, (row, index) => {
    fn(row, index);
    return undefined;
  });
}

/**
 * Tie-break comparator copied verbatim from the private helper inside
 * `rankSearchResults` (@ordo/shared search.ts): newest first, then id (or
 * title when id is absent). Keep in sync with the shared source; parity is
 * asserted by the test suite.
 */
function compareByDateThenId(a: SearchableBookmark, b: SearchableBookmark): number {
  const byDate = b.createdAt.localeCompare(a.createdAt);
  if (byDate !== 0) return byDate;
  return (a.id ?? a.title).localeCompare(b.id ?? b.title);
}

/**
 * Cooperative twin of `rankSearchResults` from @ordo/shared. Identical
 * semantics: same matcher (`createBookmarkSearchMatcher` on the normalized
 * query), same unmatched-row filtering, same ranking
 * (`compareBookmarkSearchRanks`), same date/id tie-break and stability; the
 * per-row `prepare` (decrypt + strip + DTO mapping) and scoring run through
 * `forEachCooperative` instead of one blocking loop. The final sort of the
 * matched rows stays synchronous — once unmatched rows are dropped it is
 * small relative to the scan.
 */
export async function rankSearchResultsCooperative<Row, Item extends SearchableBookmark>(
  rows: readonly Row[],
  query: string,
  opts: SearchRankOptions,
  prepare: (row: Row) => Item,
): Promise<Item[]> {
  const normalized = normalizeSearchQuery(query);
  if (!normalized) {
    return (await mapCooperative(rows, prepare)).sort(compareByDateThenId);
  }
  const match = createBookmarkSearchMatcher(normalized, opts);
  const ranked: Array<{ item: Item; rank: BookmarkSearchRank }> = [];
  await forEachCooperative(rows, (row) => {
    const item = prepare(row);
    const rank = match(item);
    if (rank.matched) ranked.push({ item, rank });
  });
  ranked.sort((a, b) => {
    const byRank = compareBookmarkSearchRanks(a.rank, b.rank);
    if (byRank !== 0) return byRank;
    return compareByDateThenId(a.item, b.item);
  });
  return ranked.map((entry) => entry.item);
}
