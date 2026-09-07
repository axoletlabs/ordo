import type { Bookmark, Folder, Session, Tag, User } from "@prisma/client";
import {
  isFolderPinLength,
  normalizeFolderIcon,
  normalizeReaderPreferences,
  normalizeTagColor,
  bookmarkContentKind,
  type BookmarkDto,
  type ContentKindOverride,
  type ExtractionReason,
  type FetchStatus,
  type FolderDto,
  type SessionDto,
  type TagDto,
  type TagSummaryDto,
  type UserDto,
} from "@ordo/shared";

export type UserDtoFields = Pick<
  User,
  | "id"
  | "displayName"
  | "email"
  | "emailVerifiedAt"
  | "preferences"
  | "totpEnabledAt"
  | "avatarUpdatedAt"
  | "createdAt"
>;

/** Map a user row (or a superset) to a DTO; preferences fall back to defaults when malformed. */
export function toUserDto(u: UserDtoFields): UserDto {
  return {
    id: u.id,
    displayName: u.displayName,
    email: u.email,
    emailVerified: u.emailVerifiedAt !== null,
    hasAvatar: u.avatarUpdatedAt !== null,
    avatarUpdatedAt: u.avatarUpdatedAt?.toISOString() ?? null,
    mfaEnabled: u.totpEnabledAt !== null,
    preferences: normalizeReaderPreferences(u.preferences),
    createdAt: u.createdAt.toISOString(),
  };
}

export function toSessionDto(
  s: Pick<Session, "id" | "deviceInfo" | "deviceName" | "deviceType" | "ip" | "lastSeenAt" | "createdAt"> & {
    current?: boolean;
  },
): SessionDto {
  return {
    id: s.id,
    deviceInfo: s.deviceInfo,
    deviceName: s.deviceName,
    deviceType:
      s.deviceType === "phone" ||
      s.deviceType === "tablet" ||
      s.deviceType === "desktop" ||
      s.deviceType === "tv"
        ? s.deviceType
        : "unknown",
    ip: s.ip,
    lastSeenAt: s.lastSeenAt.toISOString(),
    createdAt: s.createdAt.toISOString(),
    current: s.current ?? false,
  };
}

export interface FolderWithCounts extends Folder {
  _count?: { bookmarks: number };
  unread?: number;
}

export function toFolderDto(
  f: FolderWithCounts,
  counts: { bookmarkCount: number; unreadCount: number },
): FolderDto {
  return {
    id: f.id,
    name: f.name,
    icon: normalizeFolderIcon(f.icon),
    pinned: f.pinned,
    protected: f.passwordHash !== null,
    lockType: f.passwordHash === null ? null : (f.lockType ?? "password") as FolderDto["lockType"],
    pinLength:
      f.passwordHash === null || f.lockType !== "pin"
        ? null
        : isFolderPinLength(f.pinLength)
          ? f.pinLength
          : null,
    bookmarkCount: counts.bookmarkCount,
    unreadCount: counts.unreadCount,
    createdAt: f.createdAt.toISOString(),
    updatedAt: f.updatedAt.toISOString(),
  };
}

const FETCH_STATUSES: readonly FetchStatus[] = ["pending", "ok", "unsupported", "failed"];

const EXTRACTION_REASONS: readonly ExtractionReason[] = [
  "non_html_content",
  "social_video_or_app",
  "js_required",
  "login_or_paywall",
  "bot_challenge",
  "consent_wall",
  "too_short",
  "not_an_article",
  "interrupted",
  "fetch_error",
];

const CONTENT_KIND_OVERRIDES: readonly ContentKindOverride[] = ["article", "web"];

export type BookmarkDtoFields = Pick<
  Bookmark,
  | "id"
  | "folderId"
  | "url"
  | "title"
  | "description"
  | "domain"
  | "fetchStatus"
  | "extractionReason"
  | "extractionVersion"
  | "contentKindOverride"
  | "author"
  | "publishedAt"
  | "readingTimeMinutes"
  | "readProgress"
  | "completedAt"
  | "isRead"
  | "createdAt"
  | "updatedAt"
> & {
  contentText?: string | null;
  contentMarkdown?: string | null;
  tags?: Array<{ tag: Pick<Tag, "id" | "name" | "color"> }>;
  suggestions?: Array<{ tag: Pick<Tag, "id" | "name" | "color"> }>;
};

export function toTagSummaryDto(tag: Pick<Tag, "id" | "name" | "color">): TagSummaryDto {
  return { id: tag.id, name: tag.name, color: normalizeTagColor(tag.color) };
}

export function toTagDto(
  tag: Tag & { _count?: { bookmarks: number } },
  bookmarkCount = tag._count?.bookmarks ?? 0,
): TagDto {
  return {
    ...toTagSummaryDto(tag),
    bookmarkCount,
    createdAt: tag.createdAt.toISOString(),
    updatedAt: tag.updatedAt.toISOString(),
  };
}

export function toBookmarkDto(
  b: BookmarkDtoFields,
  opts: { includeBodies?: boolean } = {},
): BookmarkDto {
  const fetchStatus = FETCH_STATUSES.includes(b.fetchStatus as FetchStatus)
    ? (b.fetchStatus as FetchStatus)
    : "failed";
  const extractionReason = EXTRACTION_REASONS.includes(b.extractionReason as ExtractionReason)
    ? (b.extractionReason as ExtractionReason)
    : null;
  const contentKindOverride = CONTENT_KIND_OVERRIDES.includes(b.contentKindOverride as ContentKindOverride)
    ? (b.contentKindOverride as ContentKindOverride)
    : null;
  return {
    id: b.id,
    folderId: b.folderId,
    url: b.url,
    title: b.title,
    description: b.description,
    domain: b.domain,
    contentText: opts.includeBodies ? (b.contentText ?? null) : null,
    contentMarkdown: opts.includeBodies ? (b.contentMarkdown ?? null) : null,
    fetchStatus,
    extractionReason,
    contentKind: bookmarkContentKind(fetchStatus, extractionReason, contentKindOverride),
    contentKindOverride,
    extractionVersion: b.extractionVersion,
    author: b.author,
    publishedAt: b.publishedAt?.toISOString() ?? null,
    readingTimeMinutes: b.readingTimeMinutes,
    readProgress: b.readProgress,
    completedAt: b.completedAt?.toISOString() ?? null,
    isRead: b.isRead,
    tags: (b.tags ?? [])
      .map(({ tag }) => toTagSummaryDto(tag))
      .sort((a, c) => a.name.localeCompare(c.name)),
    suggestedTags: (b.suggestions ?? [])
      .map(({ tag }) => toTagSummaryDto(tag))
      .sort((a, c) => a.name.localeCompare(c.name)),
    createdAt: b.createdAt.toISOString(),
    updatedAt: b.updatedAt.toISOString(),
  };
}

export function toBookmarkDetailDto(b: BookmarkDtoFields & Pick<Bookmark, "contentHtml">): BookmarkDto & { contentHtml: string | null } {
  return { ...toBookmarkDto(b, { includeBodies: true }), contentHtml: b.contentHtml };
}
