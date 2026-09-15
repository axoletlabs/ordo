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
 * Space under the last row so it sits just above the 48px FAB (20px off the
 * screen bottom). `spacing[96]` was a tab+FAB pad and left a blank band on
 * folder screens that only have the button.
 */
export const FAB_LIST_CLEARANCE = 20 + 48 + 12;

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