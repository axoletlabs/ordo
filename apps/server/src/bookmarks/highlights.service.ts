import { Injectable } from "@nestjs/common";
import {
  ErrorCode,
  HIGHLIGHTS_PER_BOOKMARK_MAX,
  canAnchorHighlight,
  type CreateHighlightInput,
  type HighlightDto,
} from "@ordo/shared";
import { PrismaService } from "../prisma/prisma.service.js";
import { AppError } from "../common/errors/app-error.js";
import { toHighlightDto } from "../common/mappers.js";
import { FolderAccessService } from "./folder-access.service.js";

@Injectable()
export class HighlightsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly access: FolderAccessService,
  ) {}

  async create(
    userId: string,
    bookmarkId: string,
    input: CreateHighlightInput,
    tokens: readonly string[],
  ): Promise<HighlightDto> {
    const bookmark = await this.requireBookmark(userId, bookmarkId, tokens);
    if (!bookmark.contentHtml) {
      throw new AppError(ErrorCode.VALIDATION_ERROR, "This article has no text to highlight yet.");
    }
    const href = input.href ?? null;
    if (!canAnchorHighlight(bookmark.contentHtml, { ...input, href })) {
      throw new AppError(ErrorCode.VALIDATION_ERROR, "That passage is not in the article.");
    }
    const existing = await this.prisma.bookmarkHighlight.findFirst({
      where: {
        bookmarkId,
        exact: input.exact,
        prefix: input.prefix,
        suffix: input.suffix,
        href,
      },
    });
    if (existing) return toHighlightDto(existing);
    const count = await this.prisma.bookmarkHighlight.count({ where: { bookmarkId } });
    if (count >= HIGHLIGHTS_PER_BOOKMARK_MAX) {
      throw new AppError(
        ErrorCode.CONFLICT,
        `A bookmark can have at most ${HIGHLIGHTS_PER_BOOKMARK_MAX} highlights.`,
      );
    }
    const created = await this.prisma.bookmarkHighlight.create({
      data: {
        bookmarkId,
        exact: input.exact,
        prefix: input.prefix,
        suffix: input.suffix,
        href,
      },
    });
    return toHighlightDto(created);
  }

  async remove(
    userId: string,
    bookmarkId: string,
    highlightId: string,
    tokens: readonly string[],
  ): Promise<void> {
    await this.requireBookmark(userId, bookmarkId, tokens);
    const deleted = await this.prisma.bookmarkHighlight.deleteMany({
      where: { id: highlightId, bookmarkId },
    });
    if (deleted.count === 0) {
      throw new AppError(ErrorCode.HIGHLIGHT_NOT_FOUND, "This highlight no longer exists.");
    }
  }

  private async requireBookmark(userId: string, bookmarkId: string, tokens: readonly string[]) {
    const bookmark = await this.prisma.bookmark.findFirst({
      where: { id: bookmarkId, userId },
      select: { id: true, folderId: true, contentHtml: true },
    });
    if (!bookmark) throw new AppError(ErrorCode.BOOKMARK_NOT_FOUND, "This bookmark no longer exists.");
    if (bookmark.folderId) {
      await this.access.requireFolder(bookmark.folderId, userId, tokens);
    }
    return bookmark;
  }
}
