/**
 * Regression coverage for cross-request state invariants: reading state,
 * import job lifecycle, OTP/MFA attempt counters, session revocation, shared
 * HTML fetches, owner claims, and transactional migrations.
 *
 * Run after the server build, like test-bookmark-title.cjs.
 */
const assert = require('node:assert/strict');
const bcrypt = require('bcryptjs');
const { randomBytes, randomUUID } = require('node:crypto');
const { mkdtempSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } = require('node:fs');
const { tmpdir } = require('node:os');
const path = require('node:path');
const Database = require('better-sqlite3');
const {
  EMAIL_OTP_PURPOSE,
  MFA_CHALLENGE_PURPOSE,
  ErrorCode,
} = require('@ordo/shared');
const { PrismaClient } = require('../dist/prisma/client.js');
const { createPrismaAdapter } = require('../dist/prisma/create-adapter.js');
const { ensurePrismaSchema } = require('../dist/prisma/schema-migrate.js');
const { BookmarksService } = require('../dist/bookmarks/bookmarks.service.js');
const { ExtractionService } = require('../dist/bookmarks/extraction.service.js');
const { FolderAccessService } = require('../dist/bookmarks/folder-access.service.js');
const { FolderTokenService } = require('../dist/bookmarks/folder-token.service.js');
const { TagSuggestionService } = require('../dist/bookmarks/tag-suggestion.service.js');
const { HtmlCache } = require('../dist/bookmarks/html-cache.js');
const { ImportService } = require('../dist/import-export/import.service.js');
const { AuthService } = require('../dist/auth/auth.service.js');
const { SessionService } = require('../dist/auth/session.service.js');
const { TokenService } = require('../dist/auth/token.service.js');
const { MfaService } = require('../dist/auth/mfa.service.js');
const { LibraryCryptoService } = require('../dist/crypto/library-crypto.service.js');
const { LibraryKeyService } = require('../dist/crypto/library-key.service.js');
const { hashEmailOtp } = require('../dist/common/utils/tokens.js');
const { claimInstanceOwner } = require('../dist/server/instance-admin.js');

const directory = mkdtempSync(path.join(tmpdir(), 'ordo-state-test-'));
const filename = path.join(directory, 'test.db');

function migrationSql() {
  const migrations = path.resolve(__dirname, '../prisma/migrations');
  const database = new Database(filename);
  for (const name of readdirSync(migrations).sort()) {
    if (name === 'migration_lock.toml') continue;
    database.exec(readFileSync(path.join(migrations, name, 'migration.sql'), 'utf8'));
  }
  database.close();
}

const config = {
  port: 0,
  listenHost: '127.0.0.1',
  databaseUrl: `file:${filename}`,
  jwtSecret: 'state-test-secret',
  libraryKek: '0'.repeat(64),
  registrationEnabled: true,
  emailVerificationRequired: true,
  corsAllowedOrigins: [],
  smtpUrl: null,
  smtpFrom: 'ordo@example.test',
  smtpRequired: false,
  rateLimitEnabled: false,
  trustProxy: 0,
  profilePictureMaxBytes: 1024 * 1024,
  avatarStorage: 'database',
  avatarDir: directory,
  avatarAllowAnimated: false,
  mfaRequired: false,
  instanceRenameEnabled: true,
  instanceAdminEmail: null,
};

const meta = { deviceInfo: 'test', deviceName: 'test', deviceType: 'web', ip: '127.0.0.1' };
const noop = async () => undefined;

async function waitFor(check, description, attempts = 100) {
  for (let i = 0; i < attempts; i += 1) {
    if (await check()) return;
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  throw new Error(`Timed out waiting for ${description}`);
}

migrationSql();
const prisma = new PrismaClient({ adapter: createPrismaAdapter(`file:${filename}`) });
const crypto = new LibraryCryptoService();
const tokens = new TokenService(config);
const sessions = new SessionService(prisma, tokens, crypto);
const libraryKeys = new LibraryKeyService(prisma, crypto, config);
const access = new FolderAccessService(prisma, { resolveFolderIds: async () => [] });
const extraction = { enqueue() {}, cancel() {}, refreshSafely() {} };
const bookmarks = new BookmarksService(prisma, extraction, access, {}, crypto);
const mail = {
  sendVerification: noop,
  sendPasswordReset: noop,
  sendEmailChangeNotice: noop,
  sendEmailChangeVerification: noop,
  sendEmailChangedNotice: noop,
  sendMfaRecovery: noop,
  sendMfaRecoveryNotice: noop,
};
const avatars = { deleteStored: noop };
const rateLimit = { checkLogin() {}, recordLoginFailure() {}, clearLogin() {} };
const mfa = new MfaService(prisma, tokens, mail, config, crypto);
const auth = new AuthService(
  prisma,
  sessions,
  tokens,
  mail,
  config,
  rateLimit,
  mfa,
  avatars,
  crypto,
  libraryKeys,
);
const imports = new ImportService(prisma, tokens, extraction, crypto, libraryKeys);

async function createUser(email, extra = {}) {
  return prisma.user.create({
    data: {
      email,
      displayName: 'Test',
      passwordHash: await bcrypt.hash('correct horse battery staple', 10),
      ...extra,
    },
  });
}

async function createSession(userId) {
  const pair = tokens.generatePair();
  return prisma.session.create({
    data: {
      userId,
      accessTokenHash: pair.accessHash,
      accessTokenExpiresAt: pair.accessTokenExpiresAt,
      refreshTokenHash: pair.refreshHash,
      refreshTokenExpiresAt: pair.refreshTokenExpiresAt,
    },
  });
}

(async () => {
  const lockUser = await createUser('folder-lock-race@example.test');
  const lockedFolder = await prisma.folder.create({ data: { userId: lockUser.id, name: 'Locked' } });
  const folderTokens = new FolderTokenService(prisma, tokens);
  await folderTokens.setPassword(lockedFolder.id, 'old-password', 'password');
  const oldLock = await prisma.folder.findUniqueOrThrow({ where: { id: lockedFolder.id } });
  await folderTokens.setPassword(lockedFolder.id, 'new-password', 'password');
  await assert.rejects(folderTokens.unlock(oldLock, 'old-password'), error => error.code === ErrorCode.INVALID_FOLDER_PASSWORD);
  assert.equal(await prisma.folderToken.count({ where: { folderId: lockedFolder.id } }), 0, 'a verified old password cannot issue a token after lock replacement');

  const suggestedTag = await prisma.tag.create({ data: { userId: lockUser.id, name: 'Typescript', normalizedName: 'typescript', color: '#123456' } });
  const suggestedBookmark = await prisma.bookmark.create({ data: { userId: lockUser.id, url: 'https://tags.test', domain: 'tags.test', title: 'Typescript guide', fetchStatus: 'ok' } });
  let releaseScoring;
  let scoringStarted;
  const scoringGate = new Promise(resolve => { releaseScoring = resolve; });
  const scoringReady = new Promise(resolve => { scoringStarted = resolve; });
  const suggestionPrisma = {
    bookmark: prisma.bookmark,
    tag: { findMany: async args => { const rows = await prisma.tag.findMany(args); scoringStarted(); await scoringGate; return rows; } },
    $transaction: fn => prisma.$transaction(fn),
  };
  const suggestions = new TagSuggestionService(suggestionPrisma, crypto);
  const scoring = suggestions.refresh(suggestedBookmark.id);
  await scoringReady;
  await prisma.bookmarkTag.create({ data: { bookmarkId: suggestedBookmark.id, tagId: suggestedTag.id } });
  releaseScoring();
  await scoring;
  assert.equal(await prisma.bookmarkTagSuggestion.count({ where: { bookmarkId: suggestedBookmark.id } }), 0, 'stale scoring cannot suggest an already accepted tag');

  // --- bookmark reading state ------------------------------------------------
  const reader = await createUser('reader@example.test');
  const read = await prisma.bookmark.create({
    data: {
      userId: reader.id,
      url: 'https://example.test/read',
      domain: 'example.test',
      title: 'Read',
      isRead: true,
      readProgress: 1,
      completedAt: new Date(),
    },
  });
  const scrolledBack = await bookmarks.update(reader.id, read.id, { readProgress: 0.4 }, []);
  assert.equal(scrolledBack.isRead, false, 'falling below the completion threshold clears isRead');
  assert.equal(scrolledBack.completedAt, null, 'unread rows never carry completedAt');

  const forced = await prisma.bookmark.create({
    data: {
      userId: reader.id,
      url: 'https://example.test/forced',
      domain: 'example.test',
      title: 'Forced article',
      contentKindOverride: 'article',
      articleUndoSnapshot: JSON.stringify({
        title: 'Website',
        description: null,
        author: null,
        publishedAt: null,
        readingTimeMinutes: null,
        contentHtml: null,
        fetchStatus: 'unsupported',
        extractionReason: null,
        extractionVersion: null,
      }),
      isRead: true,
      readProgress: 1,
      completedAt: new Date(),
    },
  });
  const [, undone] = await Promise.all([
    bookmarks.update(reader.id, forced.id, { title: 'Concurrent user title' }, []),
    bookmarks.update(reader.id, forced.id, { contentKindOverride: 'web' }, []),
  ]);
  assert.equal(undone.title, 'Concurrent user title', 'classification undo recomputes after a concurrent rename instead of restoring a stale title');
  assert.equal(undone.contentKindOverride, null);
  assert.equal(undone.readProgress, 0, 'undoing forced extraction resets reading progress');
  assert.equal(undone.isRead, false, 'reset progress must also reset isRead');
  assert.equal(undone.completedAt, null);

  // --- import job state machine ----------------------------------------------
  const importer = await createUser('importer@example.test');
  const envelope = JSON.stringify({
    format: 'ordo-export',
    version: 1,
    exportedAt: new Date().toISOString(),
    folders: [],
    bookmarks: [
      {
        url: 'https://example.test/unread',
        title: 'Imported unread',
        isRead: false,
        completedAt: '2024-01-01T00:00:00.000Z',
      },
    ],
  });
  const staged = await imports.createJob(importer.id, 'import.json', envelope);
  await waitFor(
    async () => (await prisma.importJob.findUnique({ where: { id: staged.jobId } }))?.status === 'ready',
    'import parse',
  );
  await imports.commit(importer.id, staged.jobId, { duplicatePolicy: 'skip', atomic: true }, []);
  await waitFor(
    async () => (await prisma.importJob.findUnique({ where: { id: staged.jobId } }))?.status === 'completed',
    'import commit',
  );
  const imported = await prisma.bookmark.findFirst({
    where: { userId: importer.id, url: 'https://example.test/unread' },
  });
  assert.ok(imported);
  assert.equal(imported.isRead, false);
  assert.equal(imported.completedAt, null, 'an unread import never persists completedAt');

  // Force the final durable transition to fail. Atomic imports must roll back
  // their bookmarks too, rather than report failure after committing content.
  const failing = await imports.createJob(importer.id, 'rollback.json', envelope);
  await waitFor(async () => (await prisma.importJob.findUnique({ where: { id: failing.jobId } }))?.status === 'ready', 'rollback preview');
  const beforeRollback = await prisma.bookmark.count({ where: { userId: importer.id } });
  await prisma.$executeRawUnsafe(`CREATE TRIGGER fail_import_completion BEFORE UPDATE OF status ON ImportJob
    WHEN NEW.id = '${failing.jobId}' AND NEW.status = 'completed'
    BEGIN SELECT RAISE(ABORT, 'injected import completion failure'); END`);
  await imports.commit(importer.id, failing.jobId, { duplicatePolicy: 'copy', atomic: true }, []);
  await waitFor(async () => (await prisma.importJob.findUnique({ where: { id: failing.jobId } }))?.status === 'failed', 'atomic rollback');
  await prisma.$executeRawUnsafe('DROP TRIGGER fail_import_completion');
  assert.equal(await prisma.bookmark.count({ where: { userId: importer.id } }), beforeRollback, 'job completion and imported rows commit atomically');

  const expired = await prisma.importJob.create({
    data: { userId: importer.id, status: 'ready', entries: '{}', expiresAt: new Date(Date.now() - 1000) },
  });
  await assert.rejects(imports.commit(importer.id, expired.id, { duplicatePolicy: 'skip', atomic: true }, []));
  assert.equal((await prisma.importJob.findUnique({ where: { id: expired.id } })).status, 'ready', 'expiry cannot be bypassed by a commit claim');

  const readyJob = await prisma.importJob.create({
    data: { userId: importer.id, status: 'ready', expiresAt: new Date(Date.now() + 60_000) },
  });
  await imports.cancel(importer.id, readyJob.id);
  assert.equal(await prisma.importJob.findUnique({ where: { id: readyJob.id } }), null);

  const committing = await prisma.importJob.create({
    data: {
      userId: importer.id,
      status: 'committing',
      entries: '{}',
      // Predate the service's boot timestamp: recovery only fails jobs left
      // behind by a previous process.
      createdAt: new Date(Date.now() - 3_600_000),
      expiresAt: new Date(Date.now() - 60_000),
    },
  });
  await assert.rejects(imports.cancel(importer.id, committing.id), (err) => {
    assert.equal(err.code, ErrorCode.IMPORT_INVALID_STATE);
    return true;
  });
  assert.ok(await prisma.importJob.findUnique({ where: { id: committing.id } }), 'cancel cannot delete a running commit');
  assert.equal(
    (await imports.getJob(importer.id, committing.id)).status,
    'committing',
    'expiry must not delete a running commit',
  );

  await imports.sweep();
  assert.ok(await prisma.importJob.findUnique({ where: { id: committing.id } }), 'sweep keeps running commits');
  await imports.recoverInterrupted();
  const recovered = await prisma.importJob.findUnique({ where: { id: committing.id } });
  assert.equal(recovered.status, 'failed', 'boot recovery fails jobs left mid-flight');
  await imports.sweep();
  assert.equal(await prisma.importJob.findUnique({ where: { id: committing.id } }), null, 'expired failed jobs sweep');

  // --- OTP attempt counters --------------------------------------------------
  const otpUser = await createUser('otp@example.test');
  await prisma.emailVerificationToken.create({
    data: {
      userId: otpUser.id,
      purpose: EMAIL_OTP_PURPOSE.VERIFY,
      token: hashEmailOtp(otpUser.id, '123456', config.jwtSecret),
      expiresAt: new Date(Date.now() + 60_000),
    },
  });
  const otpResults = await Promise.allSettled(
    Array.from({ length: 5 }, () => auth.verifyEmail(otpUser.email, '000000')),
  );
  assert.ok(otpResults.every((result) => result.status === 'rejected'), 'wrong OTPs fail');
  const otpRow = await prisma.emailVerificationToken.findFirstOrThrow({
    where: { userId: otpUser.id, purpose: EMAIL_OTP_PURPOSE.VERIFY },
  });
  assert.equal(otpRow.attempts, 5, 'parallel OTP guesses all count');
  assert.ok(otpRow.consumedAt, 'the token retires at MAX_ATTEMPTS');

  // --- MFA challenge + recovery counters ------------------------------------
  const mfaUser = await createUser('mfa@example.test', {
    emailVerifiedAt: new Date(),
    totpSecretEnc: 'not-used-for-non-numeric-codes',
    totpEnabledAt: new Date(),
  });
  const challenge = await mfa.createLoginChallenge(mfaUser);
  const challengeResults = await Promise.allSettled(
    Array.from({ length: 5 }, () => mfa.consumeLoginCode(challenge.challengeToken, 'wrong-code')),
  );
  assert.ok(challengeResults.every((result) => result.status === 'rejected'), 'wrong MFA codes fail');
  assert.equal(
    await prisma.mfaChallenge.count({ where: { userId: mfaUser.id, purpose: MFA_CHALLENGE_PURPOSE.LOGIN } }),
    0,
    'the challenge is dropped at the attempt cap',
  );

  const recoveryChallenge = await mfa.createLoginChallenge(mfaUser);
  await prisma.emailVerificationToken.create({
    data: {
      userId: mfaUser.id,
      purpose: EMAIL_OTP_PURPOSE.MFA_RECOVERY,
      token: hashEmailOtp(mfaUser.id, '123456', config.jwtSecret),
      expiresAt: new Date(Date.now() + 60_000),
    },
  });
  const recoveryResults = await Promise.allSettled(
    Array.from({ length: 5 }, () => mfa.consumeEmailRecovery(recoveryChallenge.challengeToken, '999999')),
  );
  assert.ok(recoveryResults.every((result) => result.status === 'rejected'), 'wrong recovery codes fail');
  const recoveryRow = await prisma.emailVerificationToken.findFirstOrThrow({
    where: { userId: mfaUser.id, purpose: EMAIL_OTP_PURPOSE.MFA_RECOVERY },
  });
  assert.equal(recoveryRow.attempts, 5, 'parallel recovery guesses all count');
  assert.ok(recoveryRow.consumedAt, 'the recovery code retires at MAX_ATTEMPTS');

  // --- password reset revokes sessions in the same write --------------------
  const resetUser = await createUser('reset@example.test');
  const resetSession = await createSession(resetUser.id);
  await prisma.emailVerificationToken.create({
    data: {
      userId: resetUser.id,
      purpose: EMAIL_OTP_PURPOSE.PASSWORD_RESET,
      token: hashEmailOtp(resetUser.id, '654321', config.jwtSecret),
      expiresAt: new Date(Date.now() + 60_000),
    },
  });
  await auth.resetPassword(resetUser.email, '654321', 'a brand new password');
  const afterReset = await prisma.user.findUniqueOrThrow({ where: { id: resetUser.id } });
  assert.equal(await bcrypt.compare('a brand new password', afterReset.passwordHash), true);
  assert.equal(await prisma.session.findUnique({ where: { id: resetSession.id } }), null);

  // --- change password revokes old sessions and starts one new one ----------
  const changeUser = await createUser('change@example.test');
  const changeSession = await createSession(changeUser.id);
  await auth.changePassword(
    changeUser.id,
    'correct horse battery staple',
    'another brand new password',
    meta,
  );
  const afterChange = await prisma.user.findUniqueOrThrow({ where: { id: changeUser.id } });
  assert.equal(await bcrypt.compare('another brand new password', afterChange.passwordHash), true);
  assert.equal(await prisma.session.findUnique({ where: { id: changeSession.id } }), null);
  assert.equal(await prisma.session.count({ where: { userId: changeUser.id } }), 1);

  // --- shared HTML fetches survive one caller aborting ----------------------
  const cache = new HtmlCache();
  const controller = new AbortController();
  const url = 'https://shared.example.test/page';
  let loaderStarted;
  const started = new Promise((resolve) => {
    loaderStarted = resolve;
  });
  const loader = (signal) =>
    new Promise((resolve, reject) => {
      loaderStarted();
      signal.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')));
      setTimeout(() => resolve('<html><head><title>Shared</title></head></html>'), 40);
    });
  const first = cache.remember(url, loader, controller.signal);
  const second = cache.remember(url, loader);
  await started;
  controller.abort();
  await assert.rejects(first);
  assert.match(await second, /Shared/, 'the remaining caller still receives the shared fetch');
  assert.match(cache.get(url) ?? '', /Shared/);

  // --- concurrent first-account owner claims --------------------------------
  await prisma.instanceSettings.deleteMany();
  const ownerA = await createUser('owner-a@example.test');
  const ownerB = await createUser('owner-b@example.test');
  const claims = await Promise.allSettled([
    claimInstanceOwner(prisma, ownerA.id),
    claimInstanceOwner(prisma, ownerB.id),
  ]);
  assert.ok(claims.every((claim) => claim.status === 'fulfilled'), 'the losing claim must not throw');
  const settings = await prisma.instanceSettings.findUniqueOrThrow({ where: { id: 'instance' } });
  assert.ok([ownerA.id, ownerB.id].includes(settings.ownerUserId));

  // --- migrations are all-or-nothing ----------------------------------------
  const migrationDir = mkdtempSync(path.join(tmpdir(), 'ordo-migrations-'));
  const partial = path.join(migrationDir, '20260101000000_partial');
  mkdirSync(partial);
  writeFileSync(
    path.join(partial, 'migration.sql'),
    'CREATE TABLE "Half" ("id" TEXT NOT NULL PRIMARY KEY);\n\nINSERT INTO "Missing" ("id") VALUES (\'x\');\n',
  );
  const migrateDb = path.join(directory, 'migrate.db');
  const migrateClient = new PrismaClient({ adapter: createPrismaAdapter(`file:${migrateDb}`) });
  try {
    await assert.rejects(
      ensurePrismaSchema(migrateClient, { databaseUrl: `file:${migrateDb}`, migrationsDir: migrationDir }),
    );
    const tables = await migrateClient.$queryRawUnsafe(
      "SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'Half'",
    );
    assert.deepEqual(tables, [], 'a failed migration leaves no partial DDL behind');
    const applied = await migrateClient.$queryRawUnsafe(
      'SELECT "migration_name" AS name FROM "_prisma_migrations"',
    );
    assert.deepEqual(applied, [], 'a failed migration is not recorded as applied');
  } finally {
    await migrateClient.$disconnect();
    rmSync(migrationDir, { recursive: true, force: true });
  }

  console.log(
    'PASS: reading state, import lifecycle, OTP/MFA counters, session revocation, shared fetch abort, owner claims, transactional migrations',
  );
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
}).finally(async () => {
  await prisma.$disconnect();
  rmSync(directory, { recursive: true, force: true });
});
