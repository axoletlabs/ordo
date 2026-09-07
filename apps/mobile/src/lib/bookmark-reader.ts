import type {
  BookmarkDto,
  ContentKind,
  ContentKindOverride,
  ExtractionReason,
  FetchStatus,
} from "@ordo/shared";
import * as shared from "@ordo/shared";

function classifyContentKind(
  fetchStatus: FetchStatus,
  extractionReason: ExtractionReason | null,
  override: ContentKindOverride | null = null,
): ContentKind | null {
  if (override === "article" || override === "web") return override;
  if (fetchStatus === "pending") return null;
  if (fetchStatus === "ok") return "article";
  if (extractionReason === "social_video_or_app") return "media";
  if (extractionReason === "non_html_content") return "file";
  return "web";
}

export function resolveContentKind(bookmark: BookmarkDto): ContentKind | null {
  // Prefer the server field when present so a stale/missing shared helper cannot crash the list.
  if (bookmark.contentKind !== undefined) return bookmark.contentKind;
  const classify = (shared as { bookmarkContentKind?: typeof classifyContentKind }).bookmarkContentKind;
  if (typeof classify === "function") {
    return classify(bookmark.fetchStatus, bookmark.extractionReason, bookmark.contentKindOverride ?? null);
  }
  return classifyContentKind(
    bookmark.fetchStatus,
    bookmark.extractionReason,
    bookmark.contentKindOverride ?? null,
  );
}

export function bookmarkIsArticle(bookmark: BookmarkDto): boolean {
  return resolveContentKind(bookmark) === "article";
}

/** Files and social/app destinations cannot be extracted as articles. */
export function bookmarkCanBeArticle(bookmark: BookmarkDto): boolean {
  const kind = resolveContentKind(bookmark);
  return kind !== "media" && kind !== "file";
}

/** Non-article destinations open the live website, not the reader. */
export function bookmarkOpensAsWebsite(bookmark: BookmarkDto): boolean {
  const kind = resolveContentKind(bookmark);
  return kind === "web" || kind === "media" || kind === "file";
}

export function canReadInOrdo(bookmark: BookmarkDto): boolean {
  return bookmark.fetchStatus === "ok";
}
