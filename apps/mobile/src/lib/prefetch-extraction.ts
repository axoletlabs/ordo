import { bookmarksApi } from "./api/bookmarks";

/** Fire-and-forget HTML warmup; never surfaces errors to the UI. */
export function prefetchExtraction(url: string): void {
  const trimmed = url.trim();
  if (!trimmed) return;
  let normalized = trimmed;
  if (!/^https?:\/\//i.test(normalized)) normalized = `https://${normalized}`;
  try {
    const parsed = new URL(normalized);
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return;
  } catch {
    return;
  }
  void bookmarksApi.prefetch(normalized).catch(() => undefined);
}
