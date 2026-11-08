import { Inject, Injectable, Logger, type OnApplicationBootstrap, type OnModuleDestroy } from "@nestjs/common";
import bcrypt from "bcryptjs";
import { randomUUID } from "node:crypto";
import { Prisma, type Session, type User } from "../prisma/client.js";
import {
  EMAIL_OTP,
  EMAIL_OTP_PURPOSE,
  ErrorCode,
  normalizeReaderPreferences,
  type AuthResponse,
  type EmailOtpPurpose,
  type LoginResponse,
  type RegisterResponse,
  type SessionDeviceType,
  type SessionDto,
  type UpdateReaderPreferencesInput,
  type UserDto,
} from "@ordo/shared";
import { PrismaService } from "../prisma/prisma.service.js";
import { AppError } from "../common/errors/app-error.js";
import { equalHex, hashEmailOtp } from "../common/utils/tokens.js";
import { APP_CONFIG } from "../config/config.module.js";
import type { AppConfig } from "../config/config.module.js";
import { SessionService, claimCredentialSnapshot, credentialSnapshot, credentialsChangedError } from "./session.service.js";
import { TokenService } from "./token.service.js";
import { MailService } from "./mail.service.js";
import { RateLimitService } from "../common/rate-limit/rate-limit.service.js";
import { toSessionDto } from "../common/mappers.js";
import { isRegistrationOpen } from "./registration-open.js";
import { claimInstanceOwner, userDtoWithRename } from "../server/instance-admin.js";
import { MfaService } from "./mfa.service.js";
import { AvatarService } from "./avatar.service.js";
import { LibraryCryptoService } from "../crypto/library-crypto.service.js";
import { LibraryKeyService } from "../crypto/library-key.service.js";
import { DATA_ENCRYPTION_VERSION } from "../crypto/library-crypto.js";

const BCRYPT_COST = 12;
let dummyPasswordHash: Promise<string> | null = null;

function dummyBcryptCompare(password: string): Promise<boolean> {
  dummyPasswordHash ??= bcrypt.hash("ordo-timing-dummy", BCRYPT_COST);
  return dummyPasswordHash.then((hash) => bcrypt.compare(password, hash));
}

interface ClientMeta {
  deviceInfo: string;
  deviceName: string | null;
  deviceType: SessionDeviceType;
  ip: string;
}

const UNVERIFIED_SIGNUP_SWEEP_MS = 60_000;

@Injectable()
export class AuthService implements OnApplicationBootstrap, OnModuleDestroy {
  private readonly logger = new Logger(AuthService.name);
  private sweepTimer: ReturnType<typeof setInterval> | null = null;

  constructor(
    private readonly prisma: PrismaService,
    private readonly sessions: SessionService,
    private readonly tokens: TokenService,
    private readonly mail: MailService,
    @Inject(APP_CONFIG) private readonly cfg: AppConfig,
    private readonly rateLimit: RateLimitService,
    private readonly mfa: MfaService,
    private readonly avatars: AvatarService,
    private readonly crypto: LibraryCryptoService,
    private readonly libraryKeys: LibraryKeyService,
  ) {}

  onApplicationBootstrap(): void {
    void this.purgeExpiredUnverifiedSignups();
    this.sweepTimer = setInterval(() => void this.purgeExpiredUnverifiedSignups(), UNVERIFIED_SIGNUP_SWEEP_MS);
    this.sweepTimer.unref?.();
  }

  onModuleDestroy(): void {
    if (this.sweepTimer) clearInterval(this.sweepTimer);
    this.sweepTimer = null;
  }

  async register(
    input: { displayName: string; email: string; password: string },
    meta: ClientMeta,
  ): Promise<RegisterResponse> {
    if (!(await isRegistrationOpen(this.prisma, this.cfg.registrationEnabled))) {
      throw new AppError(ErrorCode.REGISTRATION_DISABLED, "This server isn't accepting new sign-ups.");
    }

    const email = input.email.toLowerCase().trim();
    const displayName = input.displayName.trim();
    const passwordHash = await bcrypt.hash(input.password, BCRYPT_COST);
    const keyMaterial = await this.libraryKeys.createKeyMaterial(input.password);
    await this.purgeExpiredUnverifiedSignups();
    const existingEmail = await this.prisma.user.findUnique({ where: { email } });
    if (existingEmail) {
      if (this.cfg.emailVerificationRequired) {
        return { pendingEmailVerification: true };
      }
      throw new AppError(ErrorCode.EMAIL_ALREADY_EXISTS, "An account with this email already exists.");
    }

    let user: User;
    try {
      user = await this.prisma.user.create({
        data: {
          id: randomUUID(),
          displayName,
          email,
          passwordHash,
          dekKdfSalt: keyMaterial.dekKdfSalt,
          dekPasswordWrapped: keyMaterial.dekPasswordWrapped,
          dekServerWrapped: keyMaterial.dekServerWrapped,
          dataEncryptionVersion: keyMaterial.dataEncryptionVersion,
          libraryState: keyMaterial.libraryState,
        },
      });
    } catch (err) {
      // Two concurrent signups with the same email race past the findUnique.
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") {
        if (this.cfg.emailVerificationRequired) {
          return { pendingEmailVerification: true };
        }
        throw new AppError(ErrorCode.EMAIL_ALREADY_EXISTS, "An account with this email already exists.");
      }
      throw err;
    }
    await claimInstanceOwner(this.prisma, user.id);

    if (this.cfg.emailVerificationRequired) {
      await this.createAndSendOtp(user.id, email, EMAIL_OTP_PURPOSE.VERIFY);
      return { pendingEmailVerification: true };
    }

    const { session, tokens } = await this.sessions.create(user.id, meta, keyMaterial.dek);
    return this.buildAuthResponse(user, session, tokens);
  }

  async login(
    input: { identifier: string; password: string },
    meta: ClientMeta,
  ): Promise<LoginResponse> {
    const email = input.identifier.trim().toLowerCase();
    const loginKeys = { accountKey: email, ip: meta.ip };

    this.rateLimit.checkLogin(loginKeys);

    await this.purgeExpiredUnverifiedSignups();
    const user = await this.prisma.user.findUnique({ where: { email } });

    if (user) {
      this.rateLimit.checkLogin({ ...loginKeys, userId: user.id });
    }

    if (!user) {
      await dummyBcryptCompare(input.password);
      this.rateLimit.recordLoginFailure(loginKeys);
      throw new AppError(ErrorCode.INVALID_CREDENTIALS, "Incorrect email or password.");
    }
    const ok = await bcrypt.compare(input.password, user.passwordHash);
    if (!ok) {
      this.rateLimit.recordLoginFailure({ ...loginKeys, userId: user.id });
      throw new AppError(ErrorCode.INVALID_CREDENTIALS, "Incorrect email or password.");
    }

    this.rateLimit.clearLogin({ accountKey: email, userId: user.id });
    this.assertEmailVerified(user);
    // Snapshot the credential state the password was verified against. Slow
    // work below (scrypt/DEK provisioning) must not be allowed to mint a
    // session if a reset/change or MFA toggle landed meanwhile.
    const verified = credentialSnapshot(user);

    const provisioned = await this.libraryKeys.provisionWithPassword(user, input.password);
    // Re-read for the response DTO (final encryption state), but keep guarding
    // on the verified snapshot rather than this newer read.
    const current = await this.prisma.user.findUnique({ where: { id: user.id } });
    if (!current) {
      throw new AppError(ErrorCode.UNAUTHORIZED, "Account not found.");
    }
    this.assertEmailVerified(current);

    if (this.mfa.isEnabled(current)) {
      return this.mfa.createLoginChallenge(current, provisioned.dek, verified);
    }

    const { session, tokens } = await this.sessions.create(
      current.id,
      meta,
      provisioned.dek,
      verified,
    );
    return this.buildAuthResponse(current, session, tokens);
  }

  async completeMfaLogin(challengeToken: string, code: string, meta: ClientMeta): Promise<AuthResponse> {
    const { user, dek } = await this.mfa.consumeLoginCode(challengeToken, code);
    this.assertEmailVerified(user);
    this.rateLimit.clearLogin({ accountKey: user.email, userId: user.id });
    const { session, tokens } = await this.sessions.create(
      user.id,
      meta,
      dek,
      credentialSnapshot(user),
    );
    return this.buildAuthResponse(user, session, tokens);
  }

  async requestMfaEmailRecovery(challengeToken: string): Promise<void> {
    await this.mfa.requestEmailRecovery(challengeToken);
  }

  async completeMfaEmailRecovery(
    challengeToken: string,
    otp: string,
    meta: ClientMeta,
  ): Promise<AuthResponse> {
    const { user, dek } = await this.mfa.consumeEmailRecovery(challengeToken, otp);
    this.assertEmailVerified(user);
    this.rateLimit.clearLogin({ accountKey: user.email, userId: user.id });
    const { session, tokens } = await this.sessions.create(
      user.id,
      meta,
      dek,
      credentialSnapshot(user),
    );
    return this.buildAuthResponse(user, session, tokens);
  }

  async refresh(refreshToken: string | null | undefined, meta?: Omit<ClientMeta, "ip">): Promise<AuthResponse> {
    if (!refreshToken) {
      throw new AppError(ErrorCode.SESSION_REVOKED, "Your session has ended. Please sign in again.");
    }
    const { session, tokens } = await this.sessions.rotate(refreshToken, meta);
    const user = await this.prisma.user.findUnique({ where: { id: session.userId } });
    if (!user) {
      await this.sessions.revokeByAccessHash(tokens.accessHash).catch(() => undefined);
      throw new AppError(ErrorCode.SESSION_REVOKED, "Your session has ended. Please sign in again.");
    }
    try {
      this.assertEmailVerified(user);
    } catch (err) {
      await this.sessions.revokeByAccessHash(tokens.accessHash).catch(() => undefined);
      throw err;
    }
    return this.buildAuthResponse(user, session, tokens);
  }

  async logout(sessionId: string, accessToken: string | null): Promise<void> {
    if (accessToken) {
      // revoke by access hash covers the rotating-token case robustly
      await this.sessions.revokeByAccessToken(accessToken).catch(() => undefined);
    }
    // The access token can be stale after a concurrent refresh rotated it out;
    // always drop the session row too so logout can't silently no-op.
    await this.prisma.session.deleteMany({ where: { id: sessionId } });
  }

  async me(userId: string): Promise<UserDto> {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user) throw new AppError(ErrorCode.UNAUTHORIZED, "Account not found.");
    return this.presentUser(user);
  }

  async presentUser(user: User): Promise<UserDto> {
    return userDtoWithRename(this.prisma, this.cfg, user);
  }

  /** Merge a validated partial patch into the stored reader preferences. */
  async updatePreferences(
    userId: string,
    patch: UpdateReaderPreferencesInput,
  ): Promise<UserDto> {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user) throw new AppError(ErrorCode.UNAUTHORIZED, "Account not found.");
    const merged = { ...normalizeReaderPreferences(user.preferences), ...patch };
    const updated = await this.prisma.user.update({
      where: { id: userId },
      data: { preferences: JSON.stringify(merged) },
    });
    return this.presentUser(updated);
  }

  async listSessions(userId: string, currentSessionId: string): Promise<SessionDto[]> {
    const sessions = await this.sessions.listForUser(userId, currentSessionId);
    return sessions.map(toSessionDto);
  }

  async revokeSession(userId: string, sessionId: string): Promise<void> {
    await this.sessions.revoke(sessionId, userId);
  }

  async verifyEmail(email: string, token: string): Promise<void> {
    await this.purgeExpiredUnverifiedSignups();
    const user = await this.prisma.user.findUnique({
      where: { email: email.toLowerCase().trim() },
    });
    if (!user) {
      throw this.invalidOtp();
    }
    const record = await this.matchOtp(user.id, token, EMAIL_OTP_PURPOSE.VERIFY);
    const now = new Date();
    const verified = await this.prisma.$transaction(async (tx) => {
      const consumed = await tx.emailVerificationToken.updateMany({
        where: {
          id: record.id,
          consumedAt: null,
          attempts: { lt: EMAIL_OTP.MAX_ATTEMPTS },
          expiresAt: { gt: now },
        },
        data: { consumedAt: now },
      });
      if (consumed.count === 0) return false;
      await tx.user.update({
        where: { id: user.id },
        data: { emailVerifiedAt: user.emailVerifiedAt ?? now },
      });
      return true;
    });
    if (!verified) {
      throw this.invalidOtp();
    }
  }

  async resendVerification(email: string): Promise<void> {
    await this.purgeExpiredUnverifiedSignups();
    const user = await this.prisma.user.findUnique({ where: { email: email.toLowerCase().trim() } });
    if (!user || user.emailVerifiedAt !== null) return; // no-op to avoid enumeration
    await this.createAndSendOtp(user.id, user.email, EMAIL_OTP_PURPOSE.VERIFY);
  }

  async changeDisplayName(userId: string, displayName: string): Promise<UserDto> {
    const user = await this.prisma.user.update({
      where: { id: userId },
      data: { displayName: displayName.trim() },
    });
    return this.presentUser(user);
  }

  async requestEmailChange(
    userId: string,
    currentPassword: string,
    newEmail: string,
    mfaCode?: string,
  ): Promise<void> {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user) throw new AppError(ErrorCode.UNAUTHORIZED, "Account not found.");

    const ok = await bcrypt.compare(currentPassword, user.passwordHash);
    if (!ok) {
      throw new AppError(ErrorCode.INVALID_CREDENTIALS, "Incorrect password.");
    }
    // Reject an address the account already uses before stepping up, so a typo
    // never burns a one-time backup code.
    if (newEmail === user.email) {
      throw new AppError(ErrorCode.VALIDATION_ERROR, "New email must be different from your current email.");
    }
    await this.mfa.assertStepUp(user, mfaCode);

    const taken = await this.prisma.user.findUnique({ where: { email: newEmail } });
    if (taken) {
      throw new AppError(ErrorCode.EMAIL_ALREADY_EXISTS, "An account with this email already exists.");
    }

    await this.createAndSendOtp(userId, newEmail, EMAIL_OTP_PURPOSE.EMAIL_CHANGE, user);
    await this.mail.sendEmailChangeNotice(user.email, newEmail).catch(() => undefined);
  }

  async resendEmailChange(userId: string): Promise<void> {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user || !user.pendingEmail) {
      throw new AppError(
        ErrorCode.VALIDATION_ERROR,
        "There's no email change waiting to be verified. Start the change again.",
      );
    }
    await this.createAndSendOtp(userId, user.pendingEmail, EMAIL_OTP_PURPOSE.EMAIL_CHANGE);
  }

  async verifyEmailChange(userId: string, token: string): Promise<UserDto> {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user || !user.pendingEmail) {
      throw new AppError(
        ErrorCode.INVALID_VERIFICATION_TOKEN,
        "No pending email change to verify.",
      );
    }
    const pendingEmail = user.pendingEmail;
    // The code is bound to the address it was sent to, so a code issued for a
    // previous target can never authorize a later one.
    const record = await this.matchOtp(userId, token, EMAIL_OTP_PURPOSE.EMAIL_CHANGE, pendingEmail);

    if (await this.emailChangeTargetTaken(pendingEmail)) {
      await this.clearPendingEmail(userId, pendingEmail);
      throw this.emailChangeTargetTakenError();
    }

    let updated: User;
    try {
      const claimed = await this.prisma.$transaction(async (tx) => {
        // Claim the OTP and swap the address atomically: a concurrent verify or
        // resend can only ever win once, and the target must still be pending.
        const consumed = await tx.emailVerificationToken.updateMany({
          where: {
            id: record.id,
            consumedAt: null,
            attempts: { lt: EMAIL_OTP.MAX_ATTEMPTS },
            expiresAt: { gt: new Date() },
          },
          data: { consumedAt: new Date() },
        });
        if (consumed.count === 0) return null;
        const changed = await tx.user.updateMany({
          where: { id: userId, pendingEmail },
          data: { email: pendingEmail, pendingEmail: null, emailVerifiedAt: new Date() },
        });
        if (changed.count === 0) return null;
        await tx.emailVerificationToken.deleteMany({
          where: { userId, purpose: { not: EMAIL_OTP_PURPOSE.EMAIL_CHANGE } },
        });
        return tx.user.findUnique({ where: { id: userId } });
      });
      if (!claimed) {
        throw new AppError(
          ErrorCode.INVALID_VERIFICATION_TOKEN,
          "No pending email change to verify.",
        );
      }
      updated = claimed;
    } catch (err) {
      // Another account claimed the address between our check and the write.
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") {
        await this.clearPendingEmail(userId, pendingEmail);
        throw this.emailChangeTargetTakenError();
      }
      throw err;
    }

    await this.mail.sendEmailChangedNotice(user.email, pendingEmail).catch(() => undefined);
    return this.presentUser(updated);
  }

  private async emailChangeTargetTaken(email: string): Promise<boolean> {
    const taken = await this.prisma.user.findUnique({ where: { email }, select: { id: true } });
    return taken !== null;
  }

  private async clearPendingEmail(userId: string, pendingEmail: string): Promise<void> {
    await this.prisma.user
      .updateMany({ where: { id: userId, pendingEmail }, data: { pendingEmail: null } })
      .catch(() => undefined);
  }

  private emailChangeTargetTakenError(): AppError {
    return new AppError(
      ErrorCode.EMAIL_ALREADY_EXISTS,
      "That email address was taken by another account. Start the change again with a different address.",
    );
  }

  async changePassword(
    userId: string,
    currentPassword: string,
    newPassword: string,
    meta: ClientMeta,
    mfaCode?: string,
  ): Promise<AuthResponse> {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user) throw new AppError(ErrorCode.UNAUTHORIZED, "Account not found.");
    const ok = await bcrypt.compare(currentPassword, user.passwordHash);
    if (!ok) {
      throw new AppError(ErrorCode.INVALID_CREDENTIALS, "Incorrect password.");
    }
    await this.mfa.assertStepUp(user, mfaCode);
    const passwordHash = await bcrypt.hash(newPassword, BCRYPT_COST);
    let dek: Buffer | null = null;
    if (this.crypto.snapshot()) {
      dek = this.crypto.snapshot();
    } else if (user.dekPasswordWrapped && user.dekKdfSalt) {
      try {
        dek = await this.crypto.unwrapPassword(user.dekPasswordWrapped, currentPassword, user.dekKdfSalt);
      } catch {
        // The password verified a moment ago, so a failed unwrap means another
        // credential write (reset/change) landed in between.
        throw credentialsChangedError();
      }
    }
    // Store the new hash and the re-wrapped library key in one write; a
    // password change that landed without its re-wrap would lock the library.
    // The write is guarded on the hash we verified, and revoking every session
    // and every pending MFA login challenge happens in the same transaction:
    // a crash can't leave a session or a half-finished sign-in alive under the
    // old password, and a concurrent stale change can't clobber a newer one.
    const keyMaterial = dek ? await this.libraryKeys.wrapPasswordMaterial(dek, newPassword) : {};
    const applied = await this.prisma.$transaction(async (tx) => {
      const changed = await tx.user.updateMany({
        where: {
          id: userId, passwordHash: user.passwordHash,
          dataEncryptionVersion: user.dataEncryptionVersion,
          dekPasswordWrapped: user.dekPasswordWrapped,
        },
        data: { passwordHash, ...keyMaterial },
      });
      if (changed.count === 0) return null;
      await tx.session.deleteMany({ where: { userId } });
      await tx.mfaChallenge.deleteMany({ where: { userId } });
      return tx.user.findUnique({ where: { id: userId } });
    });
    if (!applied) throw credentialsChangedError();
    // Start fresh on this device, guarded on the credential row this
    // transaction committed (not a later re-read a concurrent reset could have
    // replaced).
    const { session, tokens } = await this.sessions.create(
      applied.id,
      meta,
      dek,
      credentialSnapshot(applied),
    );
    return this.buildAuthResponse(applied, session, tokens);
  }

  async deleteAccount(
    userId: string,
    currentPassword: string,
    mfaCode?: string,
  ): Promise<void> {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user) throw new AppError(ErrorCode.UNAUTHORIZED, "Account not found.");
    const ok = await bcrypt.compare(currentPassword, user.passwordHash);
    if (!ok) {
      throw new AppError(ErrorCode.INVALID_CREDENTIALS, "Incorrect password.");
    }
    await this.mfa.assertStepUp(user, mfaCode);
    await this.avatars.deleteStored(userId);
    await this.prisma.user.deleteMany({ where: { id: userId } });
  }

  /**
   * Always succeeds (no enumeration). If the address belongs to an account,
   * a reset OTP is emailed — or printed to the console when SMTP is unset.
   */
  async requestPasswordReset(email: string): Promise<void> {
    const user = await this.prisma.user.findUnique({
      where: { email: email.toLowerCase().trim() },
    });
    if (!user) return;
    await this.createAndSendOtp(user.id, user.email, EMAIL_OTP_PURPOSE.PASSWORD_RESET);
  }

  async resetPassword(
    email: string,
    token: string,
    newPassword: string,
  ): Promise<void> {
    const user = await this.prisma.user.findUnique({
      where: { email: email.toLowerCase().trim() },
    });
    if (!user) {
      throw this.invalidOtp();
    }
    const record = await this.matchOtp(user.id, token, EMAIL_OTP_PURPOSE.PASSWORD_RESET);
    let dek: Buffer | null = null;
    if (user.dataEncryptionVersion >= DATA_ENCRYPTION_VERSION) {
      if (!user.dekServerWrapped) {
        throw new AppError(
          ErrorCode.FORBIDDEN,
          "Sign in with your current password once, then you can reset it by email.",
        );
      }
      try {
        dek = await this.libraryKeys.unwrapWithServerKek(user.dekServerWrapped);
      } catch {
        throw new AppError(ErrorCode.INTERNAL_ERROR, "Couldn't unlock the library for this reset.");
      }
    }
    const passwordHash = await bcrypt.hash(newPassword, BCRYPT_COST);
    // Re-wrap the library key alongside the new hash in the same transaction so
    // the two can never disagree about which password opens the library.
    const keyMaterial = dek ? await this.libraryKeys.wrapPasswordMaterial(dek, newPassword) : {};
    const now = new Date();
    const reset = await this.prisma.$transaction(async (tx) => {
      // One conditional write consumes the code: two parallel requests with
      // the same OTP can no longer both reset the password, and a code retired
      // by the attempt cap (or expired since the match) cannot be spent.
      const consumed = await tx.emailVerificationToken.updateMany({
        where: {
          id: record.id,
          consumedAt: null,
          attempts: { lt: EMAIL_OTP.MAX_ATTEMPTS },
          expiresAt: { gt: now },
        },
        data: { consumedAt: now },
      });
      if (consumed.count === 0) return false;
      // Guard the write on the hash we read: a reset racing a signed-in
      // password change must not overwrite the newer credential/wrap pair.
      const changed = await tx.user.updateMany({
        where: {
          id: user.id, passwordHash: user.passwordHash, email: user.email,
          dataEncryptionVersion: user.dataEncryptionVersion,
          dekPasswordWrapped: user.dekPasswordWrapped,
        },
        data: {
          passwordHash,
          emailVerifiedAt: user.emailVerifiedAt ?? now,
          ...keyMaterial,
        },
      });
      if (changed.count === 0) return false;
      // Revoke old sessions and every pending MFA sign-in in the same write: a
      // crash between the password update and revocation would leave stolen
      // sessions — or a challenge carrying the old DEK stash — valid.
      await tx.session.deleteMany({ where: { userId: user.id } });
      await tx.mfaChallenge.deleteMany({ where: { userId: user.id } });
      return true;
    });
    if (!reset) throw this.invalidOtp();
  }

  private async createAndSendOtp(
    userId: string,
    email: string,
    purpose: EmailOtpPurpose,
    emailChangeSnapshot?: User,
  ): Promise<void> {
    const token = this.tokens.generateVerificationToken();
    // Replace the previous code in one transaction: two concurrent resends
    // must not leave two live codes behind (the user's newest email would
    // otherwise be matched against whichever row happened to be newest).
    await this.prisma.$transaction(async (tx) => {
      if (emailChangeSnapshot) {
        if (!(await claimCredentialSnapshot(tx, userId, credentialSnapshot(emailChangeSnapshot)))) throw credentialsChangedError();
        await tx.user.update({ where: { id: userId }, data: { pendingEmail: email } });
      }
      const current = await tx.user.findUnique({ where: { id: userId }, select: { email: true, pendingEmail: true } });
      if (!current || (purpose === EMAIL_OTP_PURPOSE.EMAIL_CHANGE ? current.pendingEmail : current.email) !== email) {
        throw this.invalidOtp();
      }
      await tx.emailVerificationToken.deleteMany({ where: { userId, purpose } });
      await tx.emailVerificationToken.create({
        data: {
          userId,
          purpose,
          token: this.hashOtp(userId, token, this.otpScope(purpose, email)),
          expiresAt: new Date(Date.now() + EMAIL_OTP.TTL_MS),
        },
      });
    });
    try {
      if (purpose === EMAIL_OTP_PURPOSE.PASSWORD_RESET) {
        await this.mail.sendPasswordReset(email, token);
      } else {
        await this.mail.sendVerification(email, token);
      }
    } catch (err) {
      this.logger.error(`Failed to send ${purpose} email: ${(err as Error).message}`);
      // With SMTP_REQUIRED the user cannot proceed without the code; failing
      // beats reporting success for an email that was never delivered.
      if (this.cfg.smtpRequired) throw err;
    }
  }

  private hashOtp(userId: string, otp: string, scope?: string): string {
    return hashEmailOtp(userId, otp, scope ? `${this.cfg.jwtSecret}:${scope}` : this.cfg.jwtSecret);
  }

  /** Email-change codes are bound to the address they were sent to. */
  private otpScope(purpose: EmailOtpPurpose, email: string): string | undefined {
    return purpose === EMAIL_OTP_PURPOSE.EMAIL_CHANGE ? email : undefined;
  }

  private invalidOtp(): AppError {
    return new AppError(
      ErrorCode.INVALID_VERIFICATION_TOKEN,
      "This verification code is invalid or has expired.",
    );
  }

  /** Validate a user-scoped OTP. Does not consume on success (caller does). */
  private async matchOtp(userId: string, otp: string, purpose: EmailOtpPurpose, scope?: string) {
    const record = await this.prisma.emailVerificationToken.findFirst({
      where: { userId, purpose, consumedAt: null },
      orderBy: { createdAt: "desc" },
    });
    if (!record || record.expiresAt < new Date()) {
      throw this.invalidOtp();
    }
    if (record.attempts >= EMAIL_OTP.MAX_ATTEMPTS) {
      // A crash between counting the last wrong guess and retiring the row must
      // not reopen the counter for another guess.
      await this.prisma.emailVerificationToken
        .updateMany({ where: { id: record.id, consumedAt: null }, data: { consumedAt: new Date() } })
        .catch(() => undefined);
      throw this.invalidOtp();
    }
    if (!equalHex(this.hashOtp(userId, otp, scope), record.token)) {
      await this.recordOtpFailure(record.id);
      throw this.invalidOtp();
    }
    return record;
  }

  /**
   * Count a wrong code atomically. A read-modify-write would let parallel
   * guesses all persist attempts = 1 and dodge MAX_ATTEMPTS, so increment in
   * the database and retire the token once the shared counter reaches the cap.
   */
  private async recordOtpFailure(id: string): Promise<void> {
    await this.prisma.emailVerificationToken.updateMany({
      where: { id, consumedAt: null },
      data: { attempts: { increment: 1 } },
    });
    await this.prisma.emailVerificationToken.updateMany({
      where: { id, consumedAt: null, attempts: { gte: EMAIL_OTP.MAX_ATTEMPTS } },
      data: { consumedAt: new Date() },
    });
  }

  /**
   * Drop signups that never verified. The window is the verification code's
   * lifetime; resending replaces that code and starts another 10 minutes.
   * Accounts with no verify code are left alone (verification was not required).
   */
  async purgeExpiredUnverifiedSignups(now = new Date()): Promise<void> {
    try {
      const stale = await this.prisma.user.findMany({
        where: {
          emailVerifiedAt: null,
          emailTokens: {
            some: { purpose: EMAIL_OTP_PURPOSE.VERIFY, expiresAt: { lt: now } },
            none: { purpose: EMAIL_OTP_PURPOSE.VERIFY, expiresAt: { gte: now } },
          },
        },
        select: { id: true },
      });
      for (const user of stale) {
        await this.avatars.deleteStored(user.id);
        await this.prisma.user.deleteMany({ where: { id: user.id, emailVerifiedAt: null } });
      }
    } catch (err) {
      this.logger.warn(`Unverified signup sweep failed: ${(err as Error).message}`);
    }
  }

  private assertEmailVerified(user: Pick<User, "emailVerifiedAt">): void {
    if (this.cfg.emailVerificationRequired && user.emailVerifiedAt === null) {
      throw new AppError(
        ErrorCode.EMAIL_NOT_VERIFIED,
        "Please verify your email before signing in.",
      );
    }
  }

  private async buildAuthResponse(
    user: User,
    session: Session,
    tokens: { accessToken: string; refreshToken: string; expiresIn: number },
  ): Promise<AuthResponse> {
    return {
      user: await this.presentUser(user),
      session: toSessionDto({ ...session, current: true }),
      tokens: {
        accessToken: tokens.accessToken,
        refreshToken: tokens.refreshToken,
        expiresIn: tokens.expiresIn,
      },
    };
  }
}
