/**
 * Human-friendly formatting helpers.
 */
import { formatDistanceToNowStrict } from "date-fns/formatDistanceToNowStrict";

/** "3 days", "2 months" — compact relative time. */
export function relativeTime(iso: string): string {
  try {
    return formatDistanceToNowStrict(new Date(iso));
  } catch {
    return "";
  }
}

/** "...ago" style for timestamps. */
export function timeAgo(iso: string): string {
  const r = relativeTime(iso);
  return r ? `${r} ago` : "";
}

/** e.g. "Jul 29, 2026" for "member since" displays. */
export function formatDate(iso: string): string {
  try {
    return new Date(iso).toLocaleDateString(undefined, {
      year: "numeric",
      month: "short",
      day: "numeric",
    });
  } catch {
    return iso;
  }
}

/** Pull a display hostname from a URL (without leading www.). */
export function domainFromUrl(url: string): string {
  try {
    const host = new URL(url).hostname.replace(/^www\./, "");
    return host || url;
  } catch {
    return url;
  }
}
