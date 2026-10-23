import type { BookmarkDto } from "@ordo/shared";
import { READ_COMPLETION_THRESHOLD } from "@ordo/shared";

/** Scroll offsets within this distance of an edge count as the edge. Native
 * scrollers report fractional/rounded offsets and bounce slightly past them. */
export const READING_EDGE_EPSILON = 1;
/** A saved position at or below this fraction is just the top of the article. */
export const READING_RESTORE_MIN = 0.02;
/** Content that does not overflow must stay unchanged this long before it can
 * be treated as a genuinely short article. Incremental section mounts, late
 * images and font swaps all change the content height inside this window. */
export const READING_SHORT_SETTLE_MS = 400;

const clamp01 = (value: number) => Math.min(1, Math.max(0, value));
const finiteOr = (value: number, fallback = 0) => (Number.isFinite(value) ? value : fallback);

/** UI-thread reading position. Kept as a self-contained worklet: the animated
 * bar must never wait for React or allocate on every scroll frame. */
export function scrollReadingProgress(
  offset: number,
  viewportHeight: number,
  contentHeight: number,
): number {
  "worklet";
  if (!Number.isFinite(offset) || !Number.isFinite(viewportHeight) || !Number.isFinite(contentHeight)) return 0;
  if (viewportHeight <= 0 || contentHeight <= 0) return 0;
  const scrollable = contentHeight - viewportHeight;
  // A non-scrolling article has no offset to sample. Returning 1 here let a
  // viewport-sized placeholder (or a resize frame) flash a full bar before the
  // JS measurement armed the settled/ready state; short content is completed
  // by measureReadingProgress only after the settle window.
  if (scrollable <= 0) return 0;
  if (offset <= 0) return 0;
  if (offset >= scrollable) return 1;
  return offset / scrollable;
}

export type ReadingPosition =
  | "unmeasured"
  | "empty"
  | "top"
  | "reading"
  | "bottom"
  | "short";

export interface ReadingMeasurement {
  /** Raw scroll offset. Overscroll is negative or above the scrollable range. */
  offset: number;
  viewportHeight: number;
  contentHeight: number;
  /** The article tree finished mounting (all server sections committed). */
  ready: boolean;
  /** Content height has been unchanged for `READING_SHORT_SETTLE_MS`. */
  settled: boolean;
}

export interface ReadingProgress {
  position: ReadingPosition;
  /** Fraction to draw. Always 0 until a ready, measured article exists. */
  fraction: number;
  /** Valid viewport + content dimensions for a ready article. */
  measured: boolean;
  /** Maximum scroll offset. 0 while unmeasured or for short content. */
  scrollable: number;
  atTop: boolean;
  atBottom: boolean;
  /** Content fits the viewport. Position is only defined once settled. */
  short: boolean;
  /**
   * Safe to store a completion write. Overflow needs a real bottom sample;
   * short content needs the settle window so a placeholder cannot complete an
   * article before its images/fonts/sections have laid out.
   */
  canComplete: boolean;
}

function unmeasured(position: ReadingPosition = "unmeasured"): ReadingProgress {
  return {
    position,
    fraction: 0,
    measured: false,
    scrollable: 0,
    atTop: true,
    atBottom: false,
    short: position === "short",
    canComplete: false,
  };
}

/** Gate a raw offset by readiness and layout settlement. */
export function measureReadingProgress(input: ReadingMeasurement): ReadingProgress {
  const viewport = finiteOr(input.viewportHeight);
  const content = finiteOr(input.contentHeight);
  if (!input.ready) return unmeasured();
  if (viewport <= 0) return unmeasured();
  if (content <= 0) return unmeasured("empty");

  const scrollable = content - viewport;
  if (scrollable <= 0) {
    // Never report a full bar from a viewport-sized placeholder. Once the
    // height has stopped moving, a fully visible article is complete.
    const settled = input.settled;
    return {
      position: "short",
      fraction: settled ? 1 : 0,
      measured: true,
      scrollable: 0,
      atTop: true,
      atBottom: false,
      short: true,
      canComplete: settled,
    };
  }

  const offset = Math.min(scrollable, Math.max(0, finiteOr(input.offset)));
  const atTop = offset <= READING_EDGE_EPSILON;
  const atBottom = scrollable - offset <= READING_EDGE_EPSILON;
  return {
    // Top wins a frame that is both edges (sub-pixel overflow): a viewport at
    // offset 0 must never report a completed bar.
    position: atTop ? "top" : atBottom ? "bottom" : "reading",
    fraction: atTop ? 0 : atBottom ? 1 : offset / scrollable,
    measured: true,
    scrollable,
    atTop,
    atBottom,
    short: false,
    canComplete: atBottom && !atTop,
  };
}

/**
 * Offset for a saved partial position, or null when the article should open at
 * the top (completed/effectively-top articles) or layout cannot support it.
 */
export function restoreReadingOffset(
  saved: number | null | undefined,
  viewportHeight: number,
  contentHeight: number,
  completion = READ_COMPLETION_THRESHOLD,
): number | null {
  const target = clamp01(finiteOr(saved ?? 0));
  const threshold = clamp01(finiteOr(completion, READ_COMPLETION_THRESHOLD));
  if (target <= READING_RESTORE_MIN || target >= threshold) return null;
  const viewport = finiteOr(viewportHeight);
  const content = finiteOr(contentHeight);
  if (viewport <= 0 || content <= 0) return null;
  const scrollable = content - viewport;
  if (scrollable <= 0) return null;
  return Math.min(scrollable, Math.max(0, target * scrollable));
}

/**
 * Persist when the user has moved far enough, in either direction. A full
 * fraction is only writable when the caller proved it (real bottom of measured
 * overflow, or a settled short article). This keeps a placeholder viewport
 * from completing a long article on startup.
 */
export function shouldFlushReadingProgress(
  next: number,
  last: number | null,
  delta: number,
  completion: number,
  options: { completionEligible?: boolean } = {},
): boolean {
  if (!Number.isFinite(next)) return false;
  const value = clamp01(next);
  const threshold = clamp01(finiteOr(completion, READ_COMPLETION_THRESHOLD));
  const persisted = last === null || !Number.isFinite(last) ? null : clamp01(last);
  if (value >= threshold) {
    if (persisted !== null && persisted >= threshold) return false;
    return options.completionEligible !== false;
  }
  if (persisted === null) return true;
  return Math.abs(value - persisted) >= delta;
}

/** Reconcile only progress fields; a full response may predate a move/tag edit. */
export function reconcileReadingProgress<T extends BookmarkDto>(bookmark: T, updated: BookmarkDto): T {
  return { ...bookmark, readProgress: updated.readProgress, isRead: updated.isRead, completedAt: updated.completedAt,
    updatedAt: updated.updatedAt > bookmark.updatedAt ? updated.updatedAt : bookmark.updatedAt };
}
