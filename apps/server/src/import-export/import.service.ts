/**
 * Staged import: upload → background parse → preview → confirmed commit.
 *
 * Jobs live in the ImportJob table and expire after an hour of idle time
 * (a sweeper runs on bootstrap + an interval). The ready → committing
 * transition is a conditional update so a double confirm cannot import twice.
 * Atomic mode wraps everything in one transaction; best-effort keeps rows
 * that succeed and reports the rest.
 *
 * Folder semantics during commit: source folder paths are flattened to single
 * Ordo names (nested "Research/AI" → "Research / AI") and merged into an
 * existing folder with the same (case-insensitive) name when present. Rows
 * carry either the resolved existing folder id or the name of a folder that
 * will be created inside the commit — never a raw source path.
 */
import {
  Injectable,
  Logger,
  type OnApplicationBootstrap,
  type OnModuleDestroy,
} from "@nestjs/common";
import { randomUUID } from "node:crypto";
import {
  DEFAULT_TAG_COLOR,
  ErrorCode,
  IMPORT_EXPORT,
  MAX_TAGS_PER_BOOKMARK,
  TAG_NAME_MAX_LENGTH,
  normalizeUrlForMatch,
  tagNameKey,
  type CommitImportInput,
  type DuplicatePolicy,
  type ImportJobDto,
  type ImportPreviewDto,
  type ImportResultDto,
  normalizeImportPreview,
} from "@ordo/shared";
import type { Prisma } from "@prisma/client";
import { PrismaService } from "../prisma/prisma.service.js";
import { TokenService } from "../auth/token.service.js";
import { AppError } from "../common/errors/app-error.js";
import { ExtractionService } from "../bookmarks/extraction.service.js";
import { detectAndParse } from "./parsers/index.js";
import type { InvalidRow, ParsedEntry, ParsedFolder } from "./parsers/parse-utils.js";
import { flattenFolderName, safeHostname } from "./parsers/parse-utils.js";

interface FolderRow {
  id: string;
  name: string;
  passwordHash: string | null;
}

interface BookmarkRow {
  id: string;
  url: string;
  folderId: string | null;
  isRead: boolean;
  readProgress: number;
  completedAt: Date | null;
  description: string | null;
  author: string | null;
}

/** What the staged `entries` JSON holds between parse and commit. */
interface StagedPayload {
  entries: ParsedEntry[];
  folders: ParsedFolder[];
}

/** Destination of one planned row: existing folder id, or a name to create. */
interface FolderRef {
  existingId: string | null;
  newFolderName: string | null;
}

const UNFILED: FolderRef = { existingId: null, newFolderName: null };

interface CommitPlan {
  creates: Array<{ entry: ParsedEntry; id: string; folder: FolderRef }>;
  updates: Array<{ entry: ParsedEntry; existing: BookmarkRow; folder: FolderRef }>;
  skipped: number;
  failed: InvalidRow[];
  foldersToCreate: ParsedFolder[];
  lockedFolders: string[];
}

@Injectable()
export class ImportService implements OnApplicationBootstrap, OnModuleDestroy {
  private readonly logger = new Logger(ImportService.name);
  private sweepTimer: ReturnType<typeof setInterval> | null = null;

  constructor(
    private readonly prisma: PrismaService,
    private readonly tokens: TokenService,
    private readonly extraction: ExtractionService,
  ) {}

  onApplicationBootstrap(): void {
    void this.sweep();
    this.sweepTimer = setInterval(() => void this.sweep(), IMPORT_EXPORT.SWEEP_MS);
    this.sweepTimer.unref?.();
  }

  onModuleDestroy(): void {
    if (this.sweepTimer) clearInterval(this.sweepTimer);
    this.sweepTimer = null;
  }

  /** Delete jobs past their expiry. */
  async sweep(): Promise<void> {
    try {
      await this.prisma.importJob.deleteMany({ where: { expiresAt: { lt: new Date() } } });
    } catch (err) {
      this.logger.warn(`Import job sweep failed: ${(err as Error).message}`);
    }
  }

  /** Stage an upload; parsing continues in the background. */
  async createJob(userId: string, fileName: string, text: string): Promise<{ jobId: string }> {
    const job = await this.prisma.importJob.create({
      data: {
        userId,
        status: "parsing",
        fileName: fileName.slice(0, 200),
        expiresAt: new Date(Date.now() + IMPORT_EXPORT.JOB_TTL_MS),
      },
    });
    void this.parseJob(job.id, userId, text);
    return { jobId: job.id };
  }

  async getJob(userId: string, jobId: string): Promise<ImportJobDto> {
    const job = await this.prisma.importJob.findFirst({ where: { id: jobId, userId } });
    if (!job) throw new AppError(ErrorCode.IMPORT_NOT_FOUND, "This import no longer exists.");
    if (job.expiresAt < new Date()) {
      await this.prisma.importJob.deleteMany({ where: { id: job.id } }).catch(() => undefined);
      throw new AppError(ErrorCode.IMPORT_NOT_FOUND, "This import expired. Upload the file again.");
    }
    return toJobDto(job);
  }

  /** Delete a staged or finished job. */
  async cancel(userId: string, jobId: string): Promise<void> {
    const job = await this.prisma.importJob.findFirst({ where: { id: jobId, userId } });
    if (!job) throw new AppError(ErrorCode.IMPORT_NOT_FOUND, "This import no longer exists.");
    if (job.status === "committing") {
      throw new AppError(ErrorCode.IMPORT_INVALID_STATE, "This import is already running.");
    }
    await this.prisma.importJob.deleteMany({ where: { id: job.id } });
  }

  /**
   * Confirm a previewed import. Flips ready → committing (guarded), then runs
   * the commit in the background; clients poll GET for the result.
   */
  async commit(
    userId: string,
    jobId: string,
    input: CommitImportInput,
    folderTokens: string[],
  ): Promise<ImportJobDto> {
    const claimed = await this.prisma.importJob.updateMany({
      where: { id: jobId, userId, status: "ready" },
      data: { status: "committing" },
    });
    if (claimed.count === 0) {
      const job = await this.prisma.importJob.findFirst({ where: { id: jobId, userId } });
      if (!job) throw new AppError(ErrorCode.IMPORT_NOT_FOUND, "This import no longer exists.");
      throw new AppError(
        ErrorCode.IMPORT_INVALID_STATE,
        `This import is ${job.status}; only a previewed import can be confirmed.`,
      );
    }
    void this.runCommit(jobId, userId, input, folderTokens);
    return this.getJob(userId, jobId);
  }

  // --- parsing + preview ---

  private async parseJob(jobId: string, userId: string, text: string): Promise<void> {
    try {
      const parsed = detectAndParse(text);
      const preview = await this.buildPreview(
        userId,
        parsed.format,
        parsed.entries,
        parsed.invalid,
        parsed.folders,
      );
      await this.prisma.importJob.update({
        where: { id: jobId },
        data: {
          status: "ready",
          sourceFormat: parsed.format,
          entries: JSON.stringify({
            entries: parsed.entries,
            folders: parsed.folders,
          } satisfies StagedPayload),
          preview: JSON.stringify(preview),
        },
      });
    } catch (err) {
      const message = err instanceof AppError ? err.message : "The file could not be parsed.";
      if (!(err instanceof AppError)) {
        this.logger.warn(`Import parse ${jobId} failed: ${(err as Error)?.message}`);
      }
      await this.prisma.importJob
        .update({ where: { id: jobId }, data: { status: "failed", failure: message } })
        .catch(() => undefined);
    }
  }

  private async buildPreview(
    userId: string,
    format: ImportPreviewDto["format"],
    entries: ParsedEntry[],
    invalid: InvalidRow[],
    folders: ParsedFolder[],
  ): Promise<ImportPreviewDto> {
    const existingUrls = new Set(
      (
        await this.prisma.bookmark.findMany({
          where: { userId },
          select: { url: true },
        })
      ).map((b) => normalizeUrlForMatch(b.url)),
    );
    const ownedFolders = await this.loadFolders(userId);

    let duplicates = 0;
    let uniqueDuplicates = 0;
    let withinFileDuplicates = 0;
    const seen = new Set<string>();
    const newFolders = new Set<string>();
    const existingFolders = new Set<string>();
    const lockedFolderMatches = new Set<string>();
    const duplicateSamples: ImportPreviewDto["duplicateSamples"] = [];

    for (const entry of entries) {
      const norm = normalizeUrlForMatch(entry.url);
      const intraFile = seen.has(norm);
      if (intraFile) withinFileDuplicates += 1;
      seen.add(norm);

      if (existingUrls.has(norm)) {
        duplicates += 1;
        if (!intraFile) {
          uniqueDuplicates += 1;
          if (duplicateSamples.length < IMPORT_EXPORT.MAX_INVALID_SAMPLES) {
            duplicateSamples.push({
              url: entry.url.slice(0, 200),
              title: entry.title.slice(0, 120),
            });
          }
        }
      }

      const name = flattenFolderName(entry.folderPath);
      if (!name) continue;
      const match = findFolder(ownedFolders, name);
      if (match) {
        existingFolders.add(match.name);
        if (match.passwordHash) lockedFolderMatches.add(match.name);
      } else {
        newFolders.add(name);
      }
    }
    // Ordo JSON can carry folders with no bookmarks; they import empty.
    for (const folder of folders) {
      const name = folder.name.trim().slice(0, IMPORT_EXPORT.FOLDER_NAME_MAX);
      if (name && !findFolder(ownedFolders, name) && !newFolders.has(name)) newFolders.add(name);
    }

    return {
      format,
      totalRows: entries.length + invalid.length,
      validRows: entries.length,
      invalidRows: invalid.length,
      duplicates,
      uniqueNew: seen.size - uniqueDuplicates,
      uniqueDuplicates,
      withinFileDuplicates,
      newFolders: [...newFolders].sort(),
      existingFolders: [...existingFolders].sort(),
      lockedFolderMatches: [...lockedFolderMatches].sort(),
      invalidSamples: invalid.slice(0, IMPORT_EXPORT.MAX_INVALID_SAMPLES),
      duplicateSamples,
    };
  }

  // --- commit ---

  private async runCommit(
    jobId: string,
    userId: string,
    input: CommitImportInput,
    folderTokens: string[],
  ): Promise<void> {
    try {
      const job = await this.prisma.importJob.findUnique({ where: { id: jobId } });
      if (!job?.entries) throw new AppError(ErrorCode.IMPORT_NOT_FOUND, "This import no longer exists.");
      const staged = JSON.parse(job.entries) as StagedPayload;

      const plan = await this.plan(userId, staged, input.duplicatePolicy, folderTokens);
      if (input.atomic && plan.lockedFolders.length > 0) {
        throw new AppError(
          ErrorCode.FOLDER_PROTECTED,
          `Unlock these folders before importing into them: ${plan.lockedFolders.join(", ")}.`,
        );
      }

      const result = input.atomic
        ? await this.commitAtomic(userId, input.duplicatePolicy, plan)
        : await this.commitBestEffort(userId, input.duplicatePolicy, plan);

      await this.prisma.importJob.update({
        where: { id: jobId },
        data: {
          status: "completed",
          result: JSON.stringify(result),
          entries: null,
          expiresAt: new Date(Date.now() + IMPORT_EXPORT.JOB_TTL_MS),
        },
      });

      if (plan.creates.length > 0) {
        this.extraction.enqueue(
          plan.creates.map((c) => ({
            bookmarkId: c.id,
            url: c.entry.url,
            userId,
            mode: "content" as const,
            priority: "high" as const,
          })),
        );
      }
    } catch (err) {
      const message = err instanceof AppError ? err.message : "The import could not be completed.";
      if (!(err instanceof AppError)) {
        this.logger.error(`Import commit ${jobId} failed: ${(err as Error)?.stack ?? err}`);
      }
      await this.prisma.importJob
        .update({ where: { id: jobId }, data: { status: "failed", failure: message, entries: null } })
        .catch(() => undefined);
    }
  }

  /** Partition staged entries against live data according to the policy. */
  private async plan(
    userId: string,
    staged: StagedPayload,
    policy: DuplicatePolicy,
    folderTokens: string[],
  ): Promise<CommitPlan> {
    const ownedFolders = await this.loadFolders(userId);
    const existingBookmarks = await this.prisma.bookmark.findMany({
      where: { userId },
      select: {
        id: true,
        url: true,
        folderId: true,
        isRead: true,
        readProgress: true,
        completedAt: true,
        description: true,
        author: true,
      },
    });
    const byNormUrl = new Map<string, BookmarkRow>();
    for (const b of existingBookmarks) {
      const norm = normalizeUrlForMatch(b.url);
      if (!byNormUrl.has(norm)) byNormUrl.set(norm, b);
    }

    const seenInFile = new Set<string>();
    const creates: CommitPlan["creates"] = [];
    const updates: CommitPlan["updates"] = [];
    const failed: InvalidRow[] = [];
    const foldersToCreate: ParsedFolder[] = [];
    const lockedKeys = new Set<string>();
    const lockedFolders: string[] = [];
    let skipped = 0;

    /** Resolve a flattened name against owned folders. */
    const resolveFolder = async (name: string): Promise<FolderRef | "locked"> => {
      const match = findFolder(ownedFolders, name);
      if (match) {
        if (match.passwordHash && !(await this.folderUnlocked(match.id, folderTokens))) {
          if (!lockedKeys.has(folderKey(match.name))) {
            lockedKeys.add(folderKey(match.name));
            lockedFolders.push(match.name);
          }
          return "locked";
        }
        return { existingId: match.id, newFolderName: null };
      }
      if (!foldersToCreate.some((f) => folderKey(f.name) === folderKey(name))) {
        foldersToCreate.push({ name });
      }
      return { existingId: null, newFolderName: name };
    };

    for (const entry of staged.entries) {
      const norm = normalizeUrlForMatch(entry.url);
      const intraFile = seenInFile.has(norm);
      seenInFile.add(norm);

      const existing = policy === "copy" ? undefined : byNormUrl.get(norm);
      if (existing && policy === "skip") {
        skipped += 1;
        continue;
      }
      // Within-file repeats import once (skip/update) or verbatim (copy).
      if (intraFile && policy !== "copy") {
        skipped += 1;
        continue;
      }

      const folderName = flattenFolderName(entry.folderPath);
      let folder: FolderRef = UNFILED;
      if (folderName) {
        const resolved = await resolveFolder(folderName);
        if (resolved === "locked") {
          failed.push({
            line: 0,
            reason: `The folder "${folderName}" is locked. Unlock it and try again.`,
            url: entry.url.slice(0, 200),
          });
          continue;
        }
        folder = resolved;
      }

      if (existing && policy === "update") {
        updates.push({ entry, existing, folder });
      } else {
        creates.push({ entry, id: randomUUID(), folder });
      }
    }

    // Ordo JSON folders without bookmarks still get created (when unlocked).
    for (const folder of staged.folders) {
      const name = folder.name.trim().slice(0, IMPORT_EXPORT.FOLDER_NAME_MAX);
      if (!name) continue;
      const match = findFolder(ownedFolders, name);
      if (match) {
        if (match.passwordHash && !(await this.folderUnlocked(match.id, folderTokens))) {
          if (!lockedKeys.has(folderKey(match.name))) {
            lockedKeys.add(folderKey(match.name));
            lockedFolders.push(match.name);
          }
        }
      } else if (!foldersToCreate.some((f) => folderKey(f.name) === folderKey(name))) {
        foldersToCreate.push({ ...folder, name });
      }
    }

    return { creates, updates, skipped, failed, foldersToCreate, lockedFolders };
  }

  private async commitAtomic(
    userId: string,
    policy: DuplicatePolicy,
    plan: CommitPlan,
  ): Promise<ImportResultDto> {
    return this.prisma.$transaction(async (tx) => {
      const newFolderIds = await this.createFolders(tx, userId, plan.foldersToCreate);
      await this.writeBookmarks(tx, userId, plan, newFolderIds);
      await this.applyTagLinks(tx, userId, plan);
      return {
        imported: plan.creates.length,
        updated: plan.updates.length,
        skipped: plan.skipped,
        failed: plan.failed.length,
        foldersCreated: plan.foldersToCreate.length,
        atomic: true,
        duplicatePolicy: policy,
        failures: plan.failed.slice(0, IMPORT_EXPORT.MAX_INVALID_SAMPLES),
      };
    });
  }

  private async commitBestEffort(
    userId: string,
    policy: DuplicatePolicy,
    plan: CommitPlan,
  ): Promise<ImportResultDto> {
    const failures = [...plan.failed];
    let newFolderIds: Map<string, string> | null = null;
    try {
      newFolderIds = await this.createFolders(this.prisma, userId, plan.foldersToCreate);
    } catch (err) {
      failures.push({ line: 0, reason: (err as Error).message.slice(0, 200), url: null });
    }
    if (newFolderIds) {
      try {
        await this.writeBookmarks(this.prisma, userId, plan, newFolderIds);
      } catch (err) {
        failures.push({ line: 0, reason: (err as Error).message.slice(0, 200), url: null });
      }
      await this.applyTagLinks(this.prisma, userId, plan).catch(() => undefined);
    }
    return {
      imported: plan.creates.length,
      updated: plan.updates.length,
      skipped: plan.skipped,
      failed: failures.length,
      foldersCreated: plan.foldersToCreate.length,
      atomic: false,
      duplicatePolicy: policy,
      failures: failures.slice(0, IMPORT_EXPORT.MAX_INVALID_SAMPLES),
    };
  }

  /** Create planned folders; returns name → id for the newly created ones. */
  private async createFolders(
    tx: Prisma.TransactionClient,
    userId: string,
    toCreate: ParsedFolder[],
  ): Promise<Map<string, string>> {
    const ids = new Map<string, string>();
    if (toCreate.length === 0) return ids;
    const max = await tx.folder.aggregate({ where: { userId }, _max: { position: true } });
    let position = (max._max.position ?? -1) + 1;
    for (const folder of toCreate) {
      const created = await tx.folder.create({
        data: {
          userId,
          name: folder.name,
          ...(folder.icon ? { icon: folder.icon } : {}),
          ...(folder.pinned !== undefined ? { pinned: folder.pinned } : {}),
          position: position++,
        },
      });
      ids.set(folder.name, created.id);
    }
    return ids;
  }

  private async writeBookmarks(
    tx: Prisma.TransactionClient,
    userId: string,
    plan: CommitPlan,
    newFolderIds: Map<string, string>,
  ): Promise<void> {
    const resolve = (folder: FolderRef): string | null =>
      folder.existingId ?? (folder.newFolderName ? (newFolderIds.get(folder.newFolderName) ?? null) : null);

    const now = new Date();
    for (let i = 0; i < plan.creates.length; i += IMPORT_EXPORT.BATCH_SIZE) {
      const batch = plan.creates.slice(i, i + IMPORT_EXPORT.BATCH_SIZE).map(({ entry, id, folder }) => {
        const createdAt = entry.createdAt ? new Date(entry.createdAt) : undefined;
        return {
          id,
          userId,
          folderId: resolve(folder),
          url: entry.url,
          title: entry.title || safeHostname(entry.url),
          description: entry.description,
          domain: safeHostname(entry.url),
          author: entry.author,
          publishedAt: entry.publishedAt ? new Date(entry.publishedAt) : null,
          readingTimeMinutes: entry.readingTimeMinutes,
          readProgress: entry.readProgress,
          completedAt: entry.completedAt
            ? new Date(entry.completedAt)
            : entry.isRead
              ? (createdAt ?? now)
              : null,
          isRead: entry.isRead,
          fetchStatus: "pending",
          ...(createdAt ? { createdAt } : {}),
        };
      });
      await tx.bookmark.createMany({ data: batch });
    }

    for (const { entry, existing, folder } of plan.updates) {
      const data: Prisma.BookmarkUpdateInput = {};
      if (entry.title) data.title = entry.title;
      if (entry.description && !existing.description) data.description = entry.description;
      if (entry.author && !existing.author) data.author = entry.author;
      if (entry.isRead && !existing.isRead) {
        data.isRead = true;
        if (!existing.completedAt) {
          data.completedAt = entry.completedAt ? new Date(entry.completedAt) : new Date();
        }
      }
      if (entry.readProgress > existing.readProgress) data.readProgress = entry.readProgress;
      const targetId = resolve(folder);
      if (targetId && targetId !== existing.folderId) {
        data.folder = { connect: { id: targetId } };
      }
      if (Object.keys(data).length > 0) {
        await tx.bookmark.update({ where: { id: existing.id }, data });
      }
    }
  }

  /** Resolve/create tags by name and attach them to created + updated rows. */
  private async applyTagLinks(
    tx: Prisma.TransactionClient,
    userId: string,
    plan: CommitPlan,
  ): Promise<void> {
    const tagged = [
      ...plan.creates.map((c) => ({ id: c.id, tags: c.entry.tags })),
      ...plan.updates.map((u) => ({ id: u.existing.id, tags: u.entry.tags })),
    ].filter((row) => row.tags.length > 0);
    if (tagged.length === 0) return;

    const names = [...new Set(tagged.flatMap((row) => row.tags.map((t) => tagNameKey(t))))];
    const existing = await tx.tag.findMany({
      where: { userId, normalizedName: { in: names } },
      select: { id: true, normalizedName: true },
    });
    const tagIds = new Map(existing.map((t) => [t.normalizedName, t.id] as const));
    for (const name of names) {
      if (tagIds.has(name)) continue;
      const display = tagged.flatMap((r) => r.tags).find((t) => tagNameKey(t) === name) ?? name;
      const created = await tx.tag.create({
        data: {
          userId,
          name: display.slice(0, TAG_NAME_MAX_LENGTH),
          normalizedName: name,
          color: DEFAULT_TAG_COLOR,
        },
      });
      tagIds.set(name, created.id);
    }

    const existingLinks = await tx.bookmarkTag.findMany({
      where: { bookmarkId: { in: tagged.map((row) => row.id) } },
      select: { bookmarkId: true, tagId: true },
    });
    const linkSet = new Set(existingLinks.map((l) => `${l.bookmarkId}:${l.tagId}`));

    const rows: Array<{ bookmarkId: string; tagId: string }> = [];
    for (const row of tagged) {
      const seen = new Set<string>();
      for (const tag of row.tags.slice(0, MAX_TAGS_PER_BOOKMARK)) {
        const tagId = tagIds.get(tagNameKey(tag));
        if (!tagId || seen.has(tagId)) continue;
        seen.add(tagId);
        const key = `${row.id}:${tagId}`;
        if (linkSet.has(key)) continue;
        linkSet.add(key);
        rows.push({ bookmarkId: row.id, tagId });
      }
    }
    for (let i = 0; i < rows.length; i += IMPORT_EXPORT.BATCH_SIZE) {
      await tx.bookmarkTag.createMany({ data: rows.slice(i, i + IMPORT_EXPORT.BATCH_SIZE) });
    }
  }

  // --- helpers ---

  private async loadFolders(userId: string): Promise<FolderRow[]> {
    return this.prisma.folder.findMany({
      where: { userId },
      select: { id: true, name: true, passwordHash: true },
      orderBy: { createdAt: "asc" },
    });
  }

  /** True when any supplied token unlocks the folder. */
  private async folderUnlocked(folderId: string, tokens: string[]): Promise<boolean> {
    for (const token of tokens) {
      if (!token) continue;
      const record = await this.prisma.folderToken.findUnique({
        where: { tokenHash: this.tokens.hash(token) },
      });
      if (record && record.folderId === folderId && record.expiresAt > new Date()) return true;
    }
    return false;
  }
}

function folderKey(name: string): string {
  return name.trim().toLocaleLowerCase("en-US");
}

/** Find an existing folder by (case-insensitive) flattened name. */
function findFolder(folders: FolderRow[], name: string): FolderRow | undefined {
  const key = folderKey(name);
  return folders.find((f) => folderKey(f.name) === key);
}

type ImportJobRow = {
  id: string;
  status: string;
  fileName: string | null;
  preview: string | null;
  failure: string | null;
  result: string | null;
  createdAt: Date;
  expiresAt: Date;
};

function toJobDto(job: ImportJobRow): ImportJobDto {
  let preview: ImportPreviewDto | null = null;
  let result: ImportResultDto | null = null;
  try {
    preview = job.preview ? normalizeImportPreview(JSON.parse(job.preview) as Partial<ImportPreviewDto>) : null;
  } catch {
    preview = null;
  }
  try {
    result = job.result ? (JSON.parse(job.result) as ImportResultDto) : null;
  } catch {
    result = null;
  }
  return {
    id: job.id,
    status: job.status as ImportJobDto["status"],
    fileName: job.fileName,
    createdAt: job.createdAt.toISOString(),
    expiresAt: job.expiresAt.toISOString(),
    preview,
    failure: job.failure,
    result,
  };
}
