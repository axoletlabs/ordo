import { Injectable } from "@nestjs/common";
import type { Folder, Prisma } from "@prisma/client";
import { ErrorCode } from "@ordo/shared";
import { PrismaService } from "../prisma/prisma.service.js";
import { AppError } from "../common/errors/app-error.js";
import { FolderTokenService } from "./folder-token.service.js";

/**
 * Loads a folder, enforces ownership, and enforces password protection.
 * Throws FOLDER_NOT_FOUND (404) or FOLDER_PROTECTED (403) as appropriate.
 * Returns the resolved folder for reuse by callers (avoids a second query).
 */
@Injectable()
export class FolderAccessService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly folderTokens: FolderTokenService,
  ) {}

  async requireFolder(
    folderId: string,
    userId: string,
    tokens: string | readonly string[] | null,
  ): Promise<Folder> {
    const folder = await this.prisma.folder.findFirst({ where: { id: folderId, userId } });
    if (!folder) {
      throw new AppError(ErrorCode.FOLDER_NOT_FOUND, "This folder no longer exists.");
    }
    if (folder.passwordHash) {
      const presented = Array.isArray(tokens) ? tokens : tokens ? [tokens] : [];
      const unlocked = presented.length > 0 ? await this.folderTokens.resolveFolderIds(presented) : [];
      if (!unlocked.includes(folder.id)) {
        throw new AppError(ErrorCode.FOLDER_PROTECTED, "This folder is locked.", {
          folderId: folder.id,
        });
      }
    }
    return folder;
  }

  /** Same as requireFolder but also returns the folder when not protected
   *  (no token needed). Used for operations that always need the folder. */
  async loadOwned(folderId: string, userId: string): Promise<Folder> {
    const folder = await this.prisma.folder.findFirst({ where: { id: folderId, userId } });
    if (!folder) {
      throw new AppError(ErrorCode.FOLDER_NOT_FOUND, "This folder no longer exists.");
    }
    return folder;
  }

  /**
   * Folder IDs the given unlock tokens validly open for this user. Tokens are
   * untrusted input: they are hashed, checked for expiry, and scoped to folders
   * actually owned by the user.
   */
  async authorizedFolderIds(userId: string, tokens: readonly string[]): Promise<string[]> {
    const unlocked = await this.folderTokens.resolveFolderIds(tokens);
    if (unlocked.length === 0) return [];
    const owned = await this.prisma.folder.findMany({
      where: { userId, id: { in: unlocked } },
      select: { id: true },
    });
    return owned.map((f) => f.id);
  }

  /**
   * Bookmark filter matching every bookmark the user may see in global
   * contexts: unfiled, in unprotected folders, or in folders unlocked by the
   * presented tokens. Protected-folder content stays hidden until unlocked.
   */
  visibleBookmarksFilter(authorizedFolderIds: string[]): Prisma.BookmarkWhereInput {
    return {
      OR: [
        { folderId: null },
        { folder: { passwordHash: null } },
        { folderId: { in: authorizedFolderIds } },
      ],
    };
  }

  async requireOwnedIds(userId: string, folderIds: readonly string[]): Promise<void> {
    if (folderIds.length === 0) return;
    const unique = [...new Set(folderIds)];
    const count = await this.prisma.folder.count({
      where: { userId, id: { in: unique } },
    });
    if (count !== unique.length) {
      throw new AppError(ErrorCode.FOLDER_NOT_FOUND, "One or more folders no longer exist.");
    }
  }
}
