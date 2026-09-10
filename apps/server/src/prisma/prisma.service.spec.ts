import { execSync } from "node:child_process";
import { existsSync, unlinkSync } from "node:fs";
import { join } from "node:path";
import { PrismaClient } from "@prisma/client";
import { PrismaService } from "./prisma.service.js";

/**
 * The schema as it was before unfiled bookmarks: Folder.isDefault existed and
 * Bookmark.folderId was NOT NULL. Mirrors the DDL `prisma db push` generated
 * for that schema.
 */
const LEGACY_DDL = [
  `CREATE TABLE "User" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "username" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "emailVerifiedAt" DATETIME,
    "pendingEmail" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "User_username_key" UNIQUE ("username"),
    CONSTRAINT "User_email_key" UNIQUE ("email")
  )`,
  `CREATE TABLE "Folder" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "icon" TEXT NOT NULL DEFAULT 'folder-outline',
    "pinned" BOOLEAN NOT NULL DEFAULT false,
    "passwordHash" TEXT,
    "position" INTEGER NOT NULL DEFAULT 0,
    "isDefault" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "Folder_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
  )`,
  `CREATE INDEX "Folder_userId_idx" ON "Folder"("userId")`,
  `CREATE TABLE "Bookmark" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "folderId" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "domain" TEXT NOT NULL,
    "contentHtml" TEXT,
    "contentMarkdown" TEXT,
    "contentText" TEXT,
    "fetchStatus" TEXT NOT NULL DEFAULT 'ok',
    "isRead" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "Bookmark_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "Bookmark_folderId_fkey" FOREIGN KEY ("folderId") REFERENCES "Folder" ("id") ON DELETE CASCADE ON UPDATE CASCADE
  )`,
  `CREATE INDEX "Bookmark_userId_idx" ON "Bookmark"("userId")`,
  `CREATE INDEX "Bookmark_folderId_idx" ON "Bookmark"("folderId")`,
  `CREATE INDEX "Bookmark_createdAt_idx" ON "Bookmark"("createdAt")`,
  `CREATE TABLE "FolderToken" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "folderId" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "expiresAt" DATETIME NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "FolderToken_tokenHash_key" UNIQUE ("tokenHash"),
    CONSTRAINT "FolderToken_folderId_fkey" FOREIGN KEY ("folderId") REFERENCES "Folder" ("id") ON DELETE CASCADE ON UPDATE CASCADE
  )`,
  `CREATE INDEX "FolderToken_folderId_idx" ON "FolderToken"("folderId")`,
  `CREATE TABLE "EmailVerificationToken" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "token" TEXT NOT NULL,
    "expiresAt" DATETIME NOT NULL,
    "consumedAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "EmailVerificationToken_token_key" UNIQUE ("token"),
    CONSTRAINT "EmailVerificationToken_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
  )`,
];

function tempDbPath(): string {
  const path = `/tmp/ordo-migration-${process.pid}-${Date.now()}-${Math.random()
    .toString(36)
    .slice(2)}.db`;
  if (existsSync(path)) unlinkSync(path);
  return path;
}

/** Build a legacy database with the pre-unfiled schema and seed data.
 *  Raw SQL throughout: the generated client no longer knows `isDefault`. */
async function createLegacyDb(path: string): Promise<void> {
  const db = new PrismaClient({ datasources: { db: { url: `file:${path}` } } });
  for (const statement of [...LEGACY_DDL, ...LEGACY_SEED]) {
    await db.$executeRawUnsafe(statement);
  }
  await db.$disconnect();
}

const LEGACY_SEED = [
  `INSERT INTO "User" ("id","username","email","passwordHash","createdAt","updatedAt")
   VALUES ('u1','one','one@ordo.app','x',CURRENT_TIMESTAMP,CURRENT_TIMESTAMP)`,
  `INSERT INTO "User" ("id","username","email","passwordHash","createdAt","updatedAt")
   VALUES ('u2','two','two@ordo.app','x',CURRENT_TIMESTAMP,CURRENT_TIMESTAMP)`,
  // every user had an "All Bookmarks" default folder plus real folders
  `INSERT INTO "Folder" ("id","userId","name","isDefault","position","createdAt","updatedAt")
   VALUES ('d1','u1','All Bookmarks',1,0,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP)`,
  `INSERT INTO "Folder" ("id","userId","name","isDefault","position","createdAt","updatedAt")
   VALUES ('f1','u1','Dev',0,1,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP)`,
  `INSERT INTO "Folder" ("id","userId","name","isDefault","position","createdAt","updatedAt")
   VALUES ('d2','u2','All Bookmarks',1,0,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP)`,
  `INSERT INTO "FolderToken" ("id","folderId","tokenHash","expiresAt","createdAt")
   VALUES ('t1','d1','legacy-token',datetime('now','+1 minute'),CURRENT_TIMESTAMP)`,
  `INSERT INTO "Bookmark" ("id","userId","folderId","url","title","domain","createdAt","updatedAt")
   VALUES ('b-default','u1','d1','https://example.com/a','A','example.com',CURRENT_TIMESTAMP,CURRENT_TIMESTAMP)`,
  `INSERT INTO "Bookmark" ("id","userId","folderId","url","title","domain","createdAt","updatedAt")
   VALUES ('b-kept','u1','f1','https://example.com/b','B','example.com',CURRENT_TIMESTAMP,CURRENT_TIMESTAMP)`,
  `INSERT INTO "Bookmark" ("id","userId","folderId","url","title","domain","createdAt","updatedAt")
   VALUES ('b-other-user','u2','d2','https://example.com/c','C','example.com',CURRENT_TIMESTAMP,CURRENT_TIMESTAMP)`,
  `INSERT INTO "EmailVerificationToken" ("id","userId","token","expiresAt","createdAt")
   VALUES ('otp1','u1','legacy-otp',datetime('now','+10 minutes'),CURRENT_TIMESTAMP)`,
];

function boot(path: string): Promise<PrismaService> {
  const service = new PrismaService({ databaseUrl: `file:${path}` });
  return service.onModuleInit().then(() => service);
}

/**
 * The schema as it was between the unfiled-bookmarks rework and the reader
 * rework: nullable Bookmark.folderId, no Folder.isDefault, none of the
 * extraction/progress columns, no User.preferences.
 */
const PRE_READER_DDL = [
  `CREATE TABLE "User" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "username" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "emailVerifiedAt" DATETIME,
    "pendingEmail" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "User_username_key" UNIQUE ("username"),
    CONSTRAINT "User_email_key" UNIQUE ("email")
  )`,
  `CREATE TABLE "Folder" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "icon" TEXT NOT NULL DEFAULT 'folder-outline',
    "pinned" BOOLEAN NOT NULL DEFAULT false,
    "passwordHash" TEXT,
    "position" INTEGER NOT NULL DEFAULT 0,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "Folder_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
  )`,
  `CREATE INDEX "Folder_userId_idx" ON "Folder"("userId")`,
  `CREATE TABLE "Bookmark" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "folderId" TEXT,
    "url" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "domain" TEXT NOT NULL,
    "contentHtml" TEXT,
    "contentMarkdown" TEXT,
    "contentText" TEXT,
    "fetchStatus" TEXT NOT NULL DEFAULT 'ok',
    "isRead" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "Bookmark_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "Bookmark_folderId_fkey" FOREIGN KEY ("folderId") REFERENCES "Folder" ("id") ON DELETE CASCADE ON UPDATE CASCADE
  )`,
  `CREATE INDEX "Bookmark_userId_idx" ON "Bookmark"("userId")`,
  `CREATE INDEX "Bookmark_folderId_idx" ON "Bookmark"("folderId")`,
  `CREATE INDEX "Bookmark_createdAt_idx" ON "Bookmark"("createdAt")`,
  `INSERT INTO "User" ("id","username","email","passwordHash","createdAt","updatedAt")
   VALUES ('u1','one','one@ordo.app','x',CURRENT_TIMESTAMP,CURRENT_TIMESTAMP)`,
  `INSERT INTO "Bookmark" ("id","userId","folderId","url","title","domain","createdAt","updatedAt")
   VALUES ('b1','u1',NULL,'https://example.com/a','A','example.com',CURRENT_TIMESTAMP,CURRENT_TIMESTAMP)`,
];

describe("PrismaService legacy schema migration", () => {
  afterEach(() => {
    for (const file of execSync(`ls /tmp/ordo-migration-${process.pid}-* 2>/dev/null || true`)
      .toString()
      .split("\n")
      .filter(Boolean)) {
      unlinkSync(file);
    }
  });

  it("moves default-folder bookmarks to unfiled and drops the default folders", async () => {
    const path = tempDbPath();
    await createLegacyDb(path);
    const service = await boot(path);

    // bookmarks from default folders survive as unfiled; filed ones stay put
    const unfiled = await service.bookmark.findMany({ where: { folderId: null } });
    expect(unfiled.map((b) => b.id).sort()).toEqual(["b-default", "b-other-user"]);
    const kept = await service.bookmark.findUniqueOrThrow({ where: { id: "b-kept" } });
    expect(kept.folderId).toBe("f1");
    expect(await service.bookmark.count()).toBe(3); // nothing lost

    // default folders (and their tokens) are gone; real folders remain
    expect(await service.folder.count()).toBe(1);
    expect((await service.folder.findMany())[0].name).toBe("Dev");
    expect(await service.folderToken.count()).toBe(0);

    // folderId is nullable and the retired migration marker remains available
    const bookmarkCols = (await service.$queryRawUnsafe(
      `PRAGMA table_info("Bookmark")`,
    )) as Array<{ name: string; notnull: number | bigint }>;
    expect(Number(bookmarkCols.find((c) => c.name === "folderId")?.notnull)).toBe(0);
    const folderCols = (await service.$queryRawUnsafe(
      `PRAGMA table_info("Folder")`,
    )) as Array<{ name: string }>;
    expect(folderCols.some((c) => c.name === "isDefault")).toBe(true);

    // reader-rework columns were added additively, with their defaults applied
    for (const column of [
      "extractionReason",
      "extractionVersion",
      "author",
      "publishedAt",
      "readingTimeMinutes",
      "readProgress",
      "completedAt",
      "contentKindOverride",
      "articleUndoSnapshot",
    ]) {
      expect(bookmarkCols.some((c) => c.name === column)).toBe(true);
    }
    const progress = (await service.$queryRawUnsafe(
      `SELECT "readProgress" FROM "Bookmark" WHERE "id" = 'b-kept'`,
    )) as Array<{ readProgress: number | bigint }>;
    expect(Number(progress[0]?.readProgress)).toBe(0);
    const userCols = (await service.$queryRawUnsafe(
      `PRAGMA table_info("User")`,
    )) as Array<{ name: string }>;
    expect(userCols.some((c) => c.name === "preferences")).toBe(true);
    expect(userCols.some((c) => c.name === "displayName")).toBe(true);
    expect(userCols.some((c) => c.name === "username")).toBe(false);
    expect(userCols.some((c) => c.name === "totpSecretEnc")).toBe(true);
    const migratedUser = await service.user.findUniqueOrThrow({ where: { id: "u1" } });
    expect(migratedUser.displayName).toBe("one");
    expect(await service.emailVerificationToken.count()).toBe(1);

    const tagTables = (await service.$queryRawUnsafe(
      `SELECT name FROM sqlite_master WHERE type = 'table' AND name IN ('Tag', 'BookmarkTag', 'BookmarkTagSuggestion')`,
    )) as Array<{ name: string }>;
    expect(tagTables.map((table) => table.name).sort()).toEqual([
      "BookmarkTag",
      "BookmarkTagSuggestion",
      "Tag",
    ]);
    const instanceTables = (await service.$queryRawUnsafe(
      `SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'InstanceSettings'`,
    )) as Array<{ name: string }>;
    expect(instanceTables).toHaveLength(1);

    // indexes and foreign keys survive the rebuild
    const indexes = (await service.$queryRawUnsafe(
      `SELECT name FROM sqlite_master WHERE type = 'index' AND tbl_name = 'Bookmark'`,
    )) as Array<{ name: string }>;
    expect(indexes.map((i) => i.name).sort()).toEqual([
      "Bookmark_createdAt_idx",
      "Bookmark_folderId_idx",
      "Bookmark_userId_fetchStatus_idx",
      "Bookmark_userId_idx",
      "sqlite_autoindex_Bookmark_1",
    ]);

    await service.onModuleDestroy();
  });

  it("is idempotent — rebooting a migrated database changes nothing", async () => {
    const path = tempDbPath();
    await createLegacyDb(path);
    const first = await boot(path);
    await first.onModuleDestroy();

    const second = await boot(path);
    expect(await second.bookmark.count({ where: { folderId: null } })).toBe(2);
    expect(await second.bookmark.count()).toBe(3);
    expect(await second.folder.count()).toBe(1);
    expect(await second.tag.count()).toBe(0);
    await second.onModuleDestroy();
  });

  it("adds the reader-rework columns to a post-unfiled, pre-reader database", async () => {
    const path = tempDbPath();
    const db = new PrismaClient({ datasources: { db: { url: `file:${path}` } } });
    for (const statement of PRE_READER_DDL) {
      await db.$executeRawUnsafe(statement);
    }
    await db.$disconnect();

    const service = await boot(path);

    // every missing column was added; existing rows got the declared defaults
    const bookmark = await service.bookmark.findUniqueOrThrow({ where: { id: "b1" } });
    expect(bookmark.readProgress).toBe(0);
    expect(bookmark.extractionReason).toBeNull();
    expect(bookmark.extractionVersion).toBeNull();
    expect(bookmark.completedAt).toBeNull();
    const user = await service.user.findUniqueOrThrow({ where: { id: "u1" } });
    expect(user.preferences).toBeNull();
    expect(user.displayName).toBe("one");

    // the generated client round-trips reads and writes on the new columns
    await service.bookmark.update({
      where: { id: "b1" },
      data: {
        fetchStatus: "unsupported",
        extractionReason: "js_required",
        extractionVersion: 2,
        readProgress: 0.5,
      },
    });
    const updated = await service.bookmark.findUniqueOrThrow({ where: { id: "b1" } });
    expect(updated).toMatchObject({
      fetchStatus: "unsupported",
      extractionReason: "js_required",
      extractionVersion: 2,
      readProgress: 0.5,
    });
    await service.onModuleDestroy();
  });

  it("adds purpose to EmailVerificationToken tables created before password reset", async () => {
    const path = tempDbPath();
    const db = new PrismaClient({ datasources: { db: { url: `file:${path}` } } });
    for (const statement of [
      ...PRE_READER_DDL,
      `CREATE TABLE "EmailVerificationToken" (
        "id" TEXT NOT NULL PRIMARY KEY,
        "userId" TEXT NOT NULL,
        "token" TEXT NOT NULL,
        "expiresAt" DATETIME NOT NULL,
        "consumedAt" DATETIME,
        "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        CONSTRAINT "EmailVerificationToken_token_key" UNIQUE ("token"),
        CONSTRAINT "EmailVerificationToken_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
      )`,
      `CREATE INDEX "EmailVerificationToken_userId_idx" ON "EmailVerificationToken"("userId")`,
      `INSERT INTO "EmailVerificationToken" ("id","userId","token","expiresAt","createdAt")
       VALUES ('t1','u1','old-hash',datetime('now','+10 minutes'),CURRENT_TIMESTAMP)`,
    ]) {
      await db.$executeRawUnsafe(statement);
    }
    await db.$disconnect();

    const service = await boot(path);
    const cols = (await service.$queryRawUnsafe(
      `PRAGMA table_info("EmailVerificationToken")`,
    )) as Array<{ name: string }>;
    expect(cols.some((c) => c.name === "purpose")).toBe(true);
    expect(cols.some((c) => c.name === "attempts")).toBe(true);

    const existing = await service.emailVerificationToken.findUniqueOrThrow({ where: { id: "t1" } });
    expect(existing.purpose).toBe("verify");
    expect(existing.attempts).toBe(0);

    const created = await service.emailVerificationToken.create({
      data: {
        userId: "u1",
        token: "reset-hash",
        purpose: "password_reset",
        expiresAt: new Date(Date.now() + 60_000),
      },
    });
    expect(created.purpose).toBe("password_reset");
    await service.onModuleDestroy();
  });

  it("leaves fresh (current-schema) databases untouched", async () => {
    const path = tempDbPath();
    execSync(`npx prisma db push --skip-generate`, {
      cwd: join(__dirname, "../.."),
      stdio: ["ignore", "ignore", "pipe"],
      env: { ...process.env, DATABASE_URL: `file:${path}` },
    });

    const service = await boot(path);
    await service.user.create({
      data: { id: "u1", displayName: "one", email: "one@ordo.app", passwordHash: "x" },
    });
    // unfiled bookmarks work end-to-end on the current schema
    const created = await service.bookmark.create({
      data: { userId: "u1", folderId: null, url: "https://example.com/x", title: "X", domain: "example.com" },
    });
    expect(created.folderId).toBeNull();
    expect(await service.folder.count()).toBe(0);
    await service.onModuleDestroy();
  }, 60_000);

  it("is a no-op on an empty (not yet pushed) database file", async () => {
    const path = tempDbPath();
    const service = await boot(path);
    // booting must not fabricate any tables on a database with no schema yet
    const tables = (await service.$queryRawUnsafe(
      `SELECT name FROM sqlite_master WHERE type = 'table'`,
    )) as Array<{ name: string }>;
    expect(tables).toHaveLength(0);
    await service.onModuleDestroy();
  });
});
