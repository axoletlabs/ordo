import { Injectable } from "@nestjs/common";
import { tagNameKey } from "@ordo/shared";
import { PrismaService } from "../prisma/prisma.service.js";
import {
  DATA_ENCRYPTION_VERSION,
  isLibraryCiphertext,
  unwrapDekWithPassword,
  wrapDekWithPassword,
  wrapDekWithRecoveryKey,
} from "./library-crypto.js";
import { LibraryCryptoService } from "./library-crypto.service.js";
import { sealBookmark, sealFolderName, sealHighlight, sealImportJob, sealTag } from "./library-fields.js";

@Injectable()
export class LibraryKeyService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly crypto: LibraryCryptoService,
  ) {}

  /**
   * Create a DEK for a new account, or unwrap / migrate an existing one after
   * a successful password check.
   */
  async provisionWithPassword(
    user: {
      id: string;
      dataEncryptionVersion: number;
      dekKdfSalt: string | null;
      dekPasswordWrapped: string | null;
    },
    password: string,
  ): Promise<{ dek: Buffer; recoveryKey?: string }> {
    if (
      user.dataEncryptionVersion >= DATA_ENCRYPTION_VERSION &&
      user.dekKdfSalt &&
      user.dekPasswordWrapped
    ) {
      const dek = await unwrapDekWithPassword(user.dekPasswordWrapped, password, user.dekKdfSalt);
      return { dek };
    }

    const dek = this.crypto.generateDek();
    const recoveryKey = this.crypto.generateRecoveryKey();
    const salt = this.crypto.generateKdfSalt();
    await this.prisma.user.update({
      where: { id: user.id },
      data: {
        dekKdfSalt: salt,
        dekPasswordWrapped: await wrapDekWithPassword(dek, password, salt),
        dekRecoveryWrapped: await wrapDekWithRecoveryKey(dek, recoveryKey),
        dataEncryptionVersion: DATA_ENCRYPTION_VERSION,
      },
    });
    await this.migrateLibrary(user.id, dek);
    return { dek, recoveryKey };
  }

  async createKeyMaterial(password: string): Promise<{
    dek: Buffer;
    recoveryKey: string;
    dekKdfSalt: string;
    dekPasswordWrapped: string;
    dekRecoveryWrapped: string;
    dataEncryptionVersion: number;
  }> {
    const dek = this.crypto.generateDek();
    const recoveryKey = this.crypto.generateRecoveryKey();
    const dekKdfSalt = this.crypto.generateKdfSalt();
    return {
      dek,
      recoveryKey,
      dekKdfSalt,
      dekPasswordWrapped: await wrapDekWithPassword(dek, password, dekKdfSalt),
      dekRecoveryWrapped: await wrapDekWithRecoveryKey(dek, recoveryKey),
      dataEncryptionVersion: DATA_ENCRYPTION_VERSION,
    };
  }

  async rewrapPassword(userId: string, dek: Buffer, newPassword: string): Promise<void> {
    const salt = this.crypto.generateKdfSalt();
    await this.prisma.user.update({
      where: { id: userId },
      data: {
        dekKdfSalt: salt,
        dekPasswordWrapped: await wrapDekWithPassword(dek, newPassword, salt),
        dataEncryptionVersion: DATA_ENCRYPTION_VERSION,
      },
    });
  }

  async rotateRecoveryKey(userId: string, dek: Buffer): Promise<string> {
    const recoveryKey = this.crypto.generateRecoveryKey();
    await this.prisma.user.update({
      where: { id: userId },
      data: { dekRecoveryWrapped: await wrapDekWithRecoveryKey(dek, recoveryKey) },
    });
    return recoveryKey;
  }

  async migrateLibrary(userId: string, dek: Buffer): Promise<void> {
    await this.crypto.runAsync(dek, async () => {
      const folders = await this.prisma.folder.findMany({ where: { userId } });
      for (const folder of folders) {
        if (isLibraryCiphertext(folder.name)) continue;
        await this.prisma.folder.update({
          where: { id: folder.id },
          data: { name: sealFolderName(dek, userId, folder.id, folder.name) },
        });
      }

      const tags = await this.prisma.tag.findMany({ where: { userId } });
      for (const tag of tags) {
        if (isLibraryCiphertext(tag.name)) continue;
        await this.prisma.tag.update({
          where: { id: tag.id },
          data: sealTag(dek, userId, tag.id, { name: tag.name, normalizedName: tagNameKey(tag.name) }),
        });
      }

      const bookmarks = await this.prisma.bookmark.findMany({ where: { userId } });
      for (const bookmark of bookmarks) {
        if (isLibraryCiphertext(bookmark.url) && isLibraryCiphertext(bookmark.title)) continue;
        await this.prisma.bookmark.update({
          where: { id: bookmark.id },
          data: sealBookmark(dek, userId, bookmark.id, {
            url: bookmark.url,
            title: bookmark.title,
            description: bookmark.description,
            domain: bookmark.domain,
            contentHtml: bookmark.contentHtml,
            author: bookmark.author,
            articleUndoSnapshot: bookmark.articleUndoSnapshot,
          }),
        });
      }

      const highlights = await this.prisma.bookmarkHighlight.findMany({
        where: { bookmark: { userId } },
      });
      for (const highlight of highlights) {
        if (isLibraryCiphertext(highlight.exact)) continue;
        await this.prisma.bookmarkHighlight.update({
          where: { id: highlight.id },
          data: sealHighlight(dek, userId, highlight.id, {
            exact: highlight.exact,
            prefix: highlight.prefix,
            suffix: highlight.suffix,
            href: highlight.href,
          }),
        });
      }

      const jobs = await this.prisma.importJob.findMany({ where: { userId } });
      for (const job of jobs) {
        await this.prisma.importJob.update({
          where: { id: job.id },
          data: sealImportJob(dek, userId, job.id, {
            entries: job.entries,
            preview: job.preview,
            result: job.result,
            failure: job.failure,
          }),
        });
      }
    });
  }
}
