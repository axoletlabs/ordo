import { Injectable } from "@nestjs/common";
import {
  ErrorCode,
  HIGHLIGHTS_PER_BOOKMARK_MAX,
  unionWithHighlights,
  type CreateHighlightInput,
  type HighlightDto,
  type UpdateHighlightInput,
} from "@ordo/shared";
import { PrismaService } from "../prisma/prisma.service.js";
import { AppError } from "../common/errors/app-error.js";
import { toHighlightDto } from "../common/mappers.js";
import { FolderAccessService } from "./folder-access.service.js";
import { LibraryCryptoService } from "../crypto/library-crypto.service.js";

type HighlightRow = {
  id: string;
  exact: string;
  prefix: string;
  suffix: string;
  href: string | null;
  createdAt: Date;
};

@Injectable()
export class HighlightsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly access: FolderAccessService,
    private readonly crypto: LibraryCryptoService,
  ) {}

  async create(
    userId: string,
    bookmarkId: string,
    input: CreateHighlightInput,
    tokens: readonly string[],
  ): Promise<HighlightDto> {
    const bookmark = await this.requireBookmark(userId, bookmarkId, tokens);
    const rows = (await this.prisma.bookmarkHighlight.findMany({ where: { bookmarkId } })).map((row) =>
      this.crypto.openHighlight(userId, row),
    );
    return this.persistMerged(userId, bookmarkId, bookmark.contentHtml, rows, input);
  }

  async update(
    userId: string,
    bookmarkId: string,
    highlightId: string,
    input: UpdateHighlightInput,
    tokens: readonly string[],
  ): Promise<HighlightDto> {
    const bookmark = await this.requireBookmark(userId, bookmarkId, tokens);
    const rows = (await this.prisma.bookmarkHighlight.findMany({ where: { bookmarkId } })).map((row) =>
      this.crypto.openHighlight(userId, row),
    );
    const current = rows.find((row) => row.id === highlightId);
    if (!current) {
      throw new AppError(ErrorCode.HIGHLIGHT_NOT_FOUND, "This highlight no longer exists.");
    }
    return this.persistMerged(userId, bookmarkId, bookmark.contentHtml, rows, input, highlightId);
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

  private async persistMerged(
    userId: string,
    bookmarkId: string,
    html: string | null,
    rows: HighlightRow[],
    input: CreateHighlightInput,
    keepId?: string,
  ): Promise<HighlightDto> {
    if (!html) {
      throw new AppError(ErrorCode.VALIDATION_ERROR, "This article has no text to highlight yet.");
    }
    const incoming = {
      exact: input.exact,
      prefix: input.prefix,
      suffix: input.suffix,
      href: input.href ?? null,
    };
    const others = rows
      .filter((row) => row.id !== keepId)
      .map((row) => ({
        id: row.id,
        exact: row.exact,
        prefix: row.prefix,
        suffix: row.suffix,
        href: row.href,
      }));
    const union = unionWithHighlights(html, others, incoming);
    if (!union) {
      throw new AppError(ErrorCode.VALIDATION_ERROR, "That passage is not in the article.");
    }
    const absorbIds = union.absorbIds;
    const href = union.quote.href ?? null;
    const duplicate = rows.find(
      (row) =>
        row.id !== keepId &&
        row.exact === union.quote.exact &&
        row.prefix === (union.quote.prefix ?? "") &&
        row.suffix === (union.quote.suffix ?? "") &&
        (row.href ?? null) === href,
    );
    const survivingId = keepId ?? absorbIds[0] ?? duplicate?.id;
    const deleteIds = absorbIds.filter((id) => id !== survivingId);
    if (!survivingId && rows.length - deleteIds.length >= HIGHLIGHTS_PER_BOOKMARK_MAX) {
      throw new AppError(
        ErrorCode.CONFLICT,
        `A bookmark can have at most ${HIGHLIGHTS_PER_BOOKMARK_MAX} highlights.`,
      );
    }

    return this.prisma.$transaction(async (tx) => {
      if (deleteIds.length > 0) {
        await tx.bookmarkHighlight.deleteMany({
          where: { bookmarkId, id: { in: deleteIds } },
        });
      }
      if (survivingId) {
        const updated = await tx.bookmarkHighlight.update({
          where: { id: survivingId },
          data: this.crypto.sealHighlight(userId, survivingId, {
            exact: union.quote.exact,
            prefix: union.quote.prefix ?? "",
            suffix: union.quote.suffix ?? "",
            href,
          }),
        });
        return toHighlightDto(this.crypto.openHighlight(userId, updated));
      }
      const id = this.crypto.active() ? this.crypto.newId() : undefined;
      const created = await tx.bookmarkHighlight.create({
        data: {
          ...(id ? { id } : {}),
          bookmarkId,
          ...this.crypto.sealHighlight(userId, id ?? "pending", {
            exact: union.quote.exact,
            prefix: union.quote.prefix ?? "",
            suffix: union.quote.suffix ?? "",
            href,
          }),
        },
      });
      return toHighlightDto(this.crypto.openHighlight(userId, created));
    });
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
    const opened = this.crypto.openBookmark({ ...bookmark, userId });
    return { id: bookmark.id, folderId: bookmark.folderId, contentHtml: opened.contentHtml as string | null };
  }
}
