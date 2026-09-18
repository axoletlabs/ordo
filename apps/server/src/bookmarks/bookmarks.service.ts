import { Injectable, Logger, type OnApplicationBootstrap } from "@nestjs/common";
import type { Folder, Prisma } from "../prisma/client.js";
import {
  DEFAULT_BOOKMARK_LIST_SORT,
  DEFAULT_PAGE_SIZE,
  ErrorCode,
  EXTRACTION_VERSION,
  MAX_PAGE_SIZE,
  MAX_TAGS_PER_BOOKMARK,
  MIN_FUZZY_TOKEN_LENGTH,
  READ_COMPLETION_THRESHOLD,
  parseBookmarkListSort,
  rankSearchResults,
  searchTokenPrefixPatterns,
  tokenizeSearchQuery,
  tokensAllowArticleText,
  unixSeconds,
  type BatchBookmarksInput,
  type BookmarkDetailDto,
  type BookmarkDto,
  type BookmarkListSort,
  type BookmarkReminderDto,
  type CursorPage,
} from "@ordo/shared";
import { PrismaService } from "../prisma/prisma.service.js";
import { AppError } from "../common/errors/app-error.js";
import { FolderAccessService } from "./folder-access.service.js";
import { TagsService } from "./tags.service.js";
import { ExtractionService } from "./extraction.service.js";
import { provisionalTitle } from "./provisional-title.js";
import { toBookmarkDto, toBookmarkDetailDto } from "../common/mappers.js";
import {
  clampLimit,
  decodeCursor,
  decodeSearchOffsetCursor,
  encodeCursor,
  encodeSearchOffsetCursor,
  encodeTitleCursor,
  decodeTitleCursor,
} from "../common/utils/cursor.js";
import { findFtsBookmarkIds, ftsBodyQuery, ftsPrefixQuery } from "../prisma/bookmark-fts.js";

const LIST_SELECT = {
  id: true,
  userId: true,
  folderId: true,
  url: true,
  title: true,
  description: true,
  domain: true,
  fetchStatus: true,
  extractionReason: true,
  extractionVersion: true,
  contentKindOverride: true,
  author: true,
  publishedAt: true,
  readingTimeMinutes: true,
  readProgress: true,
  completedAt: true,
  isRead: true,
  remindAt: true,
  createdAt: true,
  updatedAt: true,
  tags: {
    select: { tag: { select: { id: true, name: true, color: true } } },
  },
  suggestions: {
    where: { status: "pending" },
    select: { tag: { select: { id: true, name: true, color: true } } },
  },
} satisfies Prisma.BookmarkSelect;

type ListItem = Prisma.BookmarkGetPayload<{ select: typeof LIST_SELECT }>;

function reminderWhere(filter: "due" | "upcoming" | undefined): Prisma.BookmarkWhereInput[] {
  if (!filter) return [];
  const now = unixSeconds();
  if (filter === "due") return [{ remindAt: { lte: now } }];
  return [{ remindAt: { gt: now } }];
}

function listOrderBy(sort: BookmarkListSort): Prisma.BookmarkOrderByWithRelationInput[] {
  if (sort === "oldest") return [{ createdAt: "asc" }, { id: "asc" }];
  if (sort === "title") return [{ title: "asc" }, { id: "asc" }];
  if (sort === "titleDesc") return [{ title: "desc" }, { id: "desc" }];
  return [{ createdAt: "desc" }, { id: "desc" }];
}

function listCursorWhere(
  sort: BookmarkListSort,
  rawCursor: string | undefined,
): Prisma.BookmarkWhereInput | null {
  if (sort === "title" || sort === "titleDesc") {
    const cursor = decodeTitleCursor(rawCursor ?? null);
    if (!cursor) return null;
    const idOp = sort === "title" ? "gt" : "lt";
    const titleOp = sort === "title" ? "gt" : "lt";
    return {
      OR: [
        { title: { [titleOp]: cursor.title } },
        { title: cursor.title, id: { [idOp]: cursor.id } },
      ],
    };
  }
  const cursor = decodeCursor(rawCursor ?? null);
  if (!cursor) return null;
  const date = new Date(cursor.createdAt);
  const idOp = sort === "oldest" ? "gt" : "lt";
  const dateOp = sort === "oldest" ? "gt" : "lt";
  return {
    OR: [
      { createdAt: { [dateOp]: date } },
      { createdAt: date, id: { [idOp]: cursor.id } },
    ],
  };
}

function encodeListCursor(sort: BookmarkListSort, row: ListItem): string {
  if (sort === "title" || sort === "titleDesc") {
    return encodeTitleCursor({ title: row.title, id: row.id });
  }
  return encodeCursor({ createdAt: row.createdAt.toISOString(), id: row.id });
}

/** Background refresh tuning: small batches, finite spacing. */
const REFRESH_BATCH_SIZE = 50;
const REFRESH_DELAY_MS = 250;
/** AND matches are loaded first so they cannot be crowded out by OR hits. */
const SEARCH_AND_POOL_SIZE = 300;
const SEARCH_OR_POOL_SIZE = 200;
/** Hard stop so a pathological database can never loop forever. */
const REFRESH_MAX_BATCHES = 500;

@Injectable()
export class BookmarksService implements OnApplicationBootstrap {
  private readonly logger = new Logger(BookmarksService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly extraction: ExtractionService,
    private readonly access: FolderAccessService,
    private readonly tags: TagsService,
  ) {}

  async onApplicationBootstrap(): Promise<void> {
    // Extractions interrupted by a shutdown stay pending in the database; mark
    // them failed without a version so the refresh below retries them once.
    const interrupted = await this.prisma.bookmark.updateMany({
      where: { fetchStatus: "pending" },
      data: { fetchStatus: "failed", extractionReason: "interrupted" },
    });
    if (interrupted.count > 0) {
      this.logger.warn(`Marked ${interrupted.count} interrupted extractions as failed`);
    }
    // Non-blocking: never delay startup on re-extraction work.
    void this.refreshStaleExtractions();
  }

  /** Save immediately, then enrich the bookmark in the background. */
  async create(
    userId: string,
    folder: Folder | null,
    url: string,
    tagIds: string[] = [],
  ): Promise<BookmarkDto> {
    await this.tags.requireOwnedIds(userId, tagIds);
    const domain = this.safeHostname(url);
    const bookmark = await this.prisma.bookmark.create({
      data: {
        userId,
        folderId: folder ? folder.id : null,
        url,
        title: provisionalTitle(url, domain),
        domain,
        fetchStatus: "pending",
        tags: { create: tagIds.map((tagId) => ({ tagId })) },
      },
      select: LIST_SELECT,
    });
    this.extraction.enqueue([{ bookmarkId: bookmark.id, url, userId, mode: "full", priority: "high" }]);
    return toBookmarkDto(bookmark);
  }

  /** List a folder's bookmarks; a null folder lists only unfiled bookmarks.
   *  `scope=all` spans the whole library, hiding protected-folder bookmarks
   *  unless one of the presented unlock tokens opens them. */
  async list(
    userId: string,
    folder: Folder | null,
    opts: {
      cursor?: string;
      limit?: number;
      scopeAll?: boolean;
      tagIds?: string[];
      folderTokens?: string[];
      sort?: BookmarkListSort;
    },
  ): Promise<CursorPage<BookmarkDto>> {
    const tagIds = opts.tagIds ?? [];
    await this.tags.requireOwnedIds(userId, tagIds);
    const authorized = opts.scopeAll
      ? await this.access.authorizedFolderIds(userId, opts.folderTokens ?? [])
      : [];
    return this.paginate(
      {
        userId,
        ...(opts.scopeAll
          ? this.access.visibleBookmarksFilter(authorized)
          : { folderId: folder ? folder.id : null }),
        ...this.tagFilter(tagIds),
      },
      opts.cursor,
      opts.limit,
      (b) => toBookmarkDto(b),
      parseBookmarkListSort(opts.sort),
    );
  }

  async search(
    userId: string,
    q: string,
    opts: {
      cursor?: string;
      limit?: number;
      tagIds?: string[];
      folderIds?: string[];
      unfiled?: boolean;
      fuzzy?: boolean;
      unread?: boolean;
      reminder?: "due" | "upcoming";
      folderTokens?: string[];
    },
  ): Promise<CursorPage<BookmarkDto>> {
    const term = q.trim();
    const tagIds = opts.tagIds ?? [];
    const folderIds = opts.folderIds ?? [];
    const unfiled = !!opts.unfiled;
    const fuzzy = !!opts.fuzzy;
    await this.tags.requireOwnedIds(userId, tagIds);
    await this.access.requireOwnedIds(userId, folderIds);
    const authorized = await this.access.authorizedFolderIds(userId, opts.folderTokens ?? []);
    const tokens = tokenizeSearchQuery(term);
    const includeHiddenFields = tokensAllowArticleText(tokens);
    const where: Prisma.BookmarkWhereInput = {
      userId,
      AND: [
        this.access.visibleBookmarksFilter(authorized),
        ...this.folderScope(folderIds, unfiled),
        ...tagIds.map((tagId) => ({ tags: { some: { tagId } } })),
        ...(opts.unread === undefined ? [] : [{ isRead: !opts.unread }]),
        ...reminderWhere(opts.reminder),
      ],
    };

    if (!term) {
      return this.paginate(where, opts.cursor, opts.limit, (b) => toBookmarkDto(b));
    }

    const andMatch = ftsPrefixQuery(tokens, { fuzzy, includeHidden: includeHiddenFields, op: "AND" });
    const orMatch =
      tokens.length > 1
        ? ftsPrefixQuery(tokens, { fuzzy, includeHidden: includeHiddenFields, op: "OR" })
        : null;
    const bodyMatch = includeHiddenFields ? ftsBodyQuery(tokens, fuzzy) : null;
    if (!andMatch && tokens.every((token) => !searchTokenPrefixPatterns(token).startsWith)) {
      return { items: [], nextCursor: null, hasMore: false };
    }

    const [andFts, orFts, tagIdsByToken] = await Promise.all([
      andMatch
        ? findFtsBookmarkIds(this.prisma, { userId, match: andMatch, limit: SEARCH_AND_POOL_SIZE })
        : Promise.resolve([] as string[]),
      orMatch
        ? findFtsBookmarkIds(this.prisma, { userId, match: orMatch, limit: SEARCH_OR_POOL_SIZE })
        : Promise.resolve([] as string[]),
      Promise.all(tokens.map((token) => this.tagMatchIds(userId, token, tagIds, fuzzy))),
    ]);

    const candidateIds = uniqueIds([
      ...andFts,
      ...orFts,
      ...tagIdsByToken.flat(),
    ]).slice(0, SEARCH_AND_POOL_SIZE + SEARCH_OR_POOL_SIZE);
    if (candidateIds.length === 0) {
      return { items: [], nextCursor: null, hasMore: false };
    }

    const rows = await this.prisma.bookmark.findMany({
      where: { AND: [where, { id: { in: candidateIds } }] },
      select: LIST_SELECT,
    });

    let bodyIds = new Set<string>();
    if (bodyMatch && rows.length > 0) {
      bodyIds = new Set(
        await findFtsBookmarkIds(this.prisma, {
          userId,
          match: bodyMatch,
          limit: SEARCH_AND_POOL_SIZE + SEARCH_OR_POOL_SIZE,
        }),
      );
    }

    const ranked = rankSearchResults(
      rows.map((row) => ({
        ...toBookmarkDto(row),
        contentText: includeHiddenFields && bodyIds.has(row.id) ? tokens.join(" ") : null,
      })),
      term,
      { fuzzy, omitTagIds: tagIds },
    );
    const limit = clampLimit(opts.limit, DEFAULT_PAGE_SIZE, MAX_PAGE_SIZE);
    const offset = decodeSearchOffsetCursor(opts.cursor) ?? 0;
    const slice = ranked.slice(offset, offset + limit);
    const hasMore = ranked.length > offset + limit;
    return {
      items: slice.map(({ contentText: _body, ...item }) => item),
      nextCursor: hasMore ? encodeSearchOffsetCursor(offset + slice.length) : null,
      hasMore,
    };
  }

  async detail(
    userId: string,
    bookmarkId: string,
    tokens: readonly string[],
  ): Promise<BookmarkDetailDto> {
    const bookmark = await this.prisma.bookmark.findFirst({
      where: { id: bookmarkId, userId },
      include: {
        tags: { include: { tag: true } },
        suggestions: { where: { status: "pending" }, include: { tag: true } },
        highlights: { orderBy: [{ createdAt: "asc" }, { id: "asc" }] },
      },
    });
    if (!bookmark) throw new AppError(ErrorCode.BOOKMARK_NOT_FOUND, "This bookmark no longer exists.");
    // Enforce protection on the owning folder (unfiled bookmarks have none).
    if (bookmark.folderId) {
      await this.access.requireFolder(bookmark.folderId, userId, tokens);
    }
    return toBookmarkDetailDto(bookmark);
  }

  async update(
    userId: string,
    bookmarkId: string,
    changes: {
      folderId?: string | null;
      isRead?: boolean;
      readProgress?: number;
      contentKindOverride?: "article" | "web" | null;
      remindAt?: number | null;
    },
    tokens: readonly string[],
  ): Promise<BookmarkDto> {
    const bookmark = await this.prisma.bookmark.findFirst({
      where: { id: bookmarkId, userId },
    });
    if (!bookmark) throw new AppError(ErrorCode.BOOKMARK_NOT_FOUND, "This bookmark no longer exists.");

    // If the current folder is protected, require a valid token to mutate it.
    if (bookmark.folderId) {
      await this.access.requireFolder(bookmark.folderId, userId, tokens);
    }

    const data: {
      folderId?: string | null;
      isRead?: boolean;
      readProgress?: number;
      completedAt?: Date | null;
      contentKindOverride?: string | null;
      articleUndoSnapshot?: string | null;
      fetchStatus?: string;
      extractionReason?: string | null;
      title?: string;
      description?: string | null;
      author?: string | null;
      publishedAt?: Date | null;
      readingTimeMinutes?: number | null;
      contentHtml?: string | null;
      extractionVersion?: number | null;
      remindAt?: number | null;
    } = {};
    if (changes.isRead !== undefined) {
      data.isRead = changes.isRead;
      if (!changes.isRead) data.completedAt = null;
    }
    if (changes.readProgress !== undefined) {
      // Clamp defensively even though the schema already bounds it to 0..1.
      const progress = Math.min(1, Math.max(0, changes.readProgress));
      data.readProgress = progress;
      if (progress >= READ_COMPLETION_THRESHOLD) {
        data.isRead = true;
        data.completedAt = bookmark.completedAt ?? new Date();
      } else {
        data.completedAt = null;
      }
    }
    if (changes.folderId !== undefined) {
      if (changes.folderId === null) {
        // null explicitly moves the bookmark to unfiled.
        data.folderId = null;
      } else if (changes.folderId !== bookmark.folderId) {
        // target folder must exist & be owned; if protected, the token must cover it.
        await this.access.requireFolder(changes.folderId, userId, tokens);
        data.folderId = changes.folderId;
      }
    }
    if (changes.contentKindOverride !== undefined) {
      if (changes.contentKindOverride === "article") {
        data.contentKindOverride = "article";
        // Snapshot the website row once so unmark can restore it exactly.
        if (!bookmark.articleUndoSnapshot && bookmark.fetchStatus !== "ok") {
          data.articleUndoSnapshot = serializeArticleUndoSnapshot(bookmark);
        }
        if (bookmark.fetchStatus !== "ok" || !bookmark.contentHtml) {
          data.fetchStatus = "pending";
          data.extractionReason = null;
        }
      } else {
        const snapshot = parseArticleUndoSnapshot(bookmark.articleUndoSnapshot);
        if (snapshot) {
          Object.assign(data, restoreArticleUndoSnapshot(snapshot));
          data.contentKindOverride = null;
          data.articleUndoSnapshot = null;
        } else {
          data.contentKindOverride = changes.contentKindOverride;
        }
      }
    }
    if (changes.remindAt !== undefined) {
      data.remindAt = changes.remindAt;
    }

    const updated = await this.prisma.bookmark.update({
      where: { id: bookmarkId },
      data,
      select: LIST_SELECT,
    });
    if (changes.contentKindOverride === "article" && (bookmark.fetchStatus !== "ok" || !bookmark.contentHtml)) {
      this.extraction.enqueue([
        {
          bookmarkId,
          url: bookmark.url,
          userId,
          mode: "full",
          forceArticle: true,
          priority: "high",
        },
      ]);
    }
    return toBookmarkDto(updated);
  }

  async listReminders(userId: string): Promise<BookmarkReminderDto[]> {
    const rows = await this.prisma.bookmark.findMany({
      where: { userId, remindAt: { not: null } },
      select: { id: true, folderId: true, title: true, domain: true, description: true, remindAt: true },
      orderBy: [{ remindAt: "asc" }, { id: "asc" }],
    });
    return rows.flatMap((row) =>
      row.remindAt == null
        ? []
        : [
            {
              id: row.id,
              folderId: row.folderId,
              title: row.title,
              domain: row.domain,
              description: row.description,
              remindAt: row.remindAt,
            },
          ],
    );
  }

  async remove(
    userId: string,
    bookmarkId: string,
    tokens: readonly string[],
  ): Promise<void> {
    const bookmark = await this.prisma.bookmark.findFirst({
      where: { id: bookmarkId, userId },
    });
    if (!bookmark) throw new AppError(ErrorCode.BOOKMARK_NOT_FOUND, "This bookmark no longer exists.");
    if (bookmark.folderId) {
      await this.access.requireFolder(bookmark.folderId, userId, tokens);
    }
    this.extraction.cancel(bookmarkId);
    await this.prisma.bookmark.delete({ where: { id: bookmarkId } });
  }

  async updateTags(
    userId: string,
    bookmarkId: string,
    tagIds: string[],
    dismissedSuggestionIds: string[],
    tokens: readonly string[],
  ): Promise<BookmarkDto> {
    const bookmark = await this.prisma.bookmark.findFirst({
      where: { id: bookmarkId, userId },
      select: { id: true, folderId: true },
    });
    if (!bookmark) throw new AppError(ErrorCode.BOOKMARK_NOT_FOUND, "This bookmark no longer exists.");
    if (bookmark.folderId) {
      await this.access.requireFolder(bookmark.folderId, userId, tokens);
    }
    await this.tags.requireOwnedIds(userId, [...tagIds, ...dismissedSuggestionIds]);

    const updated = await this.prisma.$transaction(async (tx) => {
      await tx.bookmarkTag.deleteMany({ where: { bookmarkId } });
      if (tagIds.length > 0) {
        await tx.bookmarkTag.createMany({
          data: tagIds.map((tagId) => ({ bookmarkId, tagId })),
        });
      }
      if (dismissedSuggestionIds.length > 0) {
        await tx.bookmarkTagSuggestion.updateMany({
          where: { bookmarkId, tagId: { in: dismissedSuggestionIds }, status: "pending" },
          data: { status: "dismissed" },
        });
      }
      await tx.bookmarkTagSuggestion.deleteMany({
        where: { bookmarkId, tagId: { in: tagIds } },
      });
      return tx.bookmark.findUniqueOrThrow({ where: { id: bookmarkId }, select: LIST_SELECT });
    });
    return toBookmarkDto(updated);
  }

  /** Mark every unread bookmark in a folder as read; a null folder targets the
   *  user's unfiled bookmarks only. */
  async markAllRead(userId: string, folder: Folder | null): Promise<number> {
    const result = await this.prisma.bookmark.updateMany({
      where: { userId, folderId: folder ? folder.id : null, isRead: false },
      data: { isRead: true },
    });
    return result.count;
  }

  /** Apply one action to many bookmarks the user can currently access. */
  async batch(
    userId: string,
    input: BatchBookmarksInput,
    tokens: readonly string[],
  ): Promise<{ updated: number }> {
    const ids = [...new Set(input.ids)];
    const bookmarks = await this.prisma.bookmark.findMany({
      where: { id: { in: ids }, userId },
      select: { id: true, folderId: true },
    });
    await this.assertFolderAccess(userId, bookmarks, tokens);
    const targetIds = bookmarks.map((bookmark) => bookmark.id);
    if (targetIds.length === 0) return { updated: 0 };

    if (input.action === "delete") {
      for (const id of targetIds) this.extraction.cancel(id);
      const result = await this.prisma.bookmark.deleteMany({
        where: { id: { in: targetIds }, userId },
      });
      return { updated: result.count };
    }

    if (input.action === "markRead") {
      const result = await this.prisma.bookmark.updateMany({
        where: { id: { in: targetIds }, userId, isRead: false },
        data: { isRead: true },
      });
      return { updated: result.count };
    }

    if (input.action === "markUnread") {
      const result = await this.prisma.bookmark.updateMany({
        where: { id: { in: targetIds }, userId, isRead: true },
        data: { isRead: false, completedAt: null },
      });
      return { updated: result.count };
    }

    if (input.action === "move") {
      if (input.folderId) {
        await this.access.requireFolder(input.folderId, userId, tokens);
      }
      const result = await this.prisma.bookmark.updateMany({
        where: { id: { in: targetIds }, userId },
        data: { folderId: input.folderId },
      });
      return { updated: result.count };
    }

    return { updated: await this.addTagsToBookmarks(userId, targetIds, input.tagIds) };
  }

  private async assertFolderAccess(
    userId: string,
    bookmarks: Array<{ folderId: string | null }>,
    tokens: readonly string[],
  ): Promise<void> {
    const folderIds = [
      ...new Set(bookmarks.map((bookmark) => bookmark.folderId).filter((id): id is string => Boolean(id))),
    ];
    if (folderIds.length === 0) return;
    const folders = await this.prisma.folder.findMany({
      where: { userId, id: { in: folderIds } },
      select: { id: true, passwordHash: true },
    });
    if (folders.length !== folderIds.length) {
      throw new AppError(ErrorCode.FOLDER_NOT_FOUND, "This folder no longer exists.");
    }
    const locked = folders.filter((folder) => folder.passwordHash);
    if (locked.length === 0) return;
    const authorized = new Set(await this.access.authorizedFolderIds(userId, tokens));
    const blocked = locked.find((folder) => !authorized.has(folder.id));
    if (blocked) {
      throw new AppError(ErrorCode.FOLDER_PROTECTED, "This folder is locked.", {
        folderId: blocked.id,
      });
    }
  }

  private async addTagsToBookmarks(
    userId: string,
    bookmarkIds: string[],
    tagIds: string[],
  ): Promise<number> {
    const uniqueTagIds = [...new Set(tagIds)];
    await this.tags.requireOwnedIds(userId, uniqueTagIds);
    const existing = await this.prisma.bookmarkTag.findMany({
      where: { bookmarkId: { in: bookmarkIds } },
      select: { bookmarkId: true, tagId: true },
    });
    const currentByBookmark = new Map<string, Set<string>>();
    for (const id of bookmarkIds) currentByBookmark.set(id, new Set());
    for (const row of existing) {
      currentByBookmark.get(row.bookmarkId)?.add(row.tagId);
    }
    const links: Array<{ bookmarkId: string; tagId: string }> = [];
    for (const [bookmarkId, current] of currentByBookmark) {
      let remaining = MAX_TAGS_PER_BOOKMARK - current.size;
      if (remaining <= 0) continue;
      for (const tagId of uniqueTagIds) {
        if (current.has(tagId)) continue;
        if (remaining <= 0) break;
        links.push({ bookmarkId, tagId });
        remaining -= 1;
      }
    }
    if (links.length === 0) return bookmarkIds.length;
    await this.prisma.$transaction(async (tx) => {
      await tx.bookmarkTag.createMany({ data: links });
      await tx.bookmarkTagSuggestion.deleteMany({
        where: { bookmarkId: { in: bookmarkIds }, tagId: { in: uniqueTagIds } },
      });
    });
    return bookmarkIds.length;
  }

  // --- internals ---

  /**
   * Re-extract bookmarks whose content predates the current pipeline version
   * (including rows left unversioned by an interrupted boot). Runs in small
   * batches through the shared queue; because every outcome — ok, unsupported,
   * or failed — stamps the current version, rows are retried at most once per
   * version and never loop within a boot.
   */
  private async refreshStaleExtractions(): Promise<void> {
    try {
      for (let batch = 0; batch < REFRESH_MAX_BATCHES; batch += 1) {
        const stale = await this.prisma.bookmark.findMany({
          where: {
            fetchStatus: { not: "pending" },
            OR: [
              { extractionVersion: null },
              { extractionVersion: { lt: EXTRACTION_VERSION } },
            ],
          },
          select: { id: true, url: true, userId: true, contentKindOverride: true },
          orderBy: { id: "asc" },
          take: REFRESH_BATCH_SIZE,
        });
        if (stale.length === 0) return;

        this.extraction.enqueue(
          stale.map((row) => ({
            bookmarkId: row.id,
            url: row.url,
            userId: row.userId,
            mode: "full" as const,
            forceArticle: row.contentKindOverride === "article",
            priority: "low" as const,
          })),
          false,
        );
        await this.extraction.whenIdle();

        if (stale.length < REFRESH_BATCH_SIZE) return;
        await new Promise((resolve) => setTimeout(resolve, REFRESH_DELAY_MS));
      }
      this.logger.warn(
        `Stopped refreshing stale extractions after ${REFRESH_MAX_BATCHES} batches`,
      );
    } catch (err) {
      this.logger.error(`Stale extraction refresh failed: ${(err as Error).message}`);
    }
  }

  private async paginate<T>(
    where: Prisma.BookmarkWhereInput,
    rawCursor: string | undefined,
    rawLimit: number | undefined,
    map: (row: ListItem) => T,
    sort: BookmarkListSort = DEFAULT_BOOKMARK_LIST_SORT,
  ): Promise<CursorPage<T>> {
    const limit = clampLimit(rawLimit, DEFAULT_PAGE_SIZE, MAX_PAGE_SIZE);
    const cursorWhere = listCursorWhere(sort, rawCursor);

    const items: ListItem[] = await this.prisma.bookmark.findMany({
      where: cursorWhere ? { AND: [where, cursorWhere] } : where,
      orderBy: listOrderBy(sort),
      take: limit + 1,
      select: LIST_SELECT,
    });

    const hasMore = items.length > limit;
    const slice = hasMore ? items.slice(0, limit) : items;
    const last = slice[slice.length - 1];
    const nextCursor = hasMore && last ? encodeListCursor(sort, last) : null;

    return {
      items: slice.map(map),
      nextCursor,
      hasMore,
    };
  }

  private safeHostname(url: string): string {
    try {
      return new URL(url).hostname.replace(/^www\./, "");
    } catch {
      return url.slice(0, 255);
    }
  }

  private tagFilter(tagIds: string[]): Prisma.BookmarkWhereInput {
    return tagIds.length === 0
      ? {}
      : { AND: tagIds.map((tagId) => ({ tags: { some: { tagId } } })) };
  }

  private folderScope(folderIds: string[], unfiled: boolean): Prisma.BookmarkWhereInput[] {
    if (folderIds.length === 0 && !unfiled) return [];
    return [
      {
        OR: [
          ...(folderIds.length > 0 ? [{ folderId: { in: folderIds } }] : []),
          ...(unfiled ? [{ folderId: null }] : []),
        ],
      },
    ];
  }

  private async tagMatchIds(
    userId: string,
    token: string,
    omitTagIds: string[],
    fuzzy: boolean,
  ): Promise<string[]> {
    const stems = [token];
    if (fuzzy && token.length >= MIN_FUZZY_TOKEN_LENGTH) stems.push(token.slice(0, -1));
    const clauses = stems
      .map((stem) => tagNamePrefixWhere(stem, omitTagIds))
      .filter((clause): clause is Prisma.BookmarkWhereInput => clause != null);
    if (clauses.length === 0) return [];
    const rows = await this.prisma.bookmark.findMany({
      where: { userId, OR: clauses },
      select: { id: true },
      take: SEARCH_AND_POOL_SIZE,
    });
    return rows.map((row) => row.id);
  }
}

function uniqueIds(ids: readonly string[]): string[] {
  return [...new Set(ids)];
}

function tagNamePrefixWhere(token: string, omitTagIds: string[]): Prisma.BookmarkWhereInput | null {
  const { startsWith, contains } = searchTokenPrefixPatterns(token);
  if (!startsWith) return null;
  const nameOr = [
    { name: { startsWith } },
    ...contains.map((needle) => ({ name: { contains: needle } })),
  ];
  return {
    tags: {
      some: {
        ...(omitTagIds.length > 0 ? { tagId: { notIn: omitTagIds } } : {}),
        tag: { OR: nameOr },
      },
    },
  };
}

interface ArticleUndoSnapshot {
  title: string;
  description: string | null;
  author: string | null;
  publishedAt: string | null;
  readingTimeMinutes: number | null;
  contentHtml: string | null;
  fetchStatus: string;
  extractionReason: string | null;
  extractionVersion: number | null;
}

function serializeArticleUndoSnapshot(bookmark: {
  title: string;
  description: string | null;
  author: string | null;
  publishedAt: Date | null;
  readingTimeMinutes: number | null;
  contentHtml: string | null;
  fetchStatus: string;
  extractionReason: string | null;
  extractionVersion: number | null;
}): string {
  const snapshot: ArticleUndoSnapshot = {
    title: bookmark.title,
    description: bookmark.description,
    author: bookmark.author,
    publishedAt: bookmark.publishedAt?.toISOString() ?? null,
    readingTimeMinutes: bookmark.readingTimeMinutes,
    contentHtml: bookmark.contentHtml,
    fetchStatus: bookmark.fetchStatus,
    extractionReason: bookmark.extractionReason,
    extractionVersion: bookmark.extractionVersion,
  };
  return JSON.stringify(snapshot);
}

function parseArticleUndoSnapshot(raw: string | null | undefined): ArticleUndoSnapshot | null {
  if (!raw) return null;
  try {
    const value = JSON.parse(raw) as Partial<ArticleUndoSnapshot>;
    if (typeof value.title !== "string" || typeof value.fetchStatus !== "string") return null;
    return {
      title: value.title,
      description: value.description ?? null,
      author: value.author ?? null,
      publishedAt: value.publishedAt ?? null,
      readingTimeMinutes: value.readingTimeMinutes ?? null,
      contentHtml: value.contentHtml ?? null,
      fetchStatus: value.fetchStatus,
      extractionReason: value.extractionReason ?? null,
      extractionVersion: value.extractionVersion ?? null,
    };
  } catch {
    return null;
  }
}

function restoreArticleUndoSnapshot(snapshot: ArticleUndoSnapshot) {
  return {
    title: snapshot.title,
    description: snapshot.description,
    author: snapshot.author,
    publishedAt: snapshot.publishedAt ? new Date(snapshot.publishedAt) : null,
    readingTimeMinutes: snapshot.readingTimeMinutes,
    contentHtml: snapshot.contentHtml,
    fetchStatus: snapshot.fetchStatus,
    extractionReason: snapshot.extractionReason,
    extractionVersion: snapshot.extractionVersion,
    readProgress: 0,
    completedAt: null,
  };
}
