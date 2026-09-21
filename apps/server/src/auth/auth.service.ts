import { Inject, Injectable, Logger } from "@nestjs/common";
import bcrypt from "bcryptjs";
import { randomUUID } from "node:crypto";
import type { Session, User } from "../prisma/client.js";
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
import { SessionService } from "./session.service.js";
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

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);

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
    const existingEmail = await this.prisma.user.findUnique({ where: { email } });
    if (existingEmail) {
      if (this.cfg.emailVerificationRequired) {
        return { pendingEmailVerification: true };
      }
      throw new AppError(ErrorCode.EMAIL_ALREADY_EXISTS, "An account with this email already exists.");
    }

    const user = await this.prisma.user.create({
      data: {
        id: randomUUID(),
        displayName,
        email,
        passwordHash,
        dekKdfSalt: keyMaterial.dekKdfSalt,
        dekPasswordWrapped: keyMaterial.dekPasswordWrapped,
        dekServerWrapped: keyMaterial.dekServerWrapped,
        dataEncryptionVersion: keyMaterial.dataEncryptionVersion,
      },
    });
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

    const provisioned = await this.libraryKeys.provisionWithPassword(user, input.password);

    if (this.mfa.isEnabled(user)) {
      return this.mfa.createLoginChallenge(user, provisioned.dek);
    }

    const { session, tokens } = await this.sessions.create(user.id, meta, provisioned.dek);
    return this.buildAuthResponse(user, session, tokens);
  }

  async completeMfaLogin(challengeToken: string, code: string, meta: ClientMeta): Promise<AuthResponse> {
    const { user, dek } = await this.mfa.consumeLoginCode(challengeToken, code);
    this.assertEmailVerified(user);
    this.rateLimit.clearLogin({ accountKey: user.email, userId: user.id });
    const { session, tokens } = await this.sessions.create(user.id, meta, dek);
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
    const { session, tokens } = await this.sessions.create(user.id, meta, dek);
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
      return;
    }
    await this.prisma.session.delete({ where: { id: sessionId } }).catch(() => undefined);
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
    const user = await this.prisma.user.findUnique({
      where: { email: email.toLowerCase().trim() },
    });
    if (!user) {
      throw this.invalidOtp();
    }
    const record = await this.matchOtp(user.id, token, EMAIL_OTP_PURPOSE.VERIFY);
    await this.prisma.$transaction([
      this.prisma.emailVerificationToken.update({
        where: { id: record.id },
        data: { consumedAt: new Date() },
      }),
      this.prisma.user.update({
        where: { id: user.id },
        data: { emailVerifiedAt: new Date() },
      }),
    ]);
  }

  async resendVerification(email: string): Promise<void> {
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
    await this.mfa.assertStepUp(user, mfaCode);

    if (newEmail === user.email) {
      throw new AppError(ErrorCode.VALIDATION_ERROR, "New email must be different from your current email.");
    }

    const taken = await this.prisma.user.findUnique({ where: { email: newEmail } });
    if (taken) {
      throw new AppError(ErrorCode.EMAIL_ALREADY_EXISTS, "An account with this email already exists.");
    }

    await this.prisma.user.update({ where: { id: userId }, data: { pendingEmail: newEmail } });
    await this.createAndSendOtp(userId, newEmail, EMAIL_OTP_PURPOSE.EMAIL_CHANGE);
    await this.mail.sendEmailChangeNotice(user.email, newEmail).catch(() => undefined);
  }

  async resendEmailChange(userId: string): Promise<void> {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user || !user.pendingEmail) return;
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
    const record = await this.matchOtp(userId, token, EMAIL_OTP_PURPOSE.EMAIL_CHANGE);
    const updated = await this.prisma.$transaction(async (tx) => {
      await tx.emailVerificationToken.update({
        where: { id: record.id },
        data: { consumedAt: new Date() },
      });
      return tx.user.update({
        where: { id: userId },
        data: {
          email: user.pendingEmail as string,
          pendingEmail: null,
          emailVerifiedAt: new Date(),
        },
      });
    });
    const previousEmail = user.email;
    const nextEmail = user.pendingEmail as string;
    await this.mail.sendEmailChangedNotice(previousEmail, nextEmail).catch(() => undefined);
    return this.presentUser(updated);
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
    const dek =
      this.crypto.snapshot() ??
      (user.dekPasswordWrapped && user.dekKdfSalt
        ? await this.crypto.unwrapPassword(user.dekPasswordWrapped, currentPassword, user.dekKdfSalt)
        : null);
    const updated = await this.prisma.user.update({
      where: { id: userId },
      data: { passwordHash },
    });
    if (dek) await this.libraryKeys.rewrapPassword(userId, dek, newPassword);
    // Sign out everywhere (including this session) and start fresh.
    await this.sessions.revokeAll(userId);
    const { session, tokens } = await this.sessions.create(updated.id, meta, dek);
    const fresh = dek ? ((await this.prisma.user.findUnique({ where: { id: userId } })) ?? updated) : updated;
    return this.buildAuthResponse(fresh, session, tokens);
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
    await this.prisma.$transaction([
      this.prisma.emailVerificationToken.update({
        where: { id: record.id },
        data: { consumedAt: new Date() },
      }),
      this.prisma.user.update({
        where: { id: user.id },
        data: {
          passwordHash,
          emailVerifiedAt: user.emailVerifiedAt ?? new Date(),
        },
      }),
    ]);
    if (dek) await this.libraryKeys.rewrapPassword(user.id, dek, newPassword);
    await this.sessions.revokeAll(user.id);
  }

  private async createAndSendOtp(
    userId: string,
    email: string,
    purpose: EmailOtpPurpose,
  ): Promise<void> {
    await this.prisma.emailVerificationToken.deleteMany({ where: { userId, purpose } });
    const token = this.tokens.generateVerificationToken();
    await this.prisma.emailVerificationToken.create({
      data: {
        userId,
        purpose,
        token: hashEmailOtp(userId, token, this.cfg.jwtSecret),
        expiresAt: new Date(Date.now() + EMAIL_OTP.TTL_MS),
      },
    });
    try {
      if (purpose === EMAIL_OTP_PURPOSE.PASSWORD_RESET) {
        await this.mail.sendPasswordReset(email, token);
      } else {
        await this.mail.sendVerification(email, token);
      }
    } catch (err) {
      this.logger.error(`Failed to send ${purpose} email: ${(err as Error).message}`);
    }
  }

  private hashOtp(userId: string, otp: string): string {
    return hashEmailOtp(userId, otp, this.cfg.jwtSecret);
  }

  private invalidOtp(): AppError {
    return new AppError(
      ErrorCode.INVALID_VERIFICATION_TOKEN,
      "This verification code is invalid or has expired.",
    );
  }

  /** Validate a user-scoped OTP. Does not consume on success (caller does). */
  private async matchOtp(userId: string, otp: string, purpose: EmailOtpPurpose) {
    const record = await this.prisma.emailVerificationToken.findFirst({
      where: { userId, purpose, consumedAt: null },
      orderBy: { createdAt: "desc" },
    });
    if (!record || record.expiresAt < new Date()) {
      throw this.invalidOtp();
    }
    if (!equalHex(this.hashOtp(userId, otp), record.token)) {
      const attempts = record.attempts + 1;
      await this.prisma.emailVerificationToken.update({
        where: { id: record.id },
        data:
          attempts >= EMAIL_OTP.MAX_ATTEMPTS
            ? { attempts, consumedAt: new Date() }
            : { attempts },
      });
      throw this.invalidOtp();
    }
    return record;
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
