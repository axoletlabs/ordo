import { Inject, Injectable, Logger } from "@nestjs/common";
import type { User } from "../prisma/client.js";
import * as OTPAuth from "otpauth";
import {
  EMAIL_OTP,
  EMAIL_OTP_PURPOSE,
  ErrorCode,
  MFA,
  MFA_CHALLENGE_PURPOSE,
  type MfaRequiredResponse,
  type MfaStatusDto,
  type TotpBeginDto,
  type TotpConfirmDto,
} from "@ordo/shared";
import { PrismaService } from "../prisma/prisma.service.js";
import { AppError } from "../common/errors/app-error.js";
import {
  equalHex,
  generateToken,
  hashEmailOtp,
  hashToken,
} from "../common/utils/tokens.js";
import {
  formatBackupCode,
  generateBackupCodes,
  hashBackupCode,
  normalizeBackupCode,
} from "../common/utils/backup-codes.js";
import { decryptSecret, deriveKey, encryptSecret } from "../common/utils/secret-box.js";
import { APP_CONFIG, type AppConfig } from "../config/config.module.js";
import { TokenService } from "./token.service.js";
import { MailService } from "./mail.service.js";
import { toUserDto } from "../common/mappers.js";

const TOTP_KEY_INFO = "totp-secret-enc";

@Injectable()
export class MfaService {
  private readonly logger = new Logger(MfaService.name);
  private readonly totpKey: Buffer;

  constructor(
    private readonly prisma: PrismaService,
    private readonly tokens: TokenService,
    private readonly mail: MailService,
    @Inject(APP_CONFIG) private readonly cfg: AppConfig,
  ) {
    this.totpKey = deriveKey(cfg.jwtSecret, TOTP_KEY_INFO);
  }

  isEnabled(user: Pick<User, "totpEnabledAt" | "totpSecretEnc">): boolean {
    return user.totpEnabledAt !== null && !!user.totpSecretEnc;
  }

  async status(userId: string): Promise<MfaStatusDto> {
    const user = await this.requireUser(userId);
    const remaining = this.isEnabled(user)
      ? await this.prisma.mfaBackupCode.count({
          where: { userId, usedAt: null },
        })
      : 0;
    return { totpEnabled: this.isEnabled(user), backupCodesRemaining: remaining };
  }

  createLoginChallengeResponse(user: User): Promise<MfaRequiredResponse> {
    return this.createLoginChallenge(user);
  }

  async createLoginChallenge(user: User): Promise<MfaRequiredResponse> {
    await this.prisma.mfaChallenge.deleteMany({
      where: { userId: user.id, purpose: MFA_CHALLENGE_PURPOSE.LOGIN },
    });
    const token = generateToken(32);
    await this.prisma.mfaChallenge.create({
      data: {
        userId: user.id,
        tokenHash: hashToken(token),
        purpose: MFA_CHALLENGE_PURPOSE.LOGIN,
        expiresAt: new Date(Date.now() + MFA.CHALLENGE_TTL_MS),
      },
    });
    return {
      mfaRequired: true,
      challengeToken: token,
      methods: ["totp"],
      emailRecoveryAvailable: user.emailVerifiedAt !== null,
    };
  }

  async consumeLoginCode(challengeToken: string, code: string): Promise<User> {
    const challenge = await this.matchChallenge(challengeToken, MFA_CHALLENGE_PURPOSE.LOGIN);
    const user = await this.requireUser(challenge.userId);
    const ok = await this.verifyMfaCode(user, code, { consumeBackup: true });
    if (!ok) {
      await this.recordChallengeFailure(challenge.id, challenge.attempts);
      throw this.invalid();
    }
    await this.prisma.mfaChallenge.delete({ where: { id: challenge.id } }).catch(() => undefined);
    return user;
  }

  async requestEmailRecovery(challengeToken: string): Promise<void> {
    const challenge = await this.matchChallenge(challengeToken, MFA_CHALLENGE_PURPOSE.LOGIN);
    const user = await this.requireUser(challenge.userId);
    if (!user.emailVerifiedAt) return;
    await this.createAndSendRecoveryOtp(user.id, user.email);
  }

  async consumeEmailRecovery(challengeToken: string, otp: string): Promise<User> {
    const challenge = await this.matchChallenge(challengeToken, MFA_CHALLENGE_PURPOSE.LOGIN);
    const user = await this.requireUser(challenge.userId);
    const record = await this.matchRecoveryOtp(user.id, otp);
    await this.prisma.$transaction([
      this.prisma.emailVerificationToken.update({
        where: { id: record.id },
        data: { consumedAt: new Date() },
      }),
      this.prisma.mfaChallenge.deleteMany({ where: { userId: user.id } }),
    ]);
    return this.disableMfa(user.id);
  }

  async beginTotp(userId: string, mfaCode?: string): Promise<TotpBeginDto> {
    const user = await this.requireUser(userId);
    if (this.isEnabled(user)) {
      await this.assertStepUp(user, mfaCode);
    }
    const secret = new OTPAuth.Secret({ size: 20 });
    const totp = this.totpFor(user.email, secret);
    await this.prisma.mfaChallenge.deleteMany({
      where: { userId, purpose: MFA_CHALLENGE_PURPOSE.ENROLL },
    });
    await this.prisma.mfaChallenge.create({
      data: {
        userId,
        tokenHash: hashToken(generateToken(32)),
        purpose: MFA_CHALLENGE_PURPOSE.ENROLL,
        payload: encryptSecret(secret.base32, this.totpKey),
        expiresAt: new Date(Date.now() + MFA.CHALLENGE_TTL_MS),
      },
    });
    return { secret: secret.base32, otpauthUrl: totp.toString() };
  }

  async confirmTotp(userId: string, code: string): Promise<TotpConfirmDto> {
    const user = await this.requireUser(userId);
    const pending = await this.prisma.mfaChallenge.findFirst({
      where: { userId, purpose: MFA_CHALLENGE_PURPOSE.ENROLL },
      orderBy: { createdAt: "desc" },
    });
    if (!pending || pending.expiresAt < new Date() || !pending.payload) {
      throw new AppError(ErrorCode.MFA_INVALID, "Start authenticator setup again.");
    }
    const secret = OTPAuth.Secret.fromBase32(decryptSecret(pending.payload, this.totpKey));
    if (!this.validTotp(user.email, secret, code)) {
      await this.recordChallengeFailure(pending.id, pending.attempts);
      throw this.invalid();
    }
    const codes = generateBackupCodes();
    const updated = await this.prisma.$transaction(async (tx) => {
      await tx.mfaChallenge.deleteMany({ where: { userId } });
      await tx.mfaBackupCode.deleteMany({ where: { userId } });
      await tx.mfaBackupCode.createMany({
        data: codes.map((codeValue) => ({
          userId,
          codeHash: hashBackupCode(codeValue, this.cfg.jwtSecret),
        })),
      });
      return tx.user.update({
        where: { id: userId },
        data: {
          totpSecretEnc: encryptSecret(secret.base32, this.totpKey),
          totpEnabledAt: new Date(),
        },
      });
    });
    return { backupCodes: codes.map(formatBackupCode), user: toUserDto(updated) };
  }

  async disableTotp(userId: string, mfaCode: string): Promise<User> {
    const user = await this.requireUser(userId);
    if (!this.isEnabled(user)) {
      throw new AppError(ErrorCode.VALIDATION_ERROR, "Authenticator is not enabled.");
    }
    await this.assertStepUp(user, mfaCode);
    return this.disableMfa(userId);
  }

  async regenerateBackupCodes(userId: string, mfaCode: string): Promise<string[]> {
    const user = await this.requireUser(userId);
    if (!this.isEnabled(user)) {
      throw new AppError(ErrorCode.VALIDATION_ERROR, "Authenticator is not enabled.");
    }
    await this.assertStepUp(user, mfaCode);
    const codes = generateBackupCodes();
    await this.prisma.$transaction([
      this.prisma.mfaBackupCode.deleteMany({ where: { userId } }),
      this.prisma.mfaBackupCode.createMany({
        data: codes.map((codeValue) => ({
          userId,
          codeHash: hashBackupCode(codeValue, this.cfg.jwtSecret),
        })),
      }),
    ]);
    return codes.map(formatBackupCode);
  }

  async assertStepUp(user: User, mfaCode: string | undefined): Promise<void> {
    if (!this.isEnabled(user)) return;
    if (!mfaCode) {
      throw new AppError(ErrorCode.MFA_REQUIRED, "Enter your authenticator or backup code.");
    }
    const ok = await this.verifyMfaCode(user, mfaCode, { consumeBackup: true });
    if (!ok) throw this.invalid();
  }

  async disableMfa(userId: string): Promise<User> {
    const [, , user] = await this.prisma.$transaction([
      this.prisma.mfaBackupCode.deleteMany({ where: { userId } }),
      this.prisma.mfaChallenge.deleteMany({ where: { userId } }),
      this.prisma.user.update({
        where: { id: userId },
        data: { totpSecretEnc: null, totpEnabledAt: null },
      }),
    ]);
    return user;
  }

  private async verifyMfaCode(
    user: User,
    code: string,
    opts: { consumeBackup: boolean },
  ): Promise<boolean> {
    const trimmed = code.trim();
    if (/^\d{6}$/.test(trimmed) && user.totpSecretEnc) {
      try {
        const secret = OTPAuth.Secret.fromBase32(decryptSecret(user.totpSecretEnc, this.totpKey));
        if (this.validTotp(user.email, secret, trimmed)) return true;
      } catch (err) {
        this.logger.warn(`Failed to decrypt TOTP secret for ${user.id}: ${(err as Error).message}`);
      }
    }
    const normalized = normalizeBackupCode(trimmed);
    if (normalized.length < 8) return false;
    const hash = hashBackupCode(trimmed, this.cfg.jwtSecret);
    const row = await this.prisma.mfaBackupCode.findFirst({
      where: { userId: user.id, codeHash: hash, usedAt: null },
    });
    if (!row) return false;
    if (opts.consumeBackup) {
      await this.prisma.mfaBackupCode.update({
        where: { id: row.id },
        data: { usedAt: new Date() },
      });
    }
    return true;
  }

  private totpFor(email: string, secret: OTPAuth.Secret): OTPAuth.TOTP {
    return new OTPAuth.TOTP({
      issuer: MFA.ISSUER,
      label: email,
      algorithm: "SHA1",
      digits: MFA.TOTP_DIGITS,
      period: MFA.TOTP_PERIOD_S,
      secret,
    });
  }

  private validTotp(email: string, secret: OTPAuth.Secret, token: string): boolean {
    const delta = this.totpFor(email, secret).validate({ token, window: MFA.TOTP_WINDOW });
    return delta !== null;
  }

  private async matchChallenge(token: string, purpose: string) {
    const record = await this.prisma.mfaChallenge.findUnique({
      where: { tokenHash: hashToken(token) },
    });
    if (!record || record.purpose !== purpose || record.expiresAt < new Date()) {
      throw this.invalid();
    }
    if (record.attempts >= MFA.CHALLENGE_MAX_ATTEMPTS) {
      await this.prisma.mfaChallenge
        .delete({ where: { id: record.id } })
        .catch(() => undefined);
      throw this.invalid();
    }
    return record;
  }

  private async recordChallengeFailure(id: string, attempts: number): Promise<void> {
    const next = attempts + 1;
    if (next >= MFA.CHALLENGE_MAX_ATTEMPTS) {
      await this.prisma.mfaChallenge.delete({ where: { id } }).catch(() => undefined);
      return;
    }
    await this.prisma.mfaChallenge.update({
      where: { id },
      data: { attempts: next },
    });
  }

  private async createAndSendRecoveryOtp(userId: string, email: string): Promise<void> {
    await this.prisma.emailVerificationToken.deleteMany({
      where: { userId, purpose: EMAIL_OTP_PURPOSE.MFA_RECOVERY },
    });
    const token = this.tokens.generateVerificationToken();
    await this.prisma.emailVerificationToken.create({
      data: {
        userId,
        purpose: EMAIL_OTP_PURPOSE.MFA_RECOVERY,
        token: hashEmailOtp(userId, token, this.cfg.jwtSecret),
        expiresAt: new Date(Date.now() + EMAIL_OTP.TTL_MS),
      },
    });
    try {
      await this.mail.sendMfaRecovery(email, token);
    } catch (err) {
      this.logger.error(`Failed to send MFA recovery email: ${(err as Error).message}`);
    }
  }

  private async matchRecoveryOtp(userId: string, otp: string) {
    const record = await this.prisma.emailVerificationToken.findFirst({
      where: { userId, purpose: EMAIL_OTP_PURPOSE.MFA_RECOVERY, consumedAt: null },
      orderBy: { createdAt: "desc" },
    });
    if (!record || record.expiresAt < new Date()) throw this.invalidOtp();
    if (!equalHex(hashEmailOtp(userId, otp, this.cfg.jwtSecret), record.token)) {
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

  private async requireUser(userId: string): Promise<User> {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user) throw new AppError(ErrorCode.UNAUTHORIZED, "Account not found.");
    return user;
  }

  private invalid(): AppError {
    return new AppError(ErrorCode.MFA_INVALID, "That code is incorrect or has expired.");
  }

  private invalidOtp(): AppError {
    return new AppError(
      ErrorCode.INVALID_VERIFICATION_TOKEN,
      "This verification code is invalid or has expired.",
    );
  }
}
