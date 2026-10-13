import { Injectable, type OnApplicationBootstrap, type OnModuleDestroy } from "@nestjs/common";
import bcrypt from "bcryptjs";
import type { Folder } from "../prisma/client.js";
import { ErrorCode, TOKEN_TTL, isFolderPinLength, type FolderLockType } from "@ordo/shared";
import { PrismaService } from "../prisma/prisma.service.js";
import { AppError } from "../common/errors/app-error.js";
import { TokenService } from "../auth/token.service.js";

const FOLDER_BCRYPT_COST = 10;
/** Expired unlock tokens are pruned on this cadence so the table stays small. */
const FOLDER_TOKEN_SWEEP_MS = 60 * 60 * 1000;

/** Manages folder password protection and short-lived folder unlock tokens. */
@Injectable()
export class FolderTokenService implements OnApplicationBootstrap, OnModuleDestroy {
  private sweepTimer: ReturnType<typeof setInterval> | null = null;

  constructor(
    private readonly prisma: PrismaService,
    private readonly tokens: TokenService,
  ) {}

  onApplicationBootstrap(): void {
    void this.sweepExpired();
    this.sweepTimer = setInterval(() => void this.sweepExpired(), FOLDER_TOKEN_SWEEP_MS);
    this.sweepTimer.unref?.();
  }

  onModuleDestroy(): void {
    if (this.sweepTimer) clearInterval(this.sweepTimer);
    this.sweepTimer = null;
  }

  async setPassword(folderId: string, password: string, lockType: FolderLockType): Promise<void> {
    const passwordHash = await bcrypt.hash(password, FOLDER_BCRYPT_COST);
    await this.prisma.folder.update({
      where: { id: folderId },
      data: {
        passwordHash,
        lockType,
        pinLength: lockType === "pin" && isFolderPinLength(password.length) ? password.length : null,
      },
    });
    // invalidate any outstanding tokens for this folder
    await this.prisma.folderToken.deleteMany({ where: { folderId } });
  }

  async removePassword(folderId: string): Promise<void> {
    await this.prisma.folder.update({
      where: { id: folderId },
      data: { passwordHash: null, lockType: null, pinLength: null },
    });
    await this.prisma.folderToken.deleteMany({ where: { folderId } });
  }

  async assertPassword(folder: Folder, password: string): Promise<void> {
    if (!folder.passwordHash) {
      throw new AppError(ErrorCode.FORBIDDEN, "This folder is not locked.");
    }
    const ok = await bcrypt.compare(password, folder.passwordHash);
    if (!ok) {
      throw new AppError(ErrorCode.INVALID_FOLDER_PASSWORD, "That password is incorrect.");
    }
  }

  /** Verify the folder password and issue a short-lived folder-scoped token. */
  async unlock(folder: Folder, password: string): Promise<{ token: string; expiresIn: number }> {
    await this.assertPassword(folder, password);
    const { token, hash } = this.tokens.generateFolderToken();
    await this.prisma.folderToken.create({
      data: {
        folderId: folder.id,
        tokenHash: hash,
        expiresAt: new Date(Date.now() + TOKEN_TTL.FOLDER_MS),
      },
    });
    return { token, expiresIn: Math.round(TOKEN_TTL.FOLDER_MS / 1000) };
  }

  /** Delete unlock tokens whose TTL has passed. */
  private async sweepExpired(): Promise<void> {
    await this.prisma.folderToken
      .deleteMany({ where: { expiresAt: { lt: new Date() } } })
      .catch(() => undefined);
  }

  /** Resolve which folder IDs the given (untrusted) tokens validly unlock. */
  async resolveFolderIds(tokens: readonly string[]): Promise<string[]> {
    if (tokens.length === 0) return [];
    const records = await this.prisma.folderToken.findMany({
      where: {
        tokenHash: { in: [...new Set(tokens.flatMap((t) => this.tokens.lookupHashes(t)))] },
      },
      select: { folderId: true, expiresAt: true },
    });
    const now = new Date();
    return [...new Set(records.filter((r) => r.expiresAt >= now).map((r) => r.folderId))];
  }
}
