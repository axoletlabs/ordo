/**
 * Shared article-extraction queue.
 *
 * High-priority user saves jump ahead of boot refreshes. Per-host lanes keep
 * a noisy import from stalling other origins. The client can show one
 * progress figure (`18 of 95`) for everything currently pending.
 */
import { Injectable, Logger } from "@nestjs/common";
import { EXTRACTION_VERSION, type ExtractionProgressDto } from "@ordo/shared";
import { PrismaService } from "../prisma/prisma.service.js";
import {
  ReaderService,
  UnsupportedContentError,
  type ArticleMetadata,
} from "./reader.service.js";
import { TagSuggestionService } from "./tag-suggestion.service.js";

/** `full` overwrites title/metadata; `content` keeps the imported title. */
export type ExtractionMode = "full" | "content";
export type ExtractionPriority = "high" | "low";

export interface ExtractionTask {
  bookmarkId: string;
  url: string;
  userId: string;
  mode: ExtractionMode;
  /** Re-extract with the user's "this is an article" override. */
  forceArticle?: boolean;
  priority?: ExtractionPriority;
}

const CONCURRENCY = 8;
const PER_HOST = 3;
const LOW_PRIORITY_MAX = 2;

@Injectable()
export class ExtractionService {
  private readonly logger = new Logger(ExtractionService.name);
  private readonly high = new Map<string, ExtractionTask[]>();
  private readonly low = new Map<string, ExtractionTask[]>();
  private readonly queuedIds = new Set<string>();
  private readonly canceled = new Set<string>();
  private readonly controllers = new Map<string, AbortController>();
  private readonly hostActive = new Map<string, number>();
  /** userId → number of pending rows observed in this fetch wave. */
  private readonly waves = new Map<string, number>();
  private readonly idleWaiters: Array<() => void> = [];
  private active = 0;
  private lowActive = 0;

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
      if (this.canceled.has(task.bookmarkId)) this.canceled.delete(task.bookmarkId);
      this.queuedIds.add(task.bookmarkId);
      const lane = (task.priority ?? "high") === "low" ? this.low : this.high;
      const host = hostKey(task.url);
      const list = lane.get(host) ?? [];
      list.push(task);
      lane.set(host, list);
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

  /** Drop queued work and abort an in-flight fetch for a deleted bookmark. */
  cancel(bookmarkId: string): void {
    this.canceled.add(bookmarkId);
    this.queuedIds.delete(bookmarkId);
    this.dropQueued(bookmarkId);
    this.controllers.get(bookmarkId)?.abort();
  }

  prefetch(url: string): void {
    this.reader.prefetch(url);
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
    if (this.active === 0 && this.queueSize() === 0) return Promise.resolve();
    return new Promise((resolve) => this.idleWaiters.push(resolve));
  }

  /** Run one extraction immediately (tests + callers that already hold the slot). */
  async enrichBookmark(
    bookmarkId: string,
    url: string,
    mode: ExtractionMode = "full",
    forceArticle = false,
    cachedHtml?: string,
  ): Promise<void> {
    if (this.canceled.has(bookmarkId)) return;
    const existingOverride = await this.prisma.bookmark.findUnique({
      where: { id: bookmarkId },
      select: { contentKindOverride: true },
    });
    if (this.canceled.has(bookmarkId)) return;
    const force = forceArticle || existingOverride?.contentKindOverride === "article";
    const controller = new AbortController();
    this.controllers.set(bookmarkId, controller);
    let capturedHtml = cachedHtml;
    try {
      const extracted = await this.reader.extract(url, {
        forceArticle: force,
        html: cachedHtml,
        signal: controller.signal,
        onHtml: (html) => {
          capturedHtml = html;
        },
        onMetadata: (meta) => this.writeEarlyMetadata(bookmarkId, meta, mode, force),
      });
      if (this.canceled.has(bookmarkId)) return;
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
                contentMarkdown: extracted.contentMarkdown || null,
                contentText: extracted.contentText,
                fetchStatus: "ok",
                extractionReason: null,
                extractionVersion: EXTRACTION_VERSION,
              }
            : {
                readingTimeMinutes: extracted.readingTimeMinutes,
                contentHtml: extracted.contentHtml,
                contentMarkdown: extracted.contentMarkdown || null,
                contentText: extracted.contentText,
                fetchStatus: "ok",
                extractionReason: null,
                extractionVersion: EXTRACTION_VERSION,
              },
      });
      if (written.count > 0) this.tagSuggestions.refreshSafely(bookmarkId);
    } catch (err) {
      if (this.canceled.has(bookmarkId) || controller.signal.aborted) return;
      const unsupported = err instanceof UnsupportedContentError;
      const reason = unsupported ? err.reason : "fetch_error";
      this.logger.warn(
        `Extraction ${unsupported ? "rejected" : "failed"} for bookmark ${bookmarkId} (${safeHostname(url)}): ${reason} — ${(err as Error).message}`,
      );
      const existing = await this.prisma.bookmark.findUnique({
        where: { id: bookmarkId },
        select: { contentHtml: true, contentText: true },
      });
      if (this.canceled.has(bookmarkId)) return;
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
          await this.enrichBookmark(bookmarkId, url, mode, true, capturedHtml);
        }
      }
    } finally {
      this.controllers.delete(bookmarkId);
    }
  }

  private async writeEarlyMetadata(
    bookmarkId: string,
    meta: ArticleMetadata,
    mode: ExtractionMode,
    force: boolean,
  ): Promise<void> {
    if (mode !== "full") return;
    if (this.canceled.has(bookmarkId)) return;
    const data: {
      title?: string;
      description?: string | null;
      author?: string | null;
      publishedAt?: Date | null;
    } = {};
    if (meta.title) data.title = meta.title.slice(0, 500);
    if (meta.description) data.description = meta.description.slice(0, 1000);
    if (meta.author) data.author = meta.author.slice(0, 200);
    if (meta.publishedAt) data.publishedAt = new Date(meta.publishedAt);
    if (Object.keys(data).length === 0) return;
    await this.prisma.bookmark
      .updateMany({
        where: force
          ? { id: bookmarkId, contentKindOverride: "article", fetchStatus: "pending" }
          : { id: bookmarkId, fetchStatus: "pending" },
        data,
      })
      .catch((err: unknown) => {
        this.logger.debug(
          `Early metadata write skipped for ${bookmarkId}: ${(err as Error).message}`,
        );
      });
  }

  private pump(): void {
    while (this.active < CONCURRENCY) {
      const highTask = this.takeNext(this.high);
      const task =
        highTask ??
        (this.lowActive < LOW_PRIORITY_MAX ? this.takeNext(this.low) : undefined);
      if (!task) break;
      const isLow = !highTask;
      this.active += 1;
      if (isLow) this.lowActive += 1;
      this.bumpHost(task.url, 1);
      void this.enrichBookmark(task.bookmarkId, task.url, task.mode, task.forceArticle).finally(
        () => {
          this.active -= 1;
          if (isLow) this.lowActive -= 1;
          this.bumpHost(task.url, -1);
          this.queuedIds.delete(task.bookmarkId);
          this.pump();
          this.notifyIdle();
        },
      );
    }
    this.notifyIdle();
  }

  private takeNext(lane: Map<string, ExtractionTask[]>): ExtractionTask | undefined {
    for (const [host, list] of lane) {
      if ((this.hostActive.get(host) ?? 0) >= PER_HOST) continue;
      while (list.length > 0) {
        const task = list.shift()!;
        if (this.canceled.has(task.bookmarkId)) {
          this.queuedIds.delete(task.bookmarkId);
          continue;
        }
        if (list.length === 0) lane.delete(host);
        return task;
      }
      lane.delete(host);
    }
    return undefined;
  }

  private dropQueued(bookmarkId: string): void {
    for (const lane of [this.high, this.low]) {
      for (const [host, list] of lane) {
        const next = list.filter((task) => task.bookmarkId !== bookmarkId);
        if (next.length === 0) lane.delete(host);
        else if (next.length !== list.length) lane.set(host, next);
      }
    }
  }

  private queueSize(): number {
    let n = 0;
    for (const list of this.high.values()) n += list.length;
    for (const list of this.low.values()) n += list.length;
    return n;
  }

  private bumpHost(url: string, delta: number): void {
    const key = hostKey(url);
    const next = (this.hostActive.get(key) ?? 0) + delta;
    if (next <= 0) this.hostActive.delete(key);
    else this.hostActive.set(key, next);
  }

  private notifyIdle(): void {
    if (this.active !== 0 || this.queueSize() !== 0) return;
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
