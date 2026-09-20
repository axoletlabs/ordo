/**
 * Library export as a streamed file download.
 *
 * Exports are metadata-only (no cached article content). Whole-library
 * exports include protected folders only when a valid folder token for each
 * is supplied via x-folder-tokens; scoped exports (one or more folder ids)
 * require every selected protected folder to be unlocked. Formats:
 *  - json : the versioned, lossless "ordo-export" envelope
 *  - html : Netscape bookmark file (flat folders)
 *  - csv  : Ordo's documented CSV profile
 */
import { Injectable } from "@nestjs/common";
import { Readable } from "node:stream";
import type { Prisma } from "../prisma/client.js";
import {
  ErrorCode,
  EXPORT_MIME,
  exportFolderScope,
  type ExportFormat,
  type ExportRequestInput,
} from "@ordo/shared";
import { PrismaService } from "../prisma/prisma.service.js";
import { TokenService } from "../auth/token.service.js";
import { AppError } from "../common/errors/app-error.js";
import { LibraryCryptoService } from "../crypto/library-crypto.service.js";

const PAGE_SIZE = 500;

/** Bookmark fields an export carries (metadata only — never content). */
const EXPORT_SELECT = {
  id: true,
  userId: true,
  folderId: true,
  url: true,
  title: true,
  description: true,
  author: true,
  publishedAt: true,
  readingTimeMinutes: true,
  readProgress: true,
  completedAt: true,
  isRead: true,
  createdAt: true,
  updatedAt: true,
} as const;

type ExportRow = {
  id: string;
  userId?: string;
  folderId: string | null;
  url: string;
  title: string;
  description: string | null;
  author: string | null;
  publishedAt: Date | null;
  readingTimeMinutes: number | null;
  readProgress: number;
  completedAt: Date | null;
  isRead: boolean;
  createdAt: Date;
  updatedAt: Date;
  tags?: Array<{ tag: { name: string } }>;
};

export interface ExportFile {
  stream: Readable;
  contentType: string;
  filename: string;
}

const CONTENT_TYPES: Record<ExportFormat, string> = {
  json: `${EXPORT_MIME.json}; charset=utf-8`,
  html: `${EXPORT_MIME.html}; charset=utf-8`,
  csv: `${EXPORT_MIME.csv}; charset=utf-8`,
};

@Injectable()
export class ExportService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly tokens: TokenService,
    private readonly crypto: LibraryCryptoService,
  ) {}

  async export(
    userId: string,
    input: ExportRequestInput,
    folderTokens: string[],
  ): Promise<ExportFile> {
    const folders = await this.prisma.folder.findMany({
      where: { userId },
      select: { id: true, name: true, icon: true, pinned: true, passwordHash: true, createdAt: true },
      orderBy: [{ pinned: "desc" }, { createdAt: "asc" }],
    });

    const requested = exportFolderScope(input);
    const includeUnfiled = requested === null;
    let includedFolderIds: string[];

    if (requested) {
      const byId = new Map(folders.map((f) => [f.id, f] as const));
      for (const id of requested) {
        if (!byId.has(id)) {
          throw new AppError(ErrorCode.FOLDER_NOT_FOUND, "This folder no longer exists.");
        }
      }
      for (const id of requested) {
        const folder = byId.get(id)!;
        if (!folder.passwordHash) continue;
        if (await this.folderUnlocked(folder.id, folderTokens)) continue;
        throw new AppError(ErrorCode.FOLDER_PROTECTED, "This folder is locked.", {
          folderId: folder.id,
        });
      }
      const requestedSet = new Set(requested);
      includedFolderIds = folders.filter((f) => requestedSet.has(f.id)).map((f) => f.id);
    } else {
      includedFolderIds = [];
      for (const folder of folders) {
        if (!folder.passwordHash) {
          includedFolderIds.push(folder.id);
          continue;
        }
        if (await this.folderUnlocked(folder.id, folderTokens)) includedFolderIds.push(folder.id);
      }
    }

    const date = new Date().toISOString().slice(0, 10);
    const filename = `ordo-export-${date}.${input.format}`;
    const dek = this.crypto.snapshot();
    const includedFolders = this.crypto.run(dek, () =>
      folders
        .filter((f) => includedFolderIds.includes(f.id))
        .map((f) => this.crypto.openFolder({ ...f, userId })),
    );

    const libraryWhere: Prisma.BookmarkWhereInput = includeUnfiled
      ? { userId, OR: [{ folderId: null }, { folderId: { in: includedFolderIds } }] }
      : { userId, folderId: { in: includedFolderIds } };

    const stream =
      input.format === "json"
        ? this.jsonStream(userId, dek, includedFolders, libraryWhere)
        : input.format === "html"
          ? this.htmlStream(userId, dek, includedFolders, includeUnfiled)
          : this.csvStream(userId, dek, includedFolders, libraryWhere);

    return { stream, contentType: CONTENT_TYPES[input.format], filename };
  }

  // --- format writers ---

  /** Ordo JSON envelope: folders list + every included bookmark. */
  private jsonStream(
    userId: string,
    dek: Buffer | null,
    folders: Array<{ id: string; name: string; icon: string; pinned: boolean; createdAt: Date }>,
    where: Prisma.BookmarkWhereInput,
  ): Readable {
    const nameById = new Map(folders.map((f) => [f.id, f.name] as const));
    const prisma = this.prisma;
    const crypto = this.crypto;

    async function* generate(): AsyncGenerator<string> {
      yield `{"format":"ordo-export","version":1,"exportedAt":${JSON.stringify(new Date().toISOString())}`;
      yield `,"folders":[`;
      let firstFolder = true;
      for (const folder of folders) {
        yield `${firstFolder ? "" : ","}${JSON.stringify({
          name: folder.name,
          icon: folder.icon,
          pinned: folder.pinned,
          createdAt: folder.createdAt.toISOString(),
        })}`;
        firstFolder = false;
      }
      yield `],"bookmarks":[`;

      let first = true;
      let cursor: { createdAt: Date; id: string } | null = null;
      for (;;) {
        const rows: ExportRow[] = await prisma.bookmark.findMany({
          where: cursorCondition(where, cursor),
          orderBy: [{ createdAt: "asc" }, { id: "asc" }],
          take: PAGE_SIZE,
          select: { ...EXPORT_SELECT, tags: { select: { tag: { select: { id: true, name: true } } } } },
        });
        if (rows.length === 0) break;
        for (const raw of rows) {
          const row = crypto.run(dek, () => crypto.openBookmark({ ...raw, userId })) as ExportRow;
          const payload = {
            url: row.url,
            title: row.title,
            folder: row.folderId ? (nameById.get(row.folderId) ?? null) : null,
            tags: (raw.tags ?? []).map((t) => crypto.run(dek, () => crypto.openTag({ ...t.tag, userId })).name as string).sort(),
            isRead: row.isRead,
            readProgress: row.readProgress,
            completedAt: row.completedAt?.toISOString() ?? null,
            createdAt: row.createdAt.toISOString(),
            updatedAt: row.updatedAt.toISOString(),
            description: row.description,
            author: row.author,
            publishedAt: row.publishedAt?.toISOString() ?? null,
            readingTimeMinutes: row.readingTimeMinutes,
          };
          yield `${first ? "" : ","}${JSON.stringify(payload)}`;
          first = false;
        }
        if (rows.length < PAGE_SIZE) break;
        const last = rows[rows.length - 1];
        cursor = { createdAt: last.createdAt, id: last.id };
      }
      yield `]}`;
    }

    return Readable.from(generate());
  }

  /** Netscape bookmark HTML: one flat folder section per folder, then unfiled. */
  private htmlStream(
    userId: string,
    dek: Buffer | null,
    folders: Array<{ id: string; name: string }>,
    includeUnfiled: boolean,
  ): Readable {
    const prisma = this.prisma;
    const crypto = this.crypto;

    async function* generate(): AsyncGenerator<string> {
      yield `<!DOCTYPE NETSCAPE-Bookmark-file-1>\n<!-- This is an automatically generated file. It will be read and overwritten. DO NOT EDIT! -->\n<META HTTP-EQUIV="Content-Type" CONTENT="text/html; charset=UTF-8">\n<TITLE>Bookmarks</TITLE>\n<H1>Bookmarks</H1>\n<DL><p>\n`;

      const emitFolder = async function* (
        folderName: string,
        folderId: string | null,
      ): AsyncGenerator<string> {
        const rows = await pageAll(prisma, { userId, folderId });
        // Library exports skip empty folders; a chosen folder is always emitted.
        if (rows.length === 0 && folderId !== null && includeUnfiled) return;
        yield `    <DT><H3>${escapeHtml(folderName)}</H3>\n    <DL><p>\n`;
        for (const raw of rows) {
          const row = crypto.run(dek, () => crypto.openBookmark({ ...raw, userId })) as ExportRow;
          const tagList = (raw.tags ?? [])
            .map((t) => crypto.run(dek, () => crypto.openTag({ ...t.tag, userId })).name as string)
            .join(",");
          yield `        <DT><A HREF="${escapeAttr(row.url)}" ADD_DATE="${unixSeconds(row.createdAt)}"${tagList ? ` TAGS="${escapeAttr(tagList)}"` : ""}>${escapeHtml(row.title)}</A>\n`;
        }
        yield `    </DL><p>\n`;
      };

      for (const folder of folders) {
        yield* emitFolder(folder.name, folder.id);
      }
      if (includeUnfiled) yield* emitFolder("Unfiled", null);
      yield `</DL><p>\n`;
    }

    return Readable.from(generate());
  }

  /** Ordo CSV profile: one row per bookmark. */
  private csvStream(
    userId: string,
    dek: Buffer | null,
    folders: Array<{ id: string; name: string }>,
    where: Prisma.BookmarkWhereInput,
  ): Readable {
    const nameById = new Map(folders.map((f) => [f.id, f.name] as const));
    const prisma = this.prisma;
    const crypto = this.crypto;

    async function* generate(): AsyncGenerator<string> {
      yield "url,title,folder,tags,isRead,readProgress,completedAt,createdAt,updatedAt,description,author,publishedAt,readingTimeMinutes\n";
      const rows = await pageAll(prisma, where);
      for (const raw of rows) {
        const row = crypto.run(dek, () => crypto.openBookmark({ ...raw, userId })) as ExportRow;
        yield [
          row.url,
          row.title,
          row.folderId ? (nameById.get(row.folderId) ?? "") : "",
          (raw.tags ?? []).map((t) => crypto.run(dek, () => crypto.openTag({ ...t.tag, userId })).name as string).join(","),
          String(row.isRead),
          String(row.readProgress),
          row.completedAt?.toISOString() ?? "",
          row.createdAt.toISOString(),
          row.updatedAt.toISOString(),
          row.description ?? "",
          row.author ?? "",
          row.publishedAt?.toISOString() ?? "",
          row.readingTimeMinutes === null ? "" : String(row.readingTimeMinutes),
        ]
          .map(csvCell)
          .join(",");
        yield "\n";
      }
    }

    return Readable.from(generate());
  }

  private async folderUnlocked(folderId: string, tokens: string[]): Promise<boolean> {
    for (const token of tokens) {
      if (!token) continue;
      const record = await this.prisma.folderToken.findFirst({
        where: { tokenHash: { in: this.tokens.lookupHashes(token) } },
      });
      if (record && record.folderId === folderId && record.expiresAt > new Date()) return true;
    }
    return false;
  }
}

/** Page through every bookmark matching `where` in (createdAt, id) order. */
async function pageAll(
  prisma: PrismaService,
  where: Prisma.BookmarkWhereInput,
): Promise<ExportRow[]> {
  const rows: ExportRow[] = [];
  let cursor: { createdAt: Date; id: string } | null = null;
  for (;;) {
    const page: ExportRow[] = await prisma.bookmark.findMany({
      where: cursorCondition(where, cursor),
      orderBy: [{ createdAt: "asc" }, { id: "asc" }],
      take: PAGE_SIZE,
      select: { ...EXPORT_SELECT, tags: { select: { tag: { select: { id: true, name: true } } } } },
    });
    rows.push(...page);
    if (page.length < PAGE_SIZE) break;
    const last = page[page.length - 1];
    cursor = { createdAt: last.createdAt, id: last.id };
  }
  return rows;
}

/** Combine the export filter with an ascending (createdAt, id) cursor. */
function cursorCondition(
  where: Prisma.BookmarkWhereInput,
  cursor: { createdAt: Date; id: string } | null,
): Prisma.BookmarkWhereInput {
  if (!cursor) return where;
  return {
    AND: [
      where,
      {
        OR: [
          { createdAt: { gt: cursor.createdAt } },
          { createdAt: cursor.createdAt, id: { gt: cursor.id } },
        ],
      },
    ],
  };
}

function unixSeconds(date: Date): number {
  return Math.floor(date.getTime() / 1000);
}

function escapeHtml(text: string): string {
  return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function escapeAttr(text: string): string {
  return escapeHtml(text).replace(/"/g, "&quot;");
}

/** Quote a CSV cell when needed (RFC 4180). */
function csvCell(value: string): string {
  return /[",\n\r]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;
}
