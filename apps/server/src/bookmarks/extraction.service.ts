/**
 * Shared article-extraction queue.
 *
 * Single bookmarks, imports, and stale refreshes all enqueue here so the
 * server never hammers a host, and so the client can show one progress
 * figure (`18 of 95`) for everything currently pending.
 */
import { Injectable, Logger } from "@nestjs/common";
import { EXTRACTION_VERSION, type ExtractionProgressDto } from "@ordo/shared";
import { PrismaService } from "../prisma/prisma.service.js";
import { ReaderService, UnsupportedContentError } from "./reader.service.js";
import { TagSuggestionService } from "./tag-suggestion.service.js";

/** `full` overwrites title/metadata; `content` keeps the imported title. */
export type ExtractionMode = "full" | "content";

export interface ExtractionTask {
  bookmarkId: string;
  url: string;
  userId: string;
  mode: ExtractionMode;
  /** Re-extract with the user's "this is an article" override. */
  forceArticle?: boolean;
}

const CONCURRENCY = 8;
const PER_HOST = 3;

@Injectable()
export class ExtractionService {
  private readonly logger = new Logger(ExtractionService.name);
  private readonly queue: ExtractionTask[] = [];
  private readonly queuedIds = new Set<string>();
  private readonly hostActive = new Map<string, number>();
  /** userId → number of pending rows observed in this fetch wave. */
  private readonly waves = new Map<string, number>();
  private readonly idleWaiters: Array<() => void> = [];
  private active = 0;

  constructor(
    private readonly prisma: PrismaService,
    private readonly reader: ReaderService,
    private readonly tagSuggestions: TagSuggestionService,
  ) {}

  /** Queue work; `countTowardProgress` is for newly pending rows (not stale refresh). */
  enqueue(tasks: ExtractionTask[], countTowardProgress = true): void {
    const added: ExtractionTask[] = [];
    for (const task of tasks) {
      if (this.queuedIds.has(task.bookmarkId)) continue;
      this.queuedIds.add(task.bookmarkId);
      this.queue.push(task);
      added.push(task);
    }
    if (countTowardProgress) {
      const byUser = new Map<string, number>();
      for (const task of added) {
        byUser.set(task.userId, (byUser.get(task.userId) ?? 0) + 1);
      }
      for (const [userId, n] of byUser) {
        this.waves.set(userId, (this.waves.get(userId) ?? 0) + n);
      }
    }
    this.pump();
  }

  async progress(userId: string): Promise<ExtractionProgressDto> {
    const pending = await this.prisma.bookmark.count({
      where: { userId, fetchStatus: "pending" },
    });
    if (pending === 0) {
      this.waves.delete(userId);
      return { pending: 0, total: 0, completed: 0 };
    }
    let total = this.waves.get(userId) ?? pending;
    if (pending > total) {
      total = pending;
      this.waves.set(userId, total);
    } else if (!this.waves.has(userId)) {
      this.waves.set(userId, total);
    }
    return { pending, total, completed: Math.max(0, total - pending) };
  }

  /** Resolves when the queue and in-flight workers are empty. */
  whenIdle(): Promise<void> {
    if (this.active === 0 && this.queue.length === 0) return Promise.resolve();
    return new Promise((resolve) => this.idleWaiters.push(resolve));
  }

  /** Run one extraction immediately (tests + callers that already hold the slot). */
  async enrichBookmark(
    bookmarkId: string,
    url: string,
    mode: ExtractionMode = "full",
    forceArticle = false,
  ): Promise<void> {
    const existingOverride = await this.prisma.bookmark.findUnique({
      where: { id: bookmarkId },
      select: { contentKindOverride: true },
    });
    const force = forceArticle || existingOverride?.contentKindOverride === "article";
    try {
      const extracted = await this.reader.extract(url, { forceArticle: force });
      // Drop a forced capture if the user unmarked while this job was in flight.
      const written = await this.prisma.bookmark.updateMany({
        where: force
          ? { id: bookmarkId, contentKindOverride: "article" }
          : { id: bookmarkId },
        data:
          mode === "full"
            ? {
                title: extracted.title,
                description: extracted.description,
                domain: extracted.domain,
                author: extracted.author,
                publishedAt: extracted.publishedAt ? new Date(extracted.publishedAt) : null,
                readingTimeMinutes: extracted.readingTimeMinutes,
                contentHtml: extracted.contentHtml,
                contentMarkdown: extracted.contentMarkdown,
                contentText: extracted.contentText,
                fetchStatus: "ok",
                extractionReason: null,
                extractionVersion: EXTRACTION_VERSION,
              }
            : {
                // Keep the imported title; regain the article body.
                readingTimeMinutes: extracted.readingTimeMinutes,
                contentHtml: extracted.contentHtml,
                contentMarkdown: extracted.contentMarkdown,
                contentText: extracted.contentText,
                fetchStatus: "ok",
                extractionReason: null,
                extractionVersion: EXTRACTION_VERSION,
              },
      });
      if (written.count > 0) this.tagSuggestions.refreshSafely(bookmarkId);
    } catch (err) {
      const unsupported = err instanceof UnsupportedContentError;
      const reason = unsupported ? err.reason : "fetch_error";
      this.logger.warn(
        `Extraction ${unsupported ? "rejected" : "failed"} for bookmark ${bookmarkId} (${safeHostname(url)}): ${reason} — ${(err as Error).message}`,
      );
      const existing = await this.prisma.bookmark.findUnique({
        where: { id: bookmarkId },
        select: { contentHtml: true, contentText: true },
      });
      const storedContentIsShell = existing?.contentText
        ? this.reader.classifyShellText(existing.contentText) !== null
        : false;
      const definitivelyUnreadable =
        unsupported &&
        (storedContentIsShell ||
          ["social_video_or_app", "js_required", "too_short", "not_an_article"].includes(reason));
      await this.prisma.bookmark
        .updateMany({
          where: force
            ? { id: bookmarkId, contentKindOverride: "article" }
            : { id: bookmarkId },
          data:
            definitivelyUnreadable || (unsupported && !existing?.contentHtml)
              ? {
                  fetchStatus: "unsupported",
                  extractionReason: reason,
                  extractionVersion: EXTRACTION_VERSION,
                  description: null,
                  author: null,
                  publishedAt: null,
                  contentHtml: null,
                  contentMarkdown: null,
                  contentText: null,
                  readingTimeMinutes: null,
                }
              : existing?.contentHtml
                ? {
                    fetchStatus: "ok",
                    extractionReason: null,
                    extractionVersion: EXTRACTION_VERSION,
                  }
                : {
                    fetchStatus: "failed",
                    extractionReason: reason,
                    extractionVersion: EXTRACTION_VERSION,
                  },
        })
        .catch((updateError: unknown) => {
          this.logger.error(
            `Could not update extraction status for bookmark ${bookmarkId}: ${(updateError as Error).message}`,
          );
        });
      if (!force) {
        const latest = await this.prisma.bookmark.findUnique({
          where: { id: bookmarkId },
          select: { contentKindOverride: true, contentHtml: true },
        });
        if (latest?.contentKindOverride === "article" && !latest.contentHtml) {
          await this.enrichBookmark(bookmarkId, url, mode, true);
        }
      }
    }
  }

  private pump(): void {
    while (this.active < CONCURRENCY && this.queue.length > 0) {
      const index = this.queue.findIndex((task) => (this.hostActive.get(hostKey(task.url)) ?? 0) < PER_HOST);
      if (index < 0) return;
      const task = this.queue.splice(index, 1)[0];
      this.active += 1;
      this.bumpHost(task.url, 1);
      void this.enrichBookmark(task.bookmarkId, task.url, task.mode, task.forceArticle).finally(() => {
        this.active -= 1;
        this.bumpHost(task.url, -1);
        this.queuedIds.delete(task.bookmarkId);
        this.pump();
        this.notifyIdle();
      });
    }
    this.notifyIdle();
  }

  private bumpHost(url: string, delta: number): void {
    const key = hostKey(url);
    const next = (this.hostActive.get(key) ?? 0) + delta;
    if (next <= 0) this.hostActive.delete(key);
    else this.hostActive.set(key, next);
  }

  private notifyIdle(): void {
    if (this.active !== 0 || this.queue.length !== 0) return;
    const waiters = this.idleWaiters.splice(0);
    for (const waiter of waiters) waiter();
  }
}

function hostKey(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "").toLowerCase();
  } catch {
    return "_";
  }
}

function safeHostname(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return url.slice(0, 255);
  }
}
