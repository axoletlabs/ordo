/**
 * Bookmark lists: one page is large enough for a typical folder, and
 * load-more must not be able to spin the native refresh control.
 */
import { MAX_PAGE_SIZE } from "@ordo/shared";

/** Ask for the server maximum so PERSONAL (and most folders) arrive in one response. */
export const LIST_PAGE_SIZE = MAX_PAGE_SIZE;

/** Fraction of the viewport from the end. 0.4 fired while still mid-list. */
export const LIST_END_REACHED_THRESHOLD = 0.2;

/**
 * Space under the last row for a 56dp extended Material FAB. Its wider label
 * must never cover the final row's text or actions. Screens add their safe inset.
 */
export const FAB_LIST_CLEARANCE = 56 + 24 + 16;

export function shouldFetchNextPage(opts: {
  hasNextPage: boolean;
  isFetchingNextPage: boolean;
  locked: boolean;
  stalled: boolean;
}): boolean {
  return opts.hasNextPage && !opts.isFetchingNextPage && !opts.locked && !opts.stalled;
}

/** True when the next page added at least one unique row. */
export function pageLoadMadeProgress(previousCount: number, nextCount: number): boolean {
  return nextCount > previousCount;
}
