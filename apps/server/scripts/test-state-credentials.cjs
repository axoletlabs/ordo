/**
 * Regression coverage for the credential/library state machines:
 *
 *  - legacy library key provisioning + crash/resume + concurrent logins
 *  - password reset OTP single-use + MFA challenge invalidation
 *  - login session creation guarded on the credential snapshot it verified
 *  - TOTP enrollment final claim (expiry / attempts / replace / disable)
 *  - MFA login + email-recovery completion claims
 *
 * Run after the server build, like test-state-invariants.cjs.
 */
const assert = require('node:assert/strict');
const bcrypt = require('bcryptjs');
const { randomUUID } = require('node:crypto');
const { copyFileSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync } = require('node:fs');
const { tmpdir } = require('node:os');
const path = require('node:path');
const Database = require('better-sqlite3');
const OTPAuth = require('otpauth');
const {
  EMAIL_OTP,
  EMAIL_OTP_PURPOSE,
  ErrorCode,
  MFA,
  MFA_CHALLENGE_PURPOSE,
} = require('@ordo/shared');
const { PrismaClient } = require('../dist/prisma/client.js');
const { createPrismaAdapter } = require('../dist/prisma/create-adapter.js');
const { ensurePrismaSchema } = require('../dist/prisma/schema-migrate.js');
const { AuthService } = require('../dist/auth/auth.service.js');
const { SessionService } = require('../dist/auth/session.service.js');
const { TokenService } = require('../dist/auth/token.service.js');
const { MfaService } = require('../dist/auth/mfa.service.js');
const { LibraryCryptoService } = require('../dist/crypto/library-crypto.service.js');
const { LibraryKeyService } = require('../dist/crypto/library-key.service.js');
const { ExportService } = require('../dist/import-export/export.service.js');
const {
  LIBRARY_STATE,
  isLibraryCiphertext,
} = require('../dist/crypto/library-crypto.js');
const { hashEmailOtp } = require('../dist/common/utils/tokens.js');

const PASSWORD = 'correct horse battery staple';
const directory = mkdtempSync(path.join(tmpdir(), 'ordo-credential-test-'));
const filename = path.join(directory, 'test.db');

(function migrate() {
  const migrations = path.resolve(__dirname, '../prisma/migrations');
  const database = new Database(filename);
  for (const name of readdirSync(migrations).sort()) {
    if (name === 'migration_lock.toml') continue;
    database.exec(readFileSync(path.join(migrations, name, 'migration.sql'), 'utf8'));
  }
  database.close();
})();

const config = {
  port: 0,
  listenHost: '127.0.0.1',
  databaseUrl: `file:${filename}`,
  jwtSecret: 'credential-state-test-secret',
  libraryKek: 'a'.repeat(64),
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

const prisma = new PrismaClient({ adapter: createPrismaAdapter(`file:${filename}`) });
const crypto = new LibraryCryptoService();
const tokens = new TokenService(config);
const sessions = new SessionService(prisma, tokens, crypto);
const libraryKeys = new LibraryKeyService(prisma, crypto, config);
const mail = {
  sendVerification: async () => undefined,
  sendPasswordReset: async () => undefined,
  sendEmailChangeNotice: async () => undefined,
  sendEmailChangeVerification: async () => undefined,
  sendEmailChangedNotice: async () => undefined,
  sendMfaRecovery: async () => undefined,
  sendMfaRecoveryNotice: async () => undefined,
};
const mfa = new MfaService(prisma, tokens, mail, config, crypto);
const auth = new AuthService(
  prisma,
  sessions,
  tokens,
  mail,
  config,
  { checkLogin() {}, recordLoginFailure() {}, clearLogin() {} },
  mfa,
  { deleteStored: async () => undefined },
  crypto,
  libraryKeys,
);

const realMigrateLibrary = libraryKeys.migrateLibrary.bind(libraryKeys);

async function createUser(email, extra = {}) {
  return prisma.user.create({
    data: {
      email,
      displayName: 'Test',
      passwordHash: await bcrypt.hash(PASSWORD, 10),
      emailVerifiedAt: new Date(),
      ...extra,
    },
  });
}

async function seedLibrary(userId, label) {
  const folder = await prisma.folder.create({
    data: { userId, name: `${label} folder` },
  });
  const first = await prisma.bookmark.create({
    data: {
      userId,
      folderId: folder.id,
      url: `https://example.test/${label}/one`,
      domain: 'example.test',
      title: `${label} one`,
      description: `${label} description`,
    },
  });
  const second = await prisma.bookmark.create({
    data: {
      userId,
      url: `https://example.test/${label}/two`,
      domain: 'example.test',
      title: `${label} two`,
    },
  });
  const tag = await prisma.tag.create({
    data: {
      userId,
      name: `${label} tag`,
      normalizedName: `${label} tag`.toLowerCase(),
      color: '#123456',
    },
  });
  return { folder, first, second, tag };
}

async function otp(userId, purpose, code) {
  await prisma.emailVerificationToken.deleteMany({ where: { userId, purpose } });
  return prisma.emailVerificationToken.create({
    data: {
      userId,
      purpose,
      token: hashEmailOtp(userId, code, config.jwtSecret),
      expiresAt: new Date(Date.now() + EMAIL_OTP.TTL_MS),
    },
  });
}

function totpFor(email, secret) {
  return new OTPAuth.TOTP({
    issuer: MFA.ISSUER,
    label: email,
    algorithm: 'SHA1',
    digits: MFA.TOTP_DIGITS,
    period: MFA.TOTP_PERIOD_S,
    secret: OTPAuth.Secret.fromBase32(secret),
  });
}

async function dekFromSession(accessToken, sessionId) {
  const session = await prisma.session.findUniqueOrThrow({ where: { id: sessionId } });
  return crypto.unwrapAccess(session.dekWrapped, accessToken);
}

function isCredentialsChanged(error) {
  return error && error.code === ErrorCode.SESSION_REVOKED;
}

(async () => {
  // Null-key requests/jobs and first migration share one transition owner.
  const windowUser = await createUser('legacy-write-window@example.test');
  let releaseLegacy;
  let startedLegacy;
  const legacyStarted = new Promise(resolve => { startedLegacy = resolve; });
  const legacyGate = new Promise(resolve => { releaseLegacy = resolve; });
  const oldWork = libraryKeys.runWithCurrentKey(windowUser.id, null, async () => {
    assert.equal(crypto.snapshot(), null);
    startedLegacy();
    await legacyGate;
    return prisma.bookmark.create({ data: {
      userId: windowUser.id, url: 'https://legacy.test/last-write', domain: 'legacy.test', title: 'Final legacy write',
    } });
  });
  await legacyStarted;
  let migrationFinished = false;
  const windowMigration = libraryKeys.provisionWithPassword(windowUser, PASSWORD).then(result => { migrationFinished = true; return result; });
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(migrationFinished, false, 'key installation waits for null-key writes already in flight');
  releaseLegacy();
  const lastLegacyRow = await oldWork;
  const windowKey = (await windowMigration).dek;
  const sealedLegacyRow = await prisma.bookmark.findUniqueOrThrow({ where: { id: lastLegacyRow.id } });
  assert(isLibraryCiphertext(sealedLegacyRow.title));
  await libraryKeys.runWithCurrentKey(windowUser.id, null, async () => {
    assert(crypto.snapshot().equals(windowKey), 'queued legacy work adopts the installed key');
  });

  const resetClaimUser = await createUser('reset-key-claim-race@example.test');
  await otp(resetClaimUser.id, EMAIL_OTP_PURPOSE.PASSWORD_RESET, '572948');
  const matchOtp = auth.matchOtp.bind(auth);
  let matched;
  let releaseReset;
  const matchedReady = new Promise(resolve => { matched = resolve; });
  const resetGate = new Promise(resolve => { releaseReset = resolve; });
  auth.matchOtp = async (...args) => { const result = await matchOtp(...args); matched(); await resetGate; return result; };
  const staleReset = auth.resetPassword(resetClaimUser.email, '572948', 'new password after claim');
  staleReset.catch(() => {});
  await matchedReady;
  const claimedKey = (await libraryKeys.provisionWithPassword(resetClaimUser, PASSWORD)).dek;
  auth.matchOtp = matchOtp;
  releaseReset();
  await assert.rejects(staleReset, error => error.code === ErrorCode.INVALID_VERIFICATION_TOKEN);
  const resetClaimAfter = await prisma.user.findUniqueOrThrow({ where: { id: resetClaimUser.id } });
  assert.equal(resetClaimAfter.passwordHash, resetClaimUser.passwordHash, 'a reset that read no key cannot strand a concurrently installed wrap');
  assert((await libraryKeys.provisionWithPassword(resetClaimAfter, PASSWORD)).dek.equals(claimedKey));

  const emailUser = await createUser('email-transition@example.test');
  const delivered = [];
  const sendVerification = mail.sendVerification;
  mail.sendVerification = async (email, code) => { delivered.push({ email, code }); };
  await Promise.all([
    auth.requestEmailChange(emailUser.id, PASSWORD, 'first-target@example.test'),
    auth.requestEmailChange(emailUser.id, PASSWORD, 'second-target@example.test'),
  ]);
  const pendingEmailUser = await prisma.user.findUniqueOrThrow({ where: { id: emailUser.id } });
  const liveEmailCode = await prisma.emailVerificationToken.findFirstOrThrow({ where: { userId: emailUser.id, purpose: EMAIL_OTP_PURPOSE.EMAIL_CHANGE } });
  const deliveredCode = delivered.find(entry => entry.email === pendingEmailUser.pendingEmail);
  assert(deliveredCode);
  assert.equal(liveEmailCode.token, hashEmailOtp(emailUser.id, deliveredCode.code, `${config.jwtSecret}:${pendingEmailUser.pendingEmail}`), 'pending address and its code commit together');
  const staleTarget = pendingEmailUser.pendingEmail === 'first-target@example.test' ? 'second-target@example.test' : 'first-target@example.test';
  await assert.rejects(auth.createAndSendOtp(emailUser.id, staleTarget, EMAIL_OTP_PURPOSE.EMAIL_CHANGE), error => error.code === ErrorCode.INVALID_VERIFICATION_TOKEN);
  assert.equal((await prisma.emailVerificationToken.findUniqueOrThrow({ where: { id: liveEmailCode.id } })).token, liveEmailCode.token, 'a late resend for an old target cannot retire the current code');
  await otp(emailUser.id, EMAIL_OTP_PURPOSE.PASSWORD_RESET, '398572');
  await auth.verifyEmailChange(emailUser.id, deliveredCode.code);
  assert.equal(await prisma.emailVerificationToken.count({ where: { userId: emailUser.id, purpose: EMAIL_OTP_PURPOSE.PASSWORD_RESET } }), 0, 'changing address revokes codes sent to the old mailbox');
  mail.sendVerification = sendVerification;

  const exportUser = await createUser('legacy-export-race@example.test');
  await prisma.bookmark.create({ data: { userId: exportUser.id, url: 'https://stream.test/article', domain: 'stream.test', title: 'Stream after migration' } });
  const exporter = new ExportService(prisma, tokens, crypto, libraryKeys);
  const exportsBeforeMigration = await Promise.all(['json', 'html', 'csv'].map(format => exporter.export(exportUser.id, { format }, [])));
  await libraryKeys.provisionWithPassword(exportUser, PASSWORD);
  for (const exported of exportsBeforeMigration) {
    let text = '';
    for await (const chunk of exported.stream) text += chunk.toString();
    assert(text.includes('Stream after migration'), 'lazy export reads adopt a key installed after the handler returned');
    assert(!text.includes('enc1.'), 'exports never expose ciphertext as user content');
  }

  // --- 1a. crash between key claim and row rewrite -------------------------
  const legacy = await createUser('legacy-crash@example.test');
  const seeded = await seedLibrary(legacy.id, 'legacy');

  libraryKeys.migrateLibrary = async () => {
    throw new Error('simulated crash mid-migration');
  };
  await assert.rejects(libraryKeys.provisionWithPassword(legacy, PASSWORD), /simulated crash/);
  libraryKeys.migrateLibrary = realMigrateLibrary;

  const crashed = await prisma.user.findUniqueOrThrow({ where: { id: legacy.id } });
  assert.equal(crashed.dataEncryptionVersion, 1, 'the DEK is durable even when the rewrite crashed');
  assert.equal(crashed.libraryState, LIBRARY_STATE.MIGRATING, 'a crash leaves an explicit resume marker');
  assert.ok(crashed.dekKdfSalt && crashed.dekPasswordWrapped && crashed.dekServerWrapped);
  const durableDek = await libraryKeys.unwrapWithServerKek(crashed.dekServerWrapped);
  const stillPlain = await prisma.bookmark.findUniqueOrThrow({ where: { id: seeded.first.id } });
  assert.equal(isLibraryCiphertext(stillPlain.url), false, 'rows are still plaintext after the crash');

  // Simulate a half-finished pass: one row already sealed with the durable DEK.
  const halfSealed = crypto.sealBookmark(legacy.id, seeded.first.id, {
    url: stillPlain.url,
    title: stillPlain.title,
  }, durableDek);
  await prisma.bookmark.update({ where: { id: seeded.first.id }, data: halfSealed });

  // The next sign-in must adopt the same DEK and finish the rewrite.
  const resumedLogin = await auth.login(
    { identifier: 'legacy-crash@example.test', password: PASSWORD },
    meta,
  );
  assert.ok(resumedLogin.tokens, 'the resuming sign-in succeeds');
  const resumedDek = await dekFromSession(resumedLogin.tokens.accessToken, resumedLogin.session.id);
  assert.ok(resumedDek.equals(durableDek), 'the resume path reuses the durable DEK instead of minting one');

  const healed = await prisma.user.findUniqueOrThrow({ where: { id: legacy.id } });
  assert.equal(healed.libraryState, LIBRARY_STATE.ENCRYPTED, 'a complete pass marks the account encrypted');

  const resealed = await prisma.bookmark.findUniqueOrThrow({ where: { id: seeded.first.id } });
  assert.equal(resealed.url, halfSealed.url, 'already-sealed rows are not re-encrypted (idempotent)');
  const openedFirst = crypto.openBookmark(resealed, durableDek);
  assert.equal(openedFirst.title, 'legacy one');

  const second = await prisma.bookmark.findUniqueOrThrow({ where: { id: seeded.second.id } });
  assert.ok(isLibraryCiphertext(second.url) && isLibraryCiphertext(second.title), 'remaining rows sealed');
  assert.equal(crypto.openBookmark(second, durableDek).title, 'legacy two');

  const healedFolder = await prisma.folder.findUniqueOrThrow({ where: { id: seeded.folder.id } });
  assert.ok(isLibraryCiphertext(healedFolder.name));
  assert.equal(crypto.openFolder(healedFolder, durableDek).name, 'legacy folder');

  const healedTag = await prisma.tag.findUniqueOrThrow({ where: { id: seeded.tag.id } });
  assert.ok(isLibraryCiphertext(healedTag.name));
  assert.equal(healedTag.normalizedName, crypto.tagIndex(legacy.id, 'legacy tag', durableDek), 'the tag blind index was rewritten');

  // A completed account is a no-op on later sign-ins.
  const repeat = await libraryKeys.provisionWithPassword(healed, PASSWORD);
  assert.ok(repeat.dek.equals(durableDek));

  // --- 1b. concurrent legacy logins share one DEK -------------------------
  const racer = await createUser('legacy-race@example.test');
  const raced = await seedLibrary(racer.id, 'race');
  const snapshots = await Promise.all(
    Array.from({ length: 4 }, () => prisma.user.findUniqueOrThrow({ where: { id: racer.id } })),
  );
  const provisions = await Promise.allSettled(
    snapshots.map((snapshot) => libraryKeys.provisionWithPassword(snapshot, PASSWORD)),
  );
  for (const result of provisions) {
    assert.equal(result.status, 'fulfilled', `every concurrent login must succeed (${result.reason?.message})`);
  }
  const deks = provisions.map((result) => result.value.dek);
  for (const dek of deks) assert.ok(dek.equals(deks[0]), 'concurrent logins must not mint competing DEKs');

  const racedUser = await prisma.user.findUniqueOrThrow({ where: { id: racer.id } });
  assert.equal(racedUser.libraryState, LIBRARY_STATE.ENCRYPTED, 'the winning login finishes the state machine');
  const racedBookmark = await prisma.bookmark.findUniqueOrThrow({ where: { id: raced.first.id } });
  for (const dek of deks) {
    assert.equal(crypto.openBookmark(racedBookmark, dek).url, 'https://example.test/race/one');
  }

  // Two real logins in parallel also converge on that one key.
  const loginResults = await Promise.all([
    auth.login({ identifier: 'legacy-race@example.test', password: PASSWORD }, meta),
    auth.login({ identifier: 'legacy-race@example.test', password: PASSWORD }, meta),
  ]);
  for (const result of loginResults) {
    const dek = await dekFromSession(result.tokens.accessToken, result.session.id);
    assert.ok(dek.equals(deks[0]), 'logins after the migration unwrap the same DEK');
    assert.equal(result.user.libraryEncrypted, true);
  }

  // --- 1c. stale credential snapshot cannot install key material ----------
  const staleUser = await createUser('legacy-stale@example.test');
  const staleSnapshot = await prisma.user.findUniqueOrThrow({ where: { id: staleUser.id } });
  await prisma.user.update({
    where: { id: staleUser.id },
    data: { passwordHash: await bcrypt.hash('a password that raced us', 10) },
  });
  await assert.rejects(libraryKeys.provisionWithPassword(staleSnapshot, PASSWORD), (err) => {
    assert.equal(err.code, ErrorCode.INVALID_CREDENTIALS);
    return true;
  });
  const staleAfter = await prisma.user.findUniqueOrThrow({ where: { id: staleUser.id } });
  assert.equal(staleAfter.dekKdfSalt, null, 'a stale login never writes key material');
  assert.equal(staleAfter.dataEncryptionVersion, 0);

  // --- 1d. existing partially migrated v1 account recovers -----------------
  const backfilled = await createUser('backfilled@example.test');
  const keyMaterial = await libraryKeys.createKeyMaterial(PASSWORD);
  await prisma.user.update({
    where: { id: backfilled.id },
    data: {
      dekKdfSalt: keyMaterial.dekKdfSalt,
      dekPasswordWrapped: keyMaterial.dekPasswordWrapped,
      dekServerWrapped: keyMaterial.dekServerWrapped,
      dataEncryptionVersion: keyMaterial.dataEncryptionVersion,
      // How the backfill migration marks pre-existing encrypted accounts.
      libraryState: LIBRARY_STATE.MIGRATING,
    },
  });
  const plainRow = await prisma.bookmark.create({
    data: {
      userId: backfilled.id,
      url: 'https://example.test/backfilled/plain',
      domain: 'example.test',
      title: 'left plaintext by a crash',
    },
  });
  const sealedId = randomUUID();
  const sealedRow = await prisma.bookmark.create({
    data: {
      id: sealedId,
      userId: backfilled.id,
      ...crypto.sealBookmark(
        backfilled.id,
        sealedId,
        { url: 'https://example.test/backfilled/sealed', domain: 'example.test', title: 'already sealed' },
        keyMaterial.dek,
      ),
    },
  });
  const backfilledLogin = await auth.login(
    { identifier: 'backfilled@example.test', password: PASSWORD },
    meta,
  );
  const backfilledDek = await dekFromSession(
    backfilledLogin.tokens.accessToken,
    backfilledLogin.session.id,
  );
  assert.ok(backfilledDek.equals(keyMaterial.dek), 'recovery keeps the account DEK');
  const repairedPlain = await prisma.bookmark.findUniqueOrThrow({ where: { id: plainRow.id } });
  assert.ok(isLibraryCiphertext(repairedPlain.url), 'the leftover plaintext row is sealed');
  assert.equal(crypto.openBookmark(repairedPlain, keyMaterial.dek).title, 'left plaintext by a crash');
  const untouchedSealed = await prisma.bookmark.findUniqueOrThrow({ where: { id: sealedRow.id } });
  assert.equal(untouchedSealed.url, sealedRow.url, 'already-encrypted rows stay byte-identical');
  assert.equal(
    (await prisma.user.findUniqueOrThrow({ where: { id: backfilled.id } })).libraryState,
    LIBRARY_STATE.ENCRYPTED,
  );

  // Legacy sessions without a wrapped DEK can still read the library.
  const legacySession = await prisma.session.create({
    data: {
      userId: backfilled.id,
      accessTokenHash: 'legacy-access-hash',
      accessTokenExpiresAt: new Date(Date.now() + 60_000),
      refreshTokenHash: 'legacy-refresh-hash',
      refreshTokenExpiresAt: new Date(Date.now() + 60_000),
    },
  });
  assert.ok(legacySession.dekWrapped === null);
  const hydrated = await libraryKeys.resolveServerDek(backfilled.id);
  assert.ok(hydrated && hydrated.equals(keyMaterial.dek), 'dek-less sessions hydrate from the server wrap');
  assert.equal(await libraryKeys.resolveServerDek(legacy.id + '-missing'), null);
  assert.equal(await libraryKeys.resolveServerDek(staleUser.id), null, 'plaintext accounts stay plaintext');

  // --- 2a. password reset OTP is single-use under parallelism --------------
  const resetUser = await createUser('reset-parallel@example.test');
  const resetMaterial = await libraryKeys.createKeyMaterial(PASSWORD);
  await prisma.user.update({
    where: { id: resetUser.id },
    data: {
      dekKdfSalt: resetMaterial.dekKdfSalt,
      dekPasswordWrapped: resetMaterial.dekPasswordWrapped,
      dekServerWrapped: resetMaterial.dekServerWrapped,
      dataEncryptionVersion: resetMaterial.dataEncryptionVersion,
      libraryState: LIBRARY_STATE.ENCRYPTED,
    },
  });
  const resetSealedId = randomUUID();
  const resetLibraryRow = await prisma.bookmark.create({
    data: {
      id: resetSealedId,
      userId: resetUser.id,
      ...crypto.sealBookmark(
        resetUser.id,
        resetSealedId,
        { url: 'https://example.test/reset/library', domain: 'example.test', title: 'private' },
        resetMaterial.dek,
      ),
    },
  });
  const resetSession = await prisma.session.create({
    data: {
      userId: resetUser.id,
      accessTokenHash: 'reset-old-access',
      accessTokenExpiresAt: new Date(Date.now() + 60_000),
      refreshTokenHash: 'reset-old-refresh',
      refreshTokenExpiresAt: new Date(Date.now() + 60_000),
    },
  });
  await mfa.createLoginChallenge(resetUser, resetMaterial.dek);
  assert.equal(
    await prisma.mfaChallenge.count({ where: { userId: resetUser.id } }),
    1,
    'a pending MFA sign-in exists before the reset',
  );
  await otp(resetUser.id, EMAIL_OTP_PURPOSE.PASSWORD_RESET, '111111');

  const resetAttempts = await Promise.allSettled([
    auth.resetPassword('reset-parallel@example.test', '111111', 'first new password'),
    auth.resetPassword('reset-parallel@example.test', '111111', 'second new password'),
  ]);
  const fulfilled = resetAttempts.filter((result) => result.status === 'fulfilled');
  const rejected = resetAttempts.filter((result) => result.status === 'rejected');
  assert.equal(fulfilled.length, 1, 'exactly one of two parallel resets with the same OTP may win');
  assert.equal(rejected.length, 1);
  assert.equal(rejected[0].reason.code, ErrorCode.INVALID_VERIFICATION_TOKEN);

  const afterReset = await prisma.user.findUniqueOrThrow({ where: { id: resetUser.id } });
  const winnerPassword = (await bcrypt.compare('first new password', afterReset.passwordHash))
    ? 'first new password'
    : 'second new password';
  assert.ok(await bcrypt.compare(winnerPassword, afterReset.passwordHash));
  assert.equal(await prisma.session.count({ where: { userId: resetUser.id } }), 0, 'reset revokes sessions');
  assert.equal(await prisma.session.findUnique({ where: { id: resetSession.id } }), null);
  assert.equal(
    await prisma.mfaChallenge.count({ where: { userId: resetUser.id } }),
    0,
    'reset kills MFA challenges that stash the old DEK',
  );
  assert.ok(
    await prisma.emailVerificationToken.findFirstOrThrow({
      where: { userId: resetUser.id, purpose: EMAIL_OTP_PURPOSE.PASSWORD_RESET },
    }),
    'the reset token row is retired, not duplicated',
  );
  const resetLogin = await auth.login(
    { identifier: 'reset-parallel@example.test', password: winnerPassword },
    meta,
  );
  const resetDek = await dekFromSession(resetLogin.tokens.accessToken, resetLogin.session.id);
  assert.ok(resetDek.equals(resetMaterial.dek), 'reset re-wraps the same library DEK');
  const resetRow = await prisma.bookmark.findUniqueOrThrow({ where: { id: resetLibraryRow.id } });
  assert.equal(crypto.openBookmark(resetRow, resetDek).title, 'private');

  // --- 2b. an OTP that hit the attempt cap never resets --------------------
  const cappedUser = await createUser('reset-capped@example.test');
  const cappedToken = await otp(cappedUser.id, EMAIL_OTP_PURPOSE.PASSWORD_RESET, '222222');
  await prisma.emailVerificationToken.update({
    where: { id: cappedToken.id },
    data: { attempts: EMAIL_OTP.MAX_ATTEMPTS },
  });
  await assert.rejects(
    auth.resetPassword('reset-capped@example.test', '222222', 'capped new password'),
    (err) => {
      assert.equal(err.code, ErrorCode.INVALID_VERIFICATION_TOKEN);
      return true;
    },
  );
  const cappedAfter = await prisma.user.findUniqueOrThrow({ where: { id: cappedUser.id } });
  assert.equal(await bcrypt.compare(PASSWORD, cappedAfter.passwordHash), true, 'a capped OTP leaves the password alone');
  assert.ok(
    (await prisma.emailVerificationToken.findUniqueOrThrow({ where: { id: cappedToken.id } })).consumedAt,
    'the capped row is retired',
  );

  // --- 2c. resetting an account that never installed a key -----------------
  const legacyResetUser = await createUser('reset-legacy@example.test');
  const legacyResetRows = await seedLibrary(legacyResetUser.id, 'legacy-reset');
  await prisma.session.create({
    data: {
      userId: legacyResetUser.id,
      accessTokenHash: 'legacy-reset-access',
      accessTokenExpiresAt: new Date(Date.now() + 60_000),
      refreshTokenHash: 'legacy-reset-refresh',
      refreshTokenExpiresAt: new Date(Date.now() + 60_000),
    },
  });
  await otp(legacyResetUser.id, EMAIL_OTP_PURPOSE.PASSWORD_RESET, '777777');
  await auth.resetPassword('reset-legacy@example.test', '777777', 'legacy reset password');
  const resetLegacyRow = await prisma.user.findUniqueOrThrow({ where: { id: legacyResetUser.id } });
  assert.equal(resetLegacyRow.dataEncryptionVersion, 0, 'a plaintext account stays plaintext until it signs in');
  assert.equal(await prisma.session.count({ where: { userId: legacyResetUser.id } }), 0);
  const resetLegacyLogin = await auth.login(
    { identifier: 'reset-legacy@example.test', password: 'legacy reset password' },
    meta,
  );
  const resetLegacyDek = await dekFromSession(
    resetLegacyLogin.tokens.accessToken,
    resetLegacyLogin.session.id,
  );
  const resetLegacyBookmark = await prisma.bookmark.findUniqueOrThrow({
    where: { id: legacyResetRows.first.id },
  });
  assert.ok(isLibraryCiphertext(resetLegacyBookmark.url), 'the first sign-in after reset still encrypts');
  assert.equal(crypto.openBookmark(resetLegacyBookmark, resetLegacyDek).title, 'legacy-reset one');

  // --- 2d. email verification OTP is single-use ----------------------------
  const verifyUser = await createUser('verify-race@example.test', { emailVerifiedAt: null });
  await otp(verifyUser.id, EMAIL_OTP_PURPOSE.VERIFY, '888888');
  const verifyAttempts = await Promise.allSettled([
    auth.verifyEmail('verify-race@example.test', '888888'),
    auth.verifyEmail('verify-race@example.test', '888888'),
  ]);
  assert.equal(
    verifyAttempts.filter((result) => result.status === 'fulfilled').length,
    1,
    'one verification code confirms once',
  );
  const verifyRejected = verifyAttempts.find((result) => result.status === 'rejected');
  assert.equal(verifyRejected.reason.code, ErrorCode.INVALID_VERIFICATION_TOKEN);
  assert.ok(
    (await prisma.user.findUniqueOrThrow({ where: { id: verifyUser.id } })).emailVerifiedAt,
    'the account is verified by the winning request',
  );

  // --- 2e. concurrent login challenges leave exactly one live token --------
  const challengeUser = await createUser('challenge-race@example.test', {
    totpSecretEnc: 'not-used-here',
    totpEnabledAt: new Date(),
  });
  const challengePair = await Promise.all([
    mfa.createLoginChallenge(challengeUser),
    mfa.createLoginChallenge(challengeUser),
  ]);
  const liveChallenges = await prisma.mfaChallenge.findMany({
    where: { userId: challengeUser.id, purpose: MFA_CHALLENGE_PURPOSE.LOGIN },
  });
  assert.equal(liveChallenges.length, 1, 'one pending login challenge at most');
  const liveHashes = new Set(liveChallenges.map((row) => row.tokenHash));
  assert.equal(
    challengePair.filter((challenge) => liveHashes.has(tokens.hash(challenge.challengeToken))).length,
    1,
    'only the last challenge token is usable',
  );

  // --- 2f. concurrent resends leave exactly one live code ----------------
  const resendUser = await createUser('resend-race@example.test', { emailVerifiedAt: null });
  await Promise.all([
    auth.requestPasswordReset('resend-race@example.test'),
    auth.requestPasswordReset('resend-race@example.test'),
  ]);
  assert.equal(
    await prisma.emailVerificationToken.count({
      where: { userId: resendUser.id, purpose: EMAIL_OTP_PURPOSE.PASSWORD_RESET },
    }),
    1,
    'two parallel reset emails leave one usable code',
  );
  await Promise.all([
    auth.resendVerification('resend-race@example.test'),
    auth.resendVerification('resend-race@example.test'),
  ]);
  assert.equal(
    await prisma.emailVerificationToken.count({
      where: { userId: resendUser.id, purpose: EMAIL_OTP_PURPOSE.VERIFY },
    }),
    1,
    'two parallel verification resends leave one usable code',
  );
  // --- 3a. a login that lost the revocation race never mints a session ----
  const raceUser = await createUser('login-race@example.test');
  let releaseLogin;
  let loginProvisioned;
  const loginGate = new Promise((resolve) => { releaseLogin = resolve; });
  const provisioned = new Promise((resolve) => { loginProvisioned = resolve; });
  libraryKeys.provisionWithPassword = async (user, password) => {
    const result = await libraryKeys.constructor.prototype.provisionWithPassword.call(
      libraryKeys,
      user,
      password,
    );
    loginProvisioned();
    await loginGate;
    return result;
  };
  const racingLogin = auth.login(
    { identifier: 'login-race@example.test', password: PASSWORD },
    meta,
  ).then(
    (value) => ({ ok: true, value }),
    (error) => ({ ok: false, error }),
  );
  await provisioned;
  await otp(raceUser.id, EMAIL_OTP_PURPOSE.PASSWORD_RESET, '333333');
  await auth.resetPassword('login-race@example.test', '333333', 'the reset that won');
  releaseLogin();
  const loginOutcome = await racingLogin;
  assert.equal(loginOutcome.ok, false, 'the in-flight login must not create a session after revocation');
  assert.ok(isCredentialsChanged(loginOutcome.error), `expected a stale-credential rejection, got ${loginOutcome.error?.code}`);
  assert.equal(
    await prisma.session.count({ where: { userId: raceUser.id } }),
    0,
    'no session survives the reset it raced',
  );
  libraryKeys.provisionWithPassword = libraryKeys.constructor.prototype.provisionWithPassword.bind(libraryKeys);

  // The same guard is visible directly on session creation.
  const directUser = await createUser('login-direct@example.test');
  await assert.rejects(
    sessions.create(directUser.id, meta, null, {
      passwordHash: 'a-stale-hash',
      totpEnabledAt: null,
      totpSecretEnc: null,
    }),
    (err) => {
      assert.ok(isCredentialsChanged(err), 'session creation refuses a snapshot that no longer matches');
      return true;
    },
  );
  assert.equal(await prisma.session.count({ where: { userId: directUser.id } }), 0);
  // The guard write is a no-op: logging in must not touch the credential row.
  await sessions.create(directUser.id, meta, null, {
    passwordHash: directUser.passwordHash,
    totpEnabledAt: directUser.totpEnabledAt,
    totpSecretEnc: directUser.totpSecretEnc,
  });
  const directAfter = await prisma.user.findUniqueOrThrow({ where: { id: directUser.id } });
  assert.equal(directAfter.updatedAt.getTime(), directUser.updatedAt.getTime(), 'the guard write leaves updatedAt alone');
  assert.equal(await prisma.session.count({ where: { userId: directUser.id } }), 1);

  // --- 3b. MFA state snapshot is part of the session guard ----------------
  const toggleUser = await createUser('login-mfa-toggle@example.test');
  const toggleSnapshot = {
    passwordHash: toggleUser.passwordHash,
    totpEnabledAt: toggleUser.totpEnabledAt,
    totpSecretEnc: toggleUser.totpSecretEnc,
  };
  await prisma.user.update({
    where: { id: toggleUser.id },
    data: { totpSecretEnc: 'enabled-during-login', totpEnabledAt: new Date() },
  });
  await assert.rejects(
    sessions.create(toggleUser.id, meta, null, toggleSnapshot),
    (err) => {
      assert.ok(isCredentialsChanged(err), 'a login that saw no MFA cannot mint a session after MFA is enabled');
      return true;
    },
  );
  assert.equal(await prisma.session.count({ where: { userId: toggleUser.id } }), 0);

  // A correct login for an MFA user hands out a challenge, not a session.
  const mfaLoginUser = await createUser('mfa-login@example.test');
  const enroll = await mfa.beginTotp(mfaLoginUser.id);
  const enrollCode = totpFor(mfaLoginUser.email, enroll.secret).generate();
  await mfa.confirmTotp(mfaLoginUser.id, enrollCode);
  const mfaLogin = await auth.login(
    { identifier: 'mfa-login@example.test', password: PASSWORD },
    meta,
  );
  assert.equal(mfaLogin.mfaRequired, true);
  assert.equal(await prisma.session.count({ where: { userId: mfaLoginUser.id } }), 0);

  // --- 4a. TOTP enrollment has exactly one winner -------------------------
  for (const action of ['begin', 'regenerate', 'disable']) {
    const stepUser = await createUser(`stale-step-${action}@example.test`);
    const enrollment = await mfa.beginTotp(stepUser.id);
    const code = totpFor(stepUser.email, enrollment.secret).generate();
    await mfa.confirmTotp(stepUser.id, code);
    let entered;
    let release;
    const ready = new Promise(resolve => { entered = resolve; });
    const gate = new Promise(resolve => { release = resolve; });
    const stepUp = mfa.assertStepUp.bind(mfa);
    mfa.assertStepUp = async (...args) => { await stepUp(...args); entered(); await gate; };
    const pending = action === 'begin' ? mfa.beginTotp(stepUser.id, code)
      : action === 'regenerate' ? mfa.regenerateBackupCodes(stepUser.id, code)
      : mfa.disableTotp(stepUser.id, code);
    pending.catch(() => {});
    await ready;
    mfa.assertStepUp = stepUp;
    await mfa.disableMfa(stepUser.id);
    if (action === 'disable') {
      const replacement = await mfa.beginTotp(stepUser.id);
      await mfa.confirmTotp(stepUser.id, totpFor(stepUser.email, replacement.secret).generate());
    }
    release();
    await assert.rejects(pending, isCredentialsChanged, `a stale ${action} cannot change newer MFA state`);
    if (action === 'begin') assert.equal(await prisma.mfaChallenge.count({ where: { userId: stepUser.id } }), 0);
    if (action === 'regenerate') assert.equal(await prisma.mfaBackupCode.count({ where: { userId: stepUser.id } }), 0);
    if (action === 'disable') assert.equal((await mfa.status(stepUser.id)).totpEnabled, true);
  }

  const enrollUser = await createUser('totp-race@example.test');
  const pendingEnroll = await mfa.beginTotp(enrollUser.id);
  const enrollCodeA = totpFor(enrollUser.email, pendingEnroll.secret).generate();
  const confirmations = await Promise.allSettled([
    mfa.confirmTotp(enrollUser.id, enrollCodeA),
    mfa.confirmTotp(enrollUser.id, enrollCodeA),
  ]);
  assert.equal(
    confirmations.filter((result) => result.status === 'fulfilled').length,
    1,
    'only one concurrent confirmation may install the authenticator',
  );
  const rejectedConfirm = confirmations.find((result) => result.status === 'rejected');
  assert.equal(rejectedConfirm.reason.code, ErrorCode.MFA_INVALID);
  assert.equal(
    await prisma.mfaBackupCode.count({ where: { userId: enrollUser.id } }),
    MFA.BACKUP_CODE_COUNT,
    'the losing confirmation does not rotate the backup codes',
  );
  const enrolledUser = await prisma.user.findUniqueOrThrow({ where: { id: enrollUser.id } });
  assert.ok(enrolledUser.totpEnabledAt);
  assert.equal(
    await prisma.mfaChallenge.count({ where: { userId: enrollUser.id, purpose: MFA_CHALLENGE_PURPOSE.ENROLL } }),
    0,
  );

  // --- 4b. a stale enrollment cannot hijack a replaced one ----------------
  const replaceUser = await createUser('totp-replace@example.test');
  const replaced = await mfa.beginTotp(replaceUser.id);
  const replacement = await mfa.beginTotp(replaceUser.id);
  const staleEnrollCode = totpFor(replaceUser.email, replaced.secret).generate();
  await assert.rejects(mfa.confirmTotp(replaceUser.id, staleEnrollCode), (err) => {
    assert.equal(err.code, ErrorCode.MFA_INVALID);
    return true;
  });
  assert.equal(
    (await prisma.user.findUniqueOrThrow({ where: { id: replaceUser.id } })).totpEnabledAt,
    null,
    'the replaced enrollment was not installed',
  );
  const replacementCode = totpFor(replaceUser.email, replacement.secret).generate();
  await mfa.confirmTotp(replaceUser.id, replacementCode);

  // Cancelled enrollment: disabling MFA removes the pending secret.
  const cancelledUser = await createUser('totp-cancel@example.test');
  const cancelled = await mfa.beginTotp(cancelledUser.id);
  await mfa.disableMfa(cancelledUser.id);
  await assert.rejects(
    mfa.confirmTotp(cancelledUser.id, totpFor(cancelledUser.email, cancelled.secret).generate()),
    (err) => {
      assert.equal(err.code, ErrorCode.MFA_INVALID);
      return true;
    },
  );

  // Expired and capped enrollments are refused as well.
  const expiredUser = await createUser('totp-expired@example.test');
  const expired = await mfa.beginTotp(expiredUser.id);
  await prisma.mfaChallenge.updateMany({
    where: { userId: expiredUser.id, purpose: MFA_CHALLENGE_PURPOSE.ENROLL },
    data: { expiresAt: new Date(Date.now() - 1000) },
  });
  await assert.rejects(
    mfa.confirmTotp(expiredUser.id, totpFor(expiredUser.email, expired.secret).generate()),
    (err) => {
      assert.equal(err.code, ErrorCode.MFA_INVALID);
      return true;
    },
  );
  const cappedEnrollUser = await createUser('totp-capped@example.test');
  const cappedEnroll = await mfa.beginTotp(cappedEnrollUser.id);
  await prisma.mfaChallenge.updateMany({
    where: { userId: cappedEnrollUser.id, purpose: MFA_CHALLENGE_PURPOSE.ENROLL },
    data: { attempts: MFA.CHALLENGE_MAX_ATTEMPTS },
  });
  await assert.rejects(
    mfa.confirmTotp(
      cappedEnrollUser.id,
      totpFor(cappedEnrollUser.email, cappedEnroll.secret).generate(),
    ),
    (err) => {
      assert.equal(err.code, ErrorCode.MFA_INVALID);
      return true;
    },
  );

  // --- 5. MFA login completion claims -------------------------------------
  const completionSecret = encryptedSecretOf(enrolledUser);
  const validCode = () => totpFor(enrolledUser.email, completionSecret).generate();

  const expiredChallenge = await mfa.createLoginChallenge(enrolledUser);
  await prisma.mfaChallenge.updateMany({
    where: { userId: enrolledUser.id, purpose: MFA_CHALLENGE_PURPOSE.LOGIN },
    data: { expiresAt: new Date(Date.now() - 1000) },
  });
  await assert.rejects(mfa.consumeLoginCode(expiredChallenge.challengeToken, validCode()), (err) => {
    assert.equal(err.code, ErrorCode.MFA_INVALID);
    return true;
  });

  const cappedChallenge = await mfa.createLoginChallenge(enrolledUser);
  await prisma.mfaChallenge.updateMany({
    where: { userId: enrolledUser.id, purpose: MFA_CHALLENGE_PURPOSE.LOGIN },
    data: { attempts: MFA.CHALLENGE_MAX_ATTEMPTS },
  });
  await assert.rejects(mfa.consumeLoginCode(cappedChallenge.challengeToken, validCode()), (err) => {
    assert.equal(err.code, ErrorCode.MFA_INVALID);
    return true;
  });

  const doubleChallenge = await mfa.createLoginChallenge(enrolledUser);
  const doubleClaim = await Promise.allSettled([
    mfa.consumeLoginCode(doubleChallenge.challengeToken, validCode()),
    mfa.consumeLoginCode(doubleChallenge.challengeToken, validCode()),
  ]);
  assert.equal(
    doubleClaim.filter((result) => result.status === 'fulfilled').length,
    1,
    'a login challenge mints at most one completion',
  );

  // Email recovery OTP: single consumption and challenge claim.
  const recoveryChallengeA = await mfa.createLoginChallenge(enrolledUser);
  await otp(enrolledUser.id, EMAIL_OTP_PURPOSE.MFA_RECOVERY, '444444');
  const recoveryClaims = await Promise.allSettled([
    mfa.consumeEmailRecovery(recoveryChallengeA.challengeToken, '444444'),
    mfa.consumeEmailRecovery(recoveryChallengeA.challengeToken, '444444'),
  ]);
  assert.equal(
    recoveryClaims.filter((result) => result.status === 'fulfilled').length,
    1,
    'a recovery OTP completes at most one login',
  );

  const recoveryChallengeB = await mfa.createLoginChallenge(enrolledUser);
  await otp(enrolledUser.id, EMAIL_OTP_PURPOSE.MFA_RECOVERY, '555555');
  await prisma.mfaChallenge.updateMany({
    where: { userId: enrolledUser.id, purpose: MFA_CHALLENGE_PURPOSE.LOGIN },
    data: { expiresAt: new Date(Date.now() - 1000) },
  });
  await assert.rejects(
    mfa.consumeEmailRecovery(recoveryChallengeB.challengeToken, '555555'),
    (err) => {
      assert.equal(err.code, ErrorCode.MFA_INVALID);
      return true;
    },
  );

  // A capped recovery OTP is refused without a second guess.
  const cappedRecoveryChallenge = await mfa.createLoginChallenge(enrolledUser);
  const cappedRecovery = await otp(enrolledUser.id, EMAIL_OTP_PURPOSE.MFA_RECOVERY, '666666');
  await prisma.emailVerificationToken.update({
    where: { id: cappedRecovery.id },
    data: { attempts: EMAIL_OTP.MAX_ATTEMPTS },
  });
  await assert.rejects(
    mfa.consumeEmailRecovery(cappedRecoveryChallenge.challengeToken, '666666'),
    (err) => {
      assert.equal(err.code, ErrorCode.INVALID_VERIFICATION_TOKEN);
      return true;
    },
  );

  // --- 5b. concurrent recovery emails leave one live code -----------------
  const recoveryResendChallenge = await mfa.createLoginChallenge(enrolledUser);
  await Promise.all([
    mfa.requestEmailRecovery(recoveryResendChallenge.challengeToken),
    mfa.requestEmailRecovery(recoveryResendChallenge.challengeToken),
  ]);
  assert.equal(
    await prisma.emailVerificationToken.count({
      where: { userId: enrolledUser.id, purpose: EMAIL_OTP_PURPOSE.MFA_RECOVERY },
    }),
    1,
    'two parallel recovery emails leave one usable code',
  );

  // A recovery request paused after reading its user/challenge cannot issue
  // to a retired mailbox or replace the code for a newer login challenge.
  for (const invalidation of ['email', 'challenge']) {
    const recoveryUser = await createUser(`recovery-stale-${invalidation}@example.test`);
    const setup = await mfa.beginTotp(recoveryUser.id);
    const code = () => totpFor(recoveryUser.email, setup.secret).generate();
    await mfa.confirmTotp(recoveryUser.id, code());
    let current = await prisma.user.findUniqueOrThrow({ where: { id: recoveryUser.id } });
    let challenge = await mfa.createLoginChallenge(current);
    let entered;
    let release;
    const ready = new Promise(resolve => { entered = resolve; });
    const gate = new Promise(resolve => { release = resolve; });
    const issue = mfa.createAndSendRecoveryOtp.bind(mfa);
    mfa.createAndSendRecoveryOtp = async (...args) => { entered(); await gate; return issue(...args); };
    const stale = mfa.requestEmailRecovery(challenge.challengeToken);
    stale.catch(() => {});
    await ready;
    mfa.createAndSendRecoveryOtp = issue;
    if (invalidation === 'email') {
      const send = mail.sendVerification;
      let emailCode;
      mail.sendVerification = async (_email, token) => { emailCode = token; };
      await auth.requestEmailChange(current.id, PASSWORD, 'recovery-new@example.test', code());
      await auth.verifyEmailChange(current.id, emailCode);
      mail.sendVerification = send;
      current = await prisma.user.findUniqueOrThrow({ where: { id: current.id } });
    } else {
      challenge = await mfa.createLoginChallenge(current);
    }
    const sendRecovery = mail.sendMfaRecovery;
    const deliveries = [];
    mail.sendMfaRecovery = async (email, token) => { deliveries.push({ email, token }); };
    await mfa.requestEmailRecovery(challenge.challengeToken);
    const freshCode = await prisma.emailVerificationToken.findFirstOrThrow({
      where: { userId: current.id, purpose: EMAIL_OTP_PURPOSE.MFA_RECOVERY },
    });
    release();
    await assert.rejects(stale, err => err.code === ErrorCode.MFA_INVALID);
    assert.equal((await prisma.emailVerificationToken.findFirstOrThrow({
      where: { userId: current.id, purpose: EMAIL_OTP_PURPOSE.MFA_RECOVERY },
    })).id, freshCode.id, 'a stale recovery request preserves the newer code');
    assert.deepEqual(deliveries.map(delivery => delivery.email), [current.email], 'only the current mailbox receives a recovery code');
    mail.sendMfaRecovery = sendRecovery;
  }

  // --- 6. the schema migration backfills the explicit state ----------------
  const upgradeDb = path.join(directory, 'upgrade.db');
  const migrationsDir = path.resolve(__dirname, '../prisma/migrations');
  const migrationNames = readdirSync(migrationsDir)
    .filter((name) => name !== 'migration_lock.toml')
    .sort();
  const backfillName = '20261108010000_library_migration_state';
  assert.ok(migrationNames.includes(backfillName), 'the library state migration exists');

  // Build a database that is migrated exactly up to the release before this
  // change, so the new migration runs through the real boot path.
  const preDir = path.join(directory, 'pre-migrations');
  for (const name of migrationNames.filter((migration) => migration < backfillName)) {
    mkdirSync(path.join(preDir, name), { recursive: true });
    copyFileSync(path.join(migrationsDir, name, 'migration.sql'), path.join(preDir, name, 'migration.sql'));
  }
  const upgradeClient = new PrismaClient({ adapter: createPrismaAdapter(`file:${upgradeDb}`) });
  try {
    await ensurePrismaSchema(upgradeClient, {
      databaseUrl: `file:${upgradeDb}`,
      migrationsDir: preDir,
    });
    const seed = new Database(upgradeDb);
    seed.exec(`
      INSERT INTO "User" ("id","displayName","email","passwordHash","dataEncryptionVersion","createdAt","updatedAt")
      VALUES ('encrypted-user','U','encrypted@example.test','hash',1,datetime('now'),datetime('now')),
             ('plaintext-user','U','plaintext@example.test','hash',0,datetime('now'),datetime('now'))
    `);
    seed.close();

    await ensurePrismaSchema(upgradeClient, {
      databaseUrl: `file:${upgradeDb}`,
      migrationsDir,
    });
    const states = await upgradeClient.$queryRawUnsafe(
      'SELECT "id", "libraryState" AS state FROM "User" ORDER BY "id"',
    );
    assert.deepEqual(states, [
      { id: 'encrypted-user', state: LIBRARY_STATE.MIGRATING },
      { id: 'plaintext-user', state: LIBRARY_STATE.PLAINTEXT },
    ], 'already-encrypted accounts get one verification pass; plaintext accounts are untouched');
  } finally {
    await upgradeClient.$disconnect();
  }

  console.log(
    'PASS: library key claim/resume/concurrency, reset OTP single-use, session credential guards, MFA enrollment and completion claims',
  );
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
}).finally(async () => {
  await prisma.$disconnect();
  rmSync(directory, { recursive: true, force: true });
});

/** Decrypt the stored TOTP secret the same way the MFA service does. */
function encryptedSecretOf(user) {
  const { deriveKey, decryptSecret } = require('../dist/common/utils/secret-box.js');
  const key = deriveKey(config.jwtSecret, 'totp-secret-enc');
  return decryptSecret(user.totpSecretEnc, key);
}
