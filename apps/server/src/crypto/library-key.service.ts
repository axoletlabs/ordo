import { Inject, Injectable, Logger } from "@nestjs/common";
import { ErrorCode, tagNameKey } from "@ordo/shared";
import { Prisma } from "../prisma/client.js";
import { AppError } from "../common/errors/app-error.js";
import { PrismaService } from "../prisma/prisma.service.js";
import { APP_CONFIG, type AppConfig } from "../config/config.module.js";
import {
  DATA_ENCRYPTION_VERSION,
  LIBRARY_CIPHER_PREFIX,
  LIBRARY_STATE,
  unwrapDekWithPassword,
  unwrapDekWithServerKek,
  wrapDekWithPassword,
  wrapDekWithServerKek,
  type LibraryState,
} from "./library-crypto.js";
import { LibraryCryptoService } from "./library-crypto.service.js";
import { sealBookmark, sealFolderName, sealHighlight, sealImportJob, sealTag } from "./library-fields.js";

/** Rows rewritten per transaction while sealing a legacy library. */
const MIGRATION_BATCH_SIZE = 50;
/** Passes over the library before giving up and leaving `migrating` in place. */
const MIGRATION_MAX_PASSES = 3;
/** Attempts to win the plaintext -> migrating key claim against a concurrent login. */
const CLAIM_ATTEMPTS = 4;

const BOOKMARK_SEALED_FIELDS = [
  "url",
  "title",
  "description",
  "domain",
  "contentHtml",
  "author",
  "articleUndoSnapshot",
] as const;
const HIGHLIGHT_SEALED_FIELDS = ["exact", "prefix", "suffix", "href"] as const;
const IMPORT_SEALED_FIELDS = ["entries", "preview", "result", "failure"] as const;

export interface LibraryKeyUser {
  id: string;
  /** Snapshot the caller verified; the key write is refused if it changed. */
  passwordHash: string;
  dataEncryptionVersion: number;
  libraryState?: string | null;
  dekKdfSalt: string | null;
  dekPasswordWrapped: string | null;
  dekServerWrapped: string | null;
}

@Injectable()
export class LibraryKeyService {
  private readonly logger = new Logger(LibraryKeyService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly crypto: LibraryCryptoService,
    @Inject(APP_CONFIG) private readonly cfg: AppConfig,
  ) {}

  /**
   * Create a DEK for a new account, or unwrap / finish migrating an existing
   * one after a successful password check.
   *
   * The flow is a small state machine over `User.libraryState`:
   *
   *   plaintext --claim (key material + state, one guarded write)--> migrating
   *   migrating --idempotent row rewrite + completion write--> encrypted
   *   encrypted --unwrap--> (no row work)
   *
   * The claim is a single conditional write guarded on the verified
   * `passwordHash`, so two concurrent legacy logins can never install two
   * different DEKs (the loser adopts the winner's key instead of overwriting
   * it), and a login cannot install a wrap for a password that a concurrent
   * reset/change already replaced.
   */
  async provisionWithPassword(
    user: LibraryKeyUser,
    password: string,
  ): Promise<{ dek: Buffer }> {
    if (this.stateOf(user) === LIBRARY_STATE.ENCRYPTED) return this.provision(user, password);
    return this.crypto.withLegacyTransition(user.id, () => this.provision(user, password));
  }

  private async provision(user: LibraryKeyUser, password: string): Promise<{ dek: Buffer }> {
    switch (this.stateOf(user)) {
      case LIBRARY_STATE.ENCRYPTED: {
        const dek = await this.unwrapForLogin(user, password);
        await this.ensureServerWrap(user.id, dek);
        return { dek };
      }
      case LIBRARY_STATE.MIGRATING: {
        const dek = await this.unwrapForLogin(user, password);
        await this.ensureServerWrap(user.id, dek);
        await this.finishMigration(user.id, dek);
        return { dek };
      }
      default:
        return this.claimAndMigrate(user, password);
    }
  }

  async createKeyMaterial(password: string): Promise<{
    dek: Buffer;
    dekKdfSalt: string;
    dekPasswordWrapped: string;
    dekServerWrapped: string;
    dataEncryptionVersion: number;
    libraryState: LibraryState;
  }> {
    const dek = this.crypto.generateDek();
    const dekKdfSalt = this.crypto.generateKdfSalt();
    return {
      dek,
      dekKdfSalt,
      dekPasswordWrapped: await wrapDekWithPassword(dek, password, dekKdfSalt),
      dekServerWrapped: wrapDekWithServerKek(dek, this.kek()),
      dataEncryptionVersion: DATA_ENCRYPTION_VERSION,
      // A brand-new account has nothing to rewrite.
      libraryState: LIBRARY_STATE.ENCRYPTED,
    };
  }

  /**
   * Compute the password-wrapped DEK fields for a new password. Returned as a
   * value so callers persist them together with `passwordHash` in a single
   * write — a password change must never land without its re-wrap (that would
   * leave the encrypted library readable only with the old password).
   */
  async wrapPasswordMaterial(dek: Buffer, newPassword: string): Promise<{
    dekKdfSalt: string;
    dekPasswordWrapped: string;
    dekServerWrapped: string;
    dataEncryptionVersion: number;
  }> {
    const salt = this.crypto.generateKdfSalt();
    return {
      dekKdfSalt: salt,
      dekPasswordWrapped: await wrapDekWithPassword(dek, newPassword, salt),
      dekServerWrapped: wrapDekWithServerKek(dek, this.kek()),
      dataEncryptionVersion: DATA_ENCRYPTION_VERSION,
    };
  }

  async unwrapWithServerKek(wrapped: string): Promise<Buffer> {
    return unwrapDekWithServerKek(wrapped, this.kek());
  }

  /**
   * Fill in the server key wrap without ever replacing one: the wrap is
   * derived from the same DEK, so the first writer wins and later writers are
   * no-ops instead of clobbering a concurrently rotated value.
   */
  async ensureServerWrap(userId: string, dek: Buffer): Promise<void> {
    await this.prisma.user.updateMany({
      where: { id: userId, dekServerWrapped: null },
      data: { dekServerWrapped: wrapDekWithServerKek(dek, this.kek()) },
    });
  }

  /**
   * DEK for a session that predates encryption (its token has no wrapped key).
   * The server wrap is enough to read/write the library, so an old session on
   * an already-encrypted account stops writing plaintext into it.
   */
  async resolveServerDek(userId: string): Promise<Buffer | null> {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { dataEncryptionVersion: true, dekServerWrapped: true },
    });
    if (!user || user.dataEncryptionVersion < DATA_ENCRYPTION_VERSION) {
      return null;
    }
    if (!user.dekServerWrapped) throw this.incompleteKeys();
    try {
      return unwrapDekWithServerKek(user.dekServerWrapped, this.kek());
    } catch {
      throw this.incompleteKeys();
    }
  }

  /** Legacy requests/jobs finish before a key claim, or adopt its durable key.
   * Holding this lease for null-key work closes the first-migration window;
   * encrypted requests need no lease and keep their normal concurrency. */
  runWithCurrentKey<T>(userId: string, dek: Buffer | null, work: () => Promise<T>): Promise<T> {
    if (dek) return this.crypto.runAsync(dek, work);
    return this.crypto.withLegacyTransition(userId, async () =>
      this.crypto.runAsync(await this.resolveServerDek(userId), work));
  }

  /** Seal every plaintext field with an idempotent, batched rewrite. */
  async migrateLibrary(userId: string, dek: Buffer): Promise<void> {
    await this.crypto.runAsync(dek, async () => {
      for (let pass = 0; pass < MIGRATION_MAX_PASSES; pass += 1) {
        const sealed = await this.migratePass(userId, dek);
        if (sealed === 0) return;
        this.logger.log(`Sealed ${sealed} legacy library rows for ${userId} (pass ${pass + 1})`);
      }
      this.logger.warn(
        `Library for ${userId} still has plaintext rows after ${MIGRATION_MAX_PASSES} passes; leaving it in ${LIBRARY_STATE.MIGRATING} so the next sign-in retries.`,
      );
    });
  }

  private stateOf(
    user: Pick<
      LibraryKeyUser,
      "dataEncryptionVersion" | "libraryState" | "dekKdfSalt" | "dekPasswordWrapped"
    >,
  ): LibraryState {
    const hasKeyMaterial = !!user.dekKdfSalt && !!user.dekPasswordWrapped;
    if (!hasKeyMaterial) return LIBRARY_STATE.PLAINTEXT;
    if (user.libraryState === LIBRARY_STATE.ENCRYPTED) return LIBRARY_STATE.ENCRYPTED;
    // A version bump without a completion marker means the rewrite may be
    // unfinished; this is also how rows written by older builds look.
    return LIBRARY_STATE.MIGRATING;
  }

  private async claimAndMigrate(
    user: LibraryKeyUser,
    password: string,
  ): Promise<{ dek: Buffer }> {
    if (
      user.dataEncryptionVersion >= DATA_ENCRYPTION_VERSION ||
      user.libraryState === LIBRARY_STATE.MIGRATING
    ) {
      // Version/state say encrypted but no usable password wrap survived; a
      // fresh DEK here would orphan every existing ciphertext field.
      throw this.incompleteKeys();
    }
    const dek = this.crypto.generateDek();
    const salt = this.crypto.generateKdfSalt();
    const passwordWrapped = await wrapDekWithPassword(dek, password, salt);
    const serverWrapped = wrapDekWithServerKek(dek, this.kek());

    for (let attempt = 0; attempt < CLAIM_ATTEMPTS; attempt += 1) {
      const claim = await this.prisma.user.updateMany({
        where: {
          id: user.id,
          passwordHash: user.passwordHash,
          dataEncryptionVersion: 0,
          libraryState: { in: [LIBRARY_STATE.PLAINTEXT, LIBRARY_STATE.MIGRATING] },
          dekKdfSalt: null,
          dekPasswordWrapped: null,
        },
        data: {
          dekKdfSalt: salt,
          dekPasswordWrapped: passwordWrapped,
          dekServerWrapped: serverWrapped,
          dataEncryptionVersion: DATA_ENCRYPTION_VERSION,
          // Key material and the "incomplete rewrite" marker land together, so
          // a crash can never hide plaintext rows behind a completed account.
          libraryState: LIBRARY_STATE.MIGRATING,
        },
      });
      if (claim.count === 1) {
        await this.finishMigration(user.id, dek);
        return { dek };
      }

      const fresh = await this.prisma.user.findUnique({ where: { id: user.id } });
      if (!fresh) throw new AppError(ErrorCode.UNAUTHORIZED, "Account not found.");
      if (fresh.passwordHash !== user.passwordHash) throw this.stalePassword();

      if (this.stateOf(fresh) === LIBRARY_STATE.PLAINTEXT) {
        if (
          fresh.dataEncryptionVersion >= DATA_ENCRYPTION_VERSION ||
          fresh.libraryState === LIBRARY_STATE.MIGRATING
        ) {
          throw this.incompleteKeys();
        }
        // The winning claim rolled back before committing. Retry the guarded
        // claim rather than minting a DEK the winner might contradict.
        await new Promise((resolve) => setTimeout(resolve, 5 + attempt * 10));
        continue;
      }

      // Another sign-in installed the key first: adopt it instead of minting a
      // second DEK that would orphan whichever ciphertext already exists.
      const state = this.stateOf(fresh);
      const dek2 = await this.unwrapForLogin(fresh, password);
      await this.ensureServerWrap(fresh.id, dek2);
      if (state === LIBRARY_STATE.MIGRATING) await this.finishMigration(fresh.id, dek2);
      return { dek: dek2 };
    }

    throw new AppError(
      ErrorCode.CONFLICT,
      "Another sign-in is preparing this library. Please try again.",
    );
  }

  /** Complete (or verify) the rewrite, then mark the account encrypted. */
  private async finishMigration(userId: string, dek: Buffer): Promise<void> {
    // Accounts backfilled into `migrating` are usually fully encrypted already;
    // a cheap count avoids reading every row just to prove that.
    if ((await this.countUnsealed(userId)) > 0) {
      await this.migrateLibrary(userId, dek);
    }
    // Completion is a conditional write: a concurrent pass may have won, and
    // a plaintext row left behind by an interrupted pass keeps `migrating`
    // (the next sign-in retries) rather than being hidden as encrypted.
    await this.prisma.$transaction(async tx => {
      if (await this.countUnsealed(userId, tx) > 0) return;
      await tx.user.updateMany({
        where: { id: userId, libraryState: LIBRARY_STATE.MIGRATING },
        data: { libraryState: LIBRARY_STATE.ENCRYPTED },
      });
    });
  }

  private async unwrapPasswordWrap(
    user: Pick<LibraryKeyUser, "dekKdfSalt" | "dekPasswordWrapped">,
    password: string,
  ): Promise<Buffer> {
    if (!user.dekKdfSalt || !user.dekPasswordWrapped) {
      throw this.incompleteKeys();
    }
    try {
      return await unwrapDekWithPassword(user.dekPasswordWrapped, password, user.dekKdfSalt);
    } catch {
      throw new AppError(
        ErrorCode.INTERNAL_ERROR,
        "This account's library could not be unlocked with the current password.",
      );
    }
  }

  /**
   * Unwrap with the password the caller verified. If that fails, the most
   * likely cause is a password write that landed between the bcrypt check and
   * here; report it as a stale credential rather than as a broken key.
   */
  private async unwrapForLogin(user: LibraryKeyUser, password: string): Promise<Buffer> {
    try {
      return await this.unwrapPasswordWrap(user, password);
    } catch (err) {
      const fresh = await this.prisma.user.findUnique({
        where: { id: user.id },
        select: { passwordHash: true },
      });
      if (fresh && fresh.passwordHash !== user.passwordHash) throw this.stalePassword();
      throw err;
    }
  }

  private incompleteKeys(): AppError {
    return new AppError(
      ErrorCode.INTERNAL_ERROR,
      "This account's library keys are incomplete. Ask the server owner to restore the key wrap.",
    );
  }

  private stalePassword(): AppError {
    return new AppError(ErrorCode.INVALID_CREDENTIALS, "Incorrect email or password.");
  }

  /** One page-by-page pass; returns how many rows still needed sealing. */
  private async migratePass(userId: string, dek: Buffer): Promise<number> {
    return (
      (await this.sealFolders(userId, dek)) +
      (await this.sealTags(userId, dek)) +
      (await this.sealBookmarks(userId, dek)) +
      (await this.sealHighlights(userId, dek)) +
      (await this.sealImportJobs(userId, dek))
    );
  }

  private async countUnsealed(userId: string, client: Prisma.TransactionClient = this.prisma): Promise<number> {
    const [folders, tags, bookmarks, highlights, jobs] = await Promise.all([
      client.folder.count({
        where: this.unsealedFields<Prisma.FolderWhereInput>(userId, "name"),
      }),
      client.tag.count({
        where: this.unsealedFields<Prisma.TagWhereInput>(userId, "name"),
      }),
      client.bookmark.count({
        where: this.unsealedFields<Prisma.BookmarkWhereInput>(userId, ...BOOKMARK_SEALED_FIELDS),
      }),
      client.bookmarkHighlight.count({
        where: this.unsealedWhere<Prisma.BookmarkHighlightWhereInput>(
          { bookmark: { userId } },
          ...HIGHLIGHT_SEALED_FIELDS,
        ),
      }),
      client.importJob.count({
        where: this.unsealedFields<Prisma.ImportJobWhereInput>(userId, ...IMPORT_SEALED_FIELDS),
      }),
    ]);
    return folders + tags + bookmarks + highlights + jobs;
  }

  /**
   * `OR` of "this column does not hold ciphertext yet". SQL `NOT LIKE` is
   * false for NULL, so nullable columns simply don't match.
   */
  private unsealedWhere<T>(base: Record<string, unknown>, ...fields: readonly string[]): T {
    return {
      ...base,
      OR: fields.map((field) => ({
        [field]: { not: { startsWith: LIBRARY_CIPHER_PREFIX } },
      })),
    } as T;
  }

  private unsealedFields<T>(userId: string, ...fields: readonly string[]): T {
    return this.unsealedWhere<T>({ userId }, ...fields);
  }

  /** Read and rewrite each page under the same write transaction. A rename,
   * extraction or job completion cannot be replaced by a stale migration row. */
  private async rewritePages<T extends { id: string }>(
    read: (tx: Prisma.TransactionClient, cursor: string | null) => Promise<T[]>,
    write: (tx: Prisma.TransactionClient, row: T) => Promise<unknown>,
  ): Promise<number> {
    let total = 0;
    let cursor: string | null = null;
    for (;;) {
      const rows = await this.prisma.$transaction(async (tx) => {
        const page = await read(tx, cursor);
        for (const row of page) await write(tx, row);
        return page;
      }, { timeout: 60_000 });
      total += rows.length;
      if (rows.length < MIGRATION_BATCH_SIZE) return total;
      cursor = rows[rows.length - 1]!.id;
    }
  }

  private sealFolders(userId: string, dek: Buffer): Promise<number> {
    return this.rewritePages(
      (tx, cursor) => tx.folder.findMany({
        where: { ...this.unsealedFields<Prisma.FolderWhereInput>(userId, "name"), ...(cursor ? { id: { gt: cursor } } : {}) },
        orderBy: { id: "asc" }, take: MIGRATION_BATCH_SIZE,
      }),
      (tx, row) => tx.folder.update({ where: { id: row.id }, data: { name: sealFolderName(dek, userId, row.id, row.name) } }),
    );
  }

  private sealTags(userId: string, dek: Buffer): Promise<number> {
    return this.rewritePages(
      (tx, cursor) => tx.tag.findMany({
        where: { ...this.unsealedFields<Prisma.TagWhereInput>(userId, "name"), ...(cursor ? { id: { gt: cursor } } : {}) },
        orderBy: { id: "asc" }, take: MIGRATION_BATCH_SIZE,
      }),
      (tx, row) => tx.tag.update({ where: { id: row.id }, data: sealTag(dek, userId, row.id, { name: row.name, normalizedName: tagNameKey(row.name) }) }),
    );
  }

  private sealBookmarks(userId: string, dek: Buffer): Promise<number> {
    return this.rewritePages(
      (tx, cursor) => tx.bookmark.findMany({
        where: { ...this.unsealedFields<Prisma.BookmarkWhereInput>(userId, ...BOOKMARK_SEALED_FIELDS), ...(cursor ? { id: { gt: cursor } } : {}) },
        orderBy: { id: "asc" }, take: MIGRATION_BATCH_SIZE,
      }),
      (tx, row) => tx.bookmark.update({ where: { id: row.id }, data: sealBookmark(dek, userId, row.id, {
        url: row.url, title: row.title, description: row.description, domain: row.domain,
        contentHtml: row.contentHtml, author: row.author, articleUndoSnapshot: row.articleUndoSnapshot,
      }) }),
    );
  }

  private sealHighlights(userId: string, dek: Buffer): Promise<number> {
    return this.rewritePages(
      (tx, cursor) => tx.bookmarkHighlight.findMany({
        where: { ...this.unsealedWhere<Prisma.BookmarkHighlightWhereInput>({ bookmark: { userId } }, ...HIGHLIGHT_SEALED_FIELDS), ...(cursor ? { id: { gt: cursor } } : {}) },
        orderBy: { id: "asc" }, take: MIGRATION_BATCH_SIZE,
      }),
      (tx, row) => tx.bookmarkHighlight.update({ where: { id: row.id }, data: sealHighlight(dek, userId, row.id, {
        exact: row.exact, prefix: row.prefix, suffix: row.suffix, href: row.href,
      }) }),
    );
  }

  private sealImportJobs(userId: string, dek: Buffer): Promise<number> {
    return this.rewritePages(
      (tx, cursor) => tx.importJob.findMany({
        where: { ...this.unsealedFields<Prisma.ImportJobWhereInput>(userId, ...IMPORT_SEALED_FIELDS), ...(cursor ? { id: { gt: cursor } } : {}) },
        orderBy: { id: "asc" }, take: MIGRATION_BATCH_SIZE,
      }),
      (tx, row) => tx.importJob.update({ where: { id: row.id }, data: sealImportJob(dek, userId, row.id, {
        entries: row.entries, preview: row.preview, result: row.result, failure: row.failure,
      }) }),
    );
  }

  private kek(): Buffer {
    return Buffer.from(this.cfg.libraryKek, "hex");
  }
}
