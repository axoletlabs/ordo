import { Injectable, Logger } from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service.js";
import { scoreTagSuggestions } from "./tag-suggestions.js";
import { htmlToSearchText } from "./html-text.js";
import { LibraryCryptoService } from "../crypto/library-crypto.service.js";

/**
 * Maintains deterministic pending tag suggestions for a bookmark. Suggestions
 * only ever reference the user's existing tags; accepting or dismissing them
 * is the client's decision (via PUT /bookmarks/:id/tags). Dismissals persist
 * across re-extractions.
 */
@Injectable()
export class TagSuggestionService {
  private readonly logger = new Logger(TagSuggestionService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly crypto: LibraryCryptoService,
  ) {}

  /** Recompute pending suggestions from the bookmark's latest stored content. */
  async refresh(bookmarkId: string): Promise<void> {
    const bookmark = await this.prisma.bookmark.findUnique({
      where: { id: bookmarkId },
      select: {
        id: true,
        userId: true,
        fetchStatus: true,
        title: true,
        description: true,
        domain: true,
        contentHtml: true,
        tags: { select: { tagId: true } },
        suggestions: { select: { tagId: true, status: true } },
      },
    });
    if (!bookmark || bookmark.fetchStatus !== "ok") return;
    const opened = this.crypto.openBookmark(bookmark);

    const excluded = new Set<string>([
      ...bookmark.tags.map(({ tagId }) => tagId),
      ...bookmark.suggestions
        .filter((s) => s.status === "dismissed")
        .map(({ tagId }) => tagId),
    ]);

    const candidates = await this.prisma.tag.findMany({
      where: { userId: bookmark.userId },
      select: { id: true, name: true, userId: true },
    });
    const named = candidates.map((tag) => this.crypto.openTag(tag));

    const suggested = scoreTagSuggestions(
      named.filter((tag) => !excluded.has(tag.id as string)).map((tag) => ({
        id: tag.id as string,
        name: tag.name as string,
      })),
      {
        title: opened.title as string,
        description: (opened.description as string | null) ?? null,
        domain: opened.domain as string,
        body: htmlToSearchText((opened.contentHtml as string | null) ?? null),
      },
    ).map(({ id }) => id);

    await this.prisma.$transaction([
      this.prisma.bookmarkTagSuggestion.deleteMany({
        where: { bookmarkId, status: "pending" },
      }),
      ...(suggested.length > 0
        ? [
            this.prisma.bookmarkTagSuggestion.createMany({
              data: suggested.map((tagId) => ({ bookmarkId, tagId })),
            }),
          ]
        : []),
    ]);
  }

  /** Fire-and-forget wrapper for use inside the extraction pipeline. */
  refreshSafely(bookmarkId: string): void {
    const dek = this.crypto.snapshot();
    this.crypto.runAsync(dek, () => this.refresh(bookmarkId)).catch((err: unknown) => {
      // Suggestion failures must never affect the bookmark itself.
      this.logger.warn(
        `Tag suggestions failed for bookmark ${bookmarkId}: ${(err as Error).message}`,
      );
    });
  }
}
