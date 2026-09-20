import { Prisma } from "./client.js";

export interface SqliteColumn {
  name: string;
  /** SQLite integer columns surface as BigInt through Prisma raw queries. */
  notnull: number | bigint;
}

export interface LegacyRepairClient {
  $queryRaw: <T = unknown>(
    query: TemplateStringsArray | Prisma.Sql,
    ...values: unknown[]
  ) => Promise<T>;
  $queryRawUnsafe: (sql: string, ...values: unknown[]) => Promise<unknown>;
  $executeRawUnsafe: (sql: string, ...values: unknown[]) => Promise<number>;
  $transaction: <T>(
    fn: (tx: LegacyRepairClient) => Promise<T>,
    options?: { timeout?: number; maxWait?: number },
  ) => Promise<T>;
}

/**
 * One-shot repair for databases created before Prisma migrate (db push + boot
 * ALTERs). After `_prisma_migrations` exists, this never runs again.
 */
export async function repairLegacySchema(client: LegacyRepairClient): Promise<void> {
  const tables = new Set(
    (
      await client.$queryRaw<Array<{ name: string }>>(
        Prisma.sql`SELECT name FROM sqlite_master WHERE type = 'table'`,
      )
    ).map((t) => t.name),
  );
  if (!tables.has("Bookmark") || !tables.has("Folder") || !tables.has("User")) return;

  const bookmarkColumns = await client.$queryRaw<SqliteColumn[]>(
    Prisma.sql`PRAGMA table_info("Bookmark")`,
  );
  const folderIdColumn = bookmarkColumns.find((c) => c.name === "folderId");
  if (folderIdColumn && Number(folderIdColumn.notnull) === 1) {
    await rebuildBookmarkTableWithNullableFolderId(client, bookmarkColumns);
  }

  await addMissingColumns(
    client,
    "Bookmark",
    BOOKMARK_ADDITIVE_COLUMNS,
    await client.$queryRaw<SqliteColumn[]>(Prisma.sql`PRAGMA table_info("Bookmark")`),
  );
  await addMissingColumns(
    client,
    "Folder",
    FOLDER_ADDITIVE_COLUMNS,
    await client.$queryRaw<SqliteColumn[]>(Prisma.sql`PRAGMA table_info("Folder")`),
  );

  await migrateUsernameToDisplayName(
    client,
    await client.$queryRaw<SqliteColumn[]>(Prisma.sql`PRAGMA table_info("User")`),
  );

  await addMissingColumns(
    client,
    "User",
    USER_ADDITIVE_COLUMNS,
    await client.$queryRaw<SqliteColumn[]>(Prisma.sql`PRAGMA table_info("User")`),
  );

  if (tables.has("EmailVerificationToken") || (await tableExists(client, "EmailVerificationToken"))) {
    await addMissingColumns(
      client,
      "EmailVerificationToken",
      EMAIL_TOKEN_ADDITIVE_COLUMNS,
      await client.$queryRaw<SqliteColumn[]>(
        Prisma.sql`PRAGMA table_info("EmailVerificationToken")`,
      ),
    );
    await client.$executeRawUnsafe(
      `CREATE INDEX IF NOT EXISTS "EmailVerificationToken_userId_purpose_idx"
       ON "EmailVerificationToken"("userId", "purpose")`,
    );
  }

  await ensureSessionTable(client);
  await ensureMfaTables(client);
  await ensureTagTables(client);
  await ensureImportJobTable(client);
  await ensureInstanceSettings(client);

  const folderColumns = await client.$queryRaw<SqliteColumn[]>(
    Prisma.sql`PRAGMA table_info("Folder")`,
  );
  if (folderColumns.some((c) => c.name === "isDefault")) {
    const [legacyDefaults] = await client.$queryRaw<Array<{ count: number | bigint }>>(
      Prisma.sql`SELECT COUNT(*) AS count FROM "Folder" WHERE "isDefault" = 1`,
    );
    if (legacyDefaults && Number(legacyDefaults.count) > 0) {
      const hasFolderTokens = await tableExists(client, "FolderToken");
      await client.$transaction(
        async (tx) => {
          await tx.$executeRawUnsafe(
            `UPDATE "Bookmark" SET "folderId" = NULL
             WHERE "folderId" IN (SELECT "id" FROM "Folder" WHERE "isDefault" = 1)`,
          );
          if (hasFolderTokens) {
            await tx.$executeRawUnsafe(
              `DELETE FROM "FolderToken"
               WHERE "folderId" IN (SELECT "id" FROM "Folder" WHERE "isDefault" = 1)`,
            );
          }
          await tx.$executeRawUnsafe(`DELETE FROM "Folder" WHERE "isDefault" = 1`);
        },
        { timeout: 120_000, maxWait: 10_000 },
      );
    }
  }
}

async function tableExists(client: LegacyRepairClient, name: string): Promise<boolean> {
  const rows = await client.$queryRaw<Array<{ name: string }>>(
    Prisma.sql`SELECT name FROM sqlite_master WHERE type = 'table' AND name = ${name}`,
  );
  return rows.length > 0;
}

async function migrateUsernameToDisplayName(
  client: LegacyRepairClient,
  columns: SqliteColumn[],
): Promise<void> {
  const names = new Set(columns.map((c) => c.name));
  if (!names.has("username")) return;
  if (names.has("displayName")) {
    await client.$executeRawUnsafe(
      `UPDATE "User" SET "displayName" = "username" WHERE "displayName" IS NULL OR "displayName" = ''`,
    );
  }

  await client.$executeRawUnsafe(`PRAGMA foreign_keys = OFF`);
  try {
    const select = (name: string, fallback = "NULL"): string =>
      names.has(name) ? `"${name}"` : fallback;
    const displayNameExpr = names.has("displayName")
      ? `COALESCE(NULLIF("displayName", ''), "username")`
      : `"username"`;

    await client.$transaction(
      async (tx) => {
        await tx.$executeRawUnsafe(`DROP TABLE IF EXISTS "User_migration"`);
        await tx.$executeRawUnsafe(USER_MIGRATION_DDL);
        await tx.$executeRawUnsafe(
          `INSERT INTO "User_migration" (
            "id", "displayName", "email", "passwordHash", "emailVerifiedAt", "pendingEmail",
            "preferences", "totpSecretEnc", "totpEnabledAt", "avatarMime", "avatarUpdatedAt",
            "avatarBytes", "createdAt", "updatedAt"
          )
          SELECT
            "id", ${displayNameExpr}, "email", "passwordHash",
            ${select("emailVerifiedAt")}, ${select("pendingEmail")},
            ${select("preferences")}, ${select("totpSecretEnc")}, ${select("totpEnabledAt")},
            ${select("avatarMime")}, ${select("avatarUpdatedAt")}, ${select("avatarBytes")},
            "createdAt", "updatedAt"
          FROM "User"`,
        );
        await tx.$executeRawUnsafe(`DROP TABLE "User"`);
        await tx.$executeRawUnsafe(`ALTER TABLE "User_migration" RENAME TO "User"`);
      },
      { timeout: 120_000, maxWait: 10_000 },
    );
  } finally {
    await client.$executeRawUnsafe(`PRAGMA foreign_keys = ON`);
  }
}

async function ensureSessionTable(client: LegacyRepairClient): Promise<void> {
  await client.$executeRawUnsafe(SESSION_DDL);
  await client.$executeRawUnsafe(
    `CREATE UNIQUE INDEX IF NOT EXISTS "Session_accessTokenHash_key" ON "Session"("accessTokenHash")`,
  );
  await client.$executeRawUnsafe(
    `CREATE UNIQUE INDEX IF NOT EXISTS "Session_refreshTokenHash_key" ON "Session"("refreshTokenHash")`,
  );
  await client.$executeRawUnsafe(
    `CREATE INDEX IF NOT EXISTS "Session_userId_idx" ON "Session"("userId")`,
  );
}

async function ensureMfaTables(client: LegacyRepairClient): Promise<void> {
  await client.$executeRawUnsafe(MFA_BACKUP_CODE_DDL);
  await client.$executeRawUnsafe(
    `CREATE INDEX IF NOT EXISTS "MfaBackupCode_userId_idx" ON "MfaBackupCode"("userId")`,
  );
  await client.$executeRawUnsafe(MFA_CHALLENGE_DDL);
  await client.$executeRawUnsafe(
    `CREATE INDEX IF NOT EXISTS "MfaChallenge_userId_idx" ON "MfaChallenge"("userId")`,
  );
}

async function ensureInstanceSettings(client: LegacyRepairClient): Promise<void> {
  await client.$executeRawUnsafe(INSTANCE_SETTINGS_DDL);
}

async function ensureImportJobTable(client: LegacyRepairClient): Promise<void> {
  await client.$executeRawUnsafe(IMPORT_JOB_DDL);
  await client.$executeRawUnsafe(
    `CREATE INDEX IF NOT EXISTS "ImportJob_userId_idx" ON "ImportJob"("userId")`,
  );
  await client.$executeRawUnsafe(
    `CREATE INDEX IF NOT EXISTS "ImportJob_expiresAt_idx" ON "ImportJob"("expiresAt")`,
  );
}

async function ensureTagTables(client: LegacyRepairClient): Promise<void> {
  await client.$executeRawUnsafe(TAG_DDL);
  await client.$executeRawUnsafe(
    `CREATE UNIQUE INDEX IF NOT EXISTS "Tag_userId_normalizedName_key" ON "Tag"("userId", "normalizedName")`,
  );
  await client.$executeRawUnsafe(
    `CREATE INDEX IF NOT EXISTS "Tag_userId_idx" ON "Tag"("userId")`,
  );
  await client.$executeRawUnsafe(BOOKMARK_TAG_DDL);
  await client.$executeRawUnsafe(
    `CREATE INDEX IF NOT EXISTS "BookmarkTag_tagId_idx" ON "BookmarkTag"("tagId")`,
  );
  await client.$executeRawUnsafe(BOOKMARK_TAG_SUGGESTION_DDL);
  await client.$executeRawUnsafe(
    `CREATE INDEX IF NOT EXISTS "BookmarkTagSuggestion_tagId_idx" ON "BookmarkTagSuggestion"("tagId")`,
  );
  await client.$executeRawUnsafe(
    `CREATE INDEX IF NOT EXISTS "BookmarkTagSuggestion_bookmarkId_status_idx" ON "BookmarkTagSuggestion"("bookmarkId", "status")`,
  );
}

async function rebuildBookmarkTableWithNullableFolderId(
  client: LegacyRepairClient,
  columns: SqliteColumn[],
): Promise<void> {
  const copyList = columns
    .filter((c) => BOOKMARK_TABLE_COLUMNS.includes(c.name))
    .map((c) => `"${c.name}"`)
    .join(", ");

  await client.$transaction(
    async (tx) => {
      await tx.$executeRawUnsafe(`DROP TABLE IF EXISTS "Bookmark_migration"`);
      await tx.$executeRawUnsafe(BOOKMARK_MIGRATION_DDL);
      await tx.$executeRawUnsafe(
        `INSERT INTO "Bookmark_migration" (${copyList}) SELECT ${copyList} FROM "Bookmark"`,
      );
      await tx.$executeRawUnsafe(`DROP TABLE "Bookmark"`);
      await tx.$executeRawUnsafe(`ALTER TABLE "Bookmark_migration" RENAME TO "Bookmark"`);
      await tx.$executeRawUnsafe(`CREATE INDEX "Bookmark_userId_idx" ON "Bookmark"("userId")`);
      await tx.$executeRawUnsafe(
        `CREATE INDEX "Bookmark_userId_fetchStatus_idx" ON "Bookmark"("userId", "fetchStatus")`,
      );
      await tx.$executeRawUnsafe(`CREATE INDEX "Bookmark_folderId_idx" ON "Bookmark"("folderId")`);
      await tx.$executeRawUnsafe(`CREATE INDEX "Bookmark_createdAt_idx" ON "Bookmark"("createdAt")`);
    },
    { timeout: 120_000, maxWait: 10_000 },
  );
}

async function addMissingColumns(
  client: LegacyRepairClient,
  table: string,
  additions: ReadonlyArray<readonly [name: string, ddl: string]>,
  columns: SqliteColumn[],
): Promise<void> {
  const existing = new Set(columns.map((c) => c.name));
  for (const [name, ddl] of additions) {
    if (existing.has(name)) continue;
    await client.$executeRawUnsafe(`ALTER TABLE "${table}" ADD COLUMN "${name}" ${ddl}`);
  }
}

const BOOKMARK_TABLE_COLUMNS: readonly string[] = [
  "id",
  "userId",
  "folderId",
  "url",
  "title",
  "description",
  "domain",
  "contentHtml",
  "contentMarkdown",
  "contentText",
  "fetchStatus",
  "isRead",
  "createdAt",
  "updatedAt",
];

const BOOKMARK_ADDITIVE_COLUMNS: ReadonlyArray<readonly [name: string, ddl: string]> = [
  ["extractionReason", "TEXT"],
  ["extractionVersion", "INTEGER"],
  ["author", "TEXT"],
  ["publishedAt", "DATETIME"],
  ["readingTimeMinutes", "INTEGER"],
  ["readProgress", "REAL NOT NULL DEFAULT 0"],
  ["completedAt", "DATETIME"],
  ["contentKindOverride", "TEXT"],
  ["articleUndoSnapshot", "TEXT"],
];

const FOLDER_ADDITIVE_COLUMNS: ReadonlyArray<readonly [name: string, ddl: string]> = [
  ["lockType", "TEXT"],
  ["pinLength", "INTEGER"],
];

const USER_ADDITIVE_COLUMNS: ReadonlyArray<readonly [name: string, ddl: string]> = [
  ["preferences", "TEXT"],
  ["totpSecretEnc", "TEXT"],
  ["totpEnabledAt", "DATETIME"],
  ["avatarMime", "TEXT"],
  ["avatarUpdatedAt", "DATETIME"],
  ["avatarBytes", "BLOB"],
];

const EMAIL_TOKEN_ADDITIVE_COLUMNS: ReadonlyArray<readonly [name: string, ddl: string]> = [
  ["attempts", "INTEGER NOT NULL DEFAULT 0"],
  ["purpose", "TEXT NOT NULL DEFAULT 'verify'"],
];

const BOOKMARK_MIGRATION_DDL = `
CREATE TABLE "Bookmark_migration" (
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
)`;

const USER_MIGRATION_DDL = `
CREATE TABLE "User_migration" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "displayName" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "emailVerifiedAt" DATETIME,
    "pendingEmail" TEXT,
    "preferences" TEXT,
    "totpSecretEnc" TEXT,
    "totpEnabledAt" DATETIME,
    "avatarMime" TEXT,
    "avatarUpdatedAt" DATETIME,
    "avatarBytes" BLOB,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "User_email_key" UNIQUE ("email")
)`;

const SESSION_DDL = `
CREATE TABLE IF NOT EXISTS "Session" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "accessTokenHash" TEXT NOT NULL,
    "accessTokenExpiresAt" DATETIME NOT NULL,
    "refreshTokenHash" TEXT NOT NULL,
    "refreshTokenExpiresAt" DATETIME NOT NULL,
    "deviceInfo" TEXT,
    "deviceName" TEXT,
    "deviceType" TEXT,
    "ip" TEXT,
    "lastSeenAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "Session_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
)`;

const MFA_BACKUP_CODE_DDL = `
CREATE TABLE IF NOT EXISTS "MfaBackupCode" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "codeHash" TEXT NOT NULL,
    "usedAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "MfaBackupCode_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
)`;

const MFA_CHALLENGE_DDL = `
CREATE TABLE IF NOT EXISTS "MfaChallenge" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "purpose" TEXT NOT NULL,
    "payload" TEXT,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "expiresAt" DATETIME NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "MfaChallenge_tokenHash_key" UNIQUE ("tokenHash"),
    CONSTRAINT "MfaChallenge_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
)`;

const TAG_DDL = `
CREATE TABLE IF NOT EXISTS "Tag" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "normalizedName" TEXT NOT NULL,
    "color" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "Tag_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
)`;

const BOOKMARK_TAG_DDL = `
CREATE TABLE IF NOT EXISTS "BookmarkTag" (
    "bookmarkId" TEXT NOT NULL,
    "tagId" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY ("bookmarkId", "tagId"),
    CONSTRAINT "BookmarkTag_bookmarkId_fkey" FOREIGN KEY ("bookmarkId") REFERENCES "Bookmark" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "BookmarkTag_tagId_fkey" FOREIGN KEY ("tagId") REFERENCES "Tag" ("id") ON DELETE CASCADE ON UPDATE CASCADE
)`;

const INSTANCE_SETTINGS_DDL = `
CREATE TABLE IF NOT EXISTS "InstanceSettings" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "updatedAt" DATETIME NOT NULL
)`;

const IMPORT_JOB_DDL = `
CREATE TABLE IF NOT EXISTS "ImportJob" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'parsing',
    "sourceFormat" TEXT,
    "fileName" TEXT,
    "entries" TEXT,
    "preview" TEXT,
    "failure" TEXT,
    "result" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    "expiresAt" DATETIME NOT NULL,
    CONSTRAINT "ImportJob_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
)`;

const BOOKMARK_TAG_SUGGESTION_DDL = `
CREATE TABLE IF NOT EXISTS "BookmarkTagSuggestion" (
    "bookmarkId" TEXT NOT NULL,
    "tagId" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    PRIMARY KEY ("bookmarkId", "tagId"),
    CONSTRAINT "BookmarkTagSuggestion_bookmarkId_fkey" FOREIGN KEY ("bookmarkId") REFERENCES "Bookmark" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "BookmarkTagSuggestion_tagId_fkey" FOREIGN KEY ("tagId") REFERENCES "Tag" ("id") ON DELETE CASCADE ON UPDATE CASCADE
)`;
