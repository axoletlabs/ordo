import { Injectable } from "@nestjs/common";
import bcrypt from "bcryptjs";
import type {
  BatchFoldersInput,
  CreateFolderInput,
  FolderDto,
  RemoveFolderPasswordInput,
  SetFolderPasswordInput,
  UpdateFolderInput,
} from "@ordo/shared";
import { ErrorCode } from "@ordo/shared";
import { PrismaService } from "../prisma/prisma.service.js";
import { AppError } from "../common/errors/app-error.js";
import { RateLimitService } from "../common/rate-limit/rate-limit.service.js";
import { FolderTokenService } from "./folder-token.service.js";
import { FolderAccessService } from "./folder-access.service.js";
import { toFolderDto } from "../common/mappers.js";
import { LibraryCryptoService } from "../crypto/library-crypto.service.js";

@Injectable()
export class FoldersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly folderTokens: FolderTokenService,
    private readonly access: FolderAccessService,
    private readonly rateLimit: RateLimitService,
    private readonly crypto: LibraryCryptoService,
  ) {}

  async list(userId: string): Promise<FolderDto[]> {
    const folders = await this.prisma.folder.findMany({
      where: { userId },
      // pinned folders first, then manual position, then creation order
      orderBy: [
        { pinned: "desc" },
        { position: "asc" },
        { createdAt: "asc" },
      ],
      include: { _count: { select: { bookmarks: true } } },
    });

    const unreadGroups = await this.prisma.bookmark.groupBy({
      by: ["folderId"],
      where: { userId, isRead: false },
      _count: { _all: true },
    });
    const unreadByFolder = new Map(
      unreadGroups.map((g) => [g.folderId, g._count._all] as const),
    );

    return folders.map((f) =>
      this.presentFolder(f, {
        bookmarkCount: f._count.bookmarks,
        unreadCount: unreadByFolder.get(f.id) ?? 0,
      }),
    );
  }

  async create(userId: string, input: CreateFolderInput): Promise<FolderDto> {
    const maxPosition = await this.prisma.folder.aggregate({
      where: { userId },
      _max: { position: true },
    });
    const id = this.crypto.active() ? this.crypto.newId() : undefined;
    const folder = await this.prisma.folder.create({
      data: {
        ...(id ? { id } : {}),
        userId,
        name: this.crypto.sealFolderName(userId, id ?? "pending", input.name),
        // undefined falls back to the schema default (folder-outline)
        ...(input.icon !== undefined ? { icon: input.icon } : {}),
        position: (maxPosition._max.position ?? -1) + 1,
      },
    });
    return this.presentFolder(folder, { bookmarkCount: 0, unreadCount: 0 });
  }

  /** Partial metadata update: name, icon, and/or pinned. */
  async update(
    folderId: string,
    userId: string,
    input: UpdateFolderInput,
    tokens: readonly string[] = [],
  ): Promise<FolderDto> {
    await this.access.requireFolder(folderId, userId, tokens);
    const data: { name?: string; icon?: string; pinned?: boolean } = {};
    if (input.name !== undefined) data.name = this.crypto.sealFolderName(userId, folderId, input.name);
    if (input.icon !== undefined) data.icon = input.icon;
    if (input.pinned !== undefined) data.pinned = input.pinned;

    const updated = await this.prisma.folder.update({ where: { id: folderId }, data });
    return this.presentFolder(updated, await this.folderCounts(folderId));
  }

  /** Locked folders can only be deleted while unlocked (token presented). */
  async remove(folderId: string, userId: string, tokens: readonly string[] = []): Promise<void> {
    await this.access.requireFolder(folderId, userId, tokens);
    await this.prisma.folder.delete({ where: { id: folderId } });
  }

  async batch(userId: string, input: BatchFoldersInput, tokens: readonly string[] = []): Promise<{ updated: number }> {
    const ids = [...new Set(input.ids)];
    if (input.action === "delete") {
      for (const id of ids) {
        await this.access.requireFolder(id, userId, tokens);
      }
      const result = await this.prisma.folder.deleteMany({
        where: { id: { in: ids }, userId },
      });
      return { updated: result.count };
    }
    const result = await this.prisma.folder.updateMany({
      where: { id: { in: ids }, userId },
      data: { pinned: input.pinned },
    });
    return { updated: result.count };
  }

  async setPassword(
    folderId: string,
    userId: string,
    input: SetFolderPasswordInput,
    tokens: readonly string[] = [],
  ): Promise<void> {
    const folder = await this.access.loadOwned(folderId, userId);
    if (folder.passwordHash) {
      await this.access.requireFolder(folderId, userId, tokens);
    }
    await this.folderTokens.setPassword(folderId, input.password, input.lockType);
  }

  async removePassword(
    folderId: string,
    userId: string,
    input: RemoveFolderPasswordInput,
  ): Promise<void> {
    const folder = await this.access.loadOwned(folderId, userId);
    if (!folder.passwordHash) {
      throw new AppError(ErrorCode.FORBIDDEN, "This folder is not locked.");
    }
    const folderPassword = input.folderPassword;
    if (folderPassword) {
      await this.withFolderUnlockLimit(userId, folderId, () =>
        this.folderTokens.assertPassword(folder, folderPassword),
      );
    } else {
      const user = await this.prisma.user.findUnique({ where: { id: userId } });
      if (!user) throw new AppError(ErrorCode.UNAUTHORIZED, "Account not found.");
      const ok = await bcrypt.compare(input.accountPassword ?? "", user.passwordHash);
      if (!ok) {
        throw new AppError(ErrorCode.INVALID_CREDENTIALS, "Incorrect account password.");
      }
    }
    await this.folderTokens.removePassword(folderId);
  }

  async unlock(
    folderId: string,
    userId: string,
    password: string,
  ): Promise<{ token: string; expiresIn: number }> {
    const folder = await this.access.loadOwned(folderId, userId);
    return this.withFolderUnlockLimit(userId, folderId, () =>
      this.folderTokens.unlock(folder, password),
    );
  }

  /**
   * Count only wrong folder secrets. Successful checks clear the window;
   * validation errors and account-password removals never touch it.
   */
  private async withFolderUnlockLimit<T>(
    userId: string,
    folderId: string,
    fn: () => Promise<T>,
  ): Promise<T> {
    this.rateLimit.checkFolderUnlock(userId, folderId);
    try {
      const result = await fn();
      this.rateLimit.clearFolderUnlock(userId, folderId);
      return result;
    } catch (cause) {
      if (cause instanceof AppError && cause.code === ErrorCode.INVALID_FOLDER_PASSWORD) {
        this.rateLimit.recordFolderUnlockFailure(userId, folderId);
      }
      throw cause;
    }
  }

  /** Live bookmark counts for a single folder. */
  private async folderCounts(
    folderId: string,
  ): Promise<{ bookmarkCount: number; unreadCount: number }> {
    const [bookmarkCount, unreadCount] = await this.prisma.$transaction([
      this.prisma.bookmark.count({ where: { folderId } }),
      this.prisma.bookmark.count({ where: { folderId, isRead: false } }),
    ]);
    return { bookmarkCount, unreadCount };
  }

  private presentFolder(
    folder: Parameters<typeof toFolderDto>[0],
    counts: { bookmarkCount: number; unreadCount: number },
  ): FolderDto {
    return toFolderDto(this.crypto.openFolder(folder), counts);
  }
}
