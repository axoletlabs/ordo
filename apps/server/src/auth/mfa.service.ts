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
import {
  claimCredentialSnapshot,
  credentialSnapshot,
  credentialsChangedError,
  type CredentialSnapshot,
} from "./session.service.js";
import { userDtoWithRename } from "../server/instance-admin.js";
import { LibraryCryptoService } from "../crypto/library-crypto.service.js";

const TOTP_KEY_INFO = "totp-secret-enc";

export interface MfaLoginCompletion {
  user: User;
  dek: Buffer | null;
}

@Injectable()
export class MfaService {
  private readonly logger = new Logger(MfaService.name);
  private readonly totpKey: Buffer;

  constructor(
    private readonly prisma: PrismaService,
    private readonly tokens: TokenService,
    private readonly mail: MailService,
    @Inject(APP_CONFIG) private readonly cfg: AppConfig,
    private readonly crypto: LibraryCryptoService,
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

  /**
   * Start a login challenge. The challenge replaces any previous login
   * challenge in the same transaction that re-proves the credential snapshot,
   * so a password reset/change that wins the race leaves no usable challenge
   * behind (and a login that lost the race never hands one out).
   */
  async createLoginChallenge(
    user: User,
    dek: Buffer | null = null,
    snapshot?: CredentialSnapshot,
  ): Promise<MfaRequiredResponse> {
    const token = generateToken(32);
    const payload = dek ? this.crypto.wrapMfaStash(token, { dek }) : null;
    const guard = snapshot ?? credentialSnapshot(user);
    const created = await this.prisma.$transaction(async (tx) => {
      if (!(await claimCredentialSnapshot(tx, user.id, guard))) return null;
      await tx.mfaChallenge.deleteMany({
        where: { userId: user.id, purpose: MFA_CHALLENGE_PURPOSE.LOGIN },
      });
      return tx.mfaChallenge.create({
        data: {
          userId: user.id,
          tokenHash: this.tokens.hash(token),
          purpose: MFA_CHALLENGE_PURPOSE.LOGIN,
          payload,
          expiresAt: new Date(Date.now() + MFA.CHALLENGE_TTL_MS),
        },
      });
    });
    if (!created) throw credentialsChangedError();
    return {
      mfaRequired: true,
      challengeToken: token,
      methods: ["totp"],
      emailRecoveryAvailable: user.emailVerifiedAt !== null,
    };
  }

  async consumeLoginCode(challengeToken: string, code: string): Promise<MfaLoginCompletion> {
    const challenge = await this.matchChallenge(challengeToken, MFA_CHALLENGE_PURPOSE.LOGIN);
    const user = await this.requireUser(challenge.userId);
    const ok = await this.verifyMfaCode(user, code, { consumeBackup: true });
    if (!ok) {
      await this.recordChallengeFailure(challenge.id);
      throw this.invalid();
    }
    const stash = this.readStash(challengeToken, challenge.payload);
    // Claim the challenge so the same token can't mint two sessions. The claim
    // repeats the match-time guards: an expiry/cap that landed while the code
    // was verified must not be reopened by this completion.
    const claimed = await this.prisma.mfaChallenge.deleteMany({
      where: {
        id: challenge.id,
        purpose: MFA_CHALLENGE_PURPOSE.LOGIN,
        expiresAt: { gt: new Date() },
        attempts: { lt: MFA.CHALLENGE_MAX_ATTEMPTS },
      },
    });
    if (claimed.count === 0) throw this.invalid();
    return { user, ...stash };
  }

  async requestEmailRecovery(challengeToken: string): Promise<void> {
    const challenge = await this.matchChallenge(challengeToken, MFA_CHALLENGE_PURPOSE.LOGIN);
    const user = await this.requireUser(challenge.userId);
    if (!user.emailVerifiedAt) return;
    await this.createAndSendRecoveryOtp(user, challenge.id);
  }

  async consumeEmailRecovery(challengeToken: string, otp: string): Promise<MfaLoginCompletion> {
    const challenge = await this.matchChallenge(challengeToken, MFA_CHALLENGE_PURPOSE.LOGIN);
    const user = await this.requireUser(challenge.userId);
    const stash = this.readStash(challengeToken, challenge.payload);
    const record = await this.matchRecoveryOtp(user.id, otp);
    const now = new Date();
    const claimed = await this.prisma.$transaction(async (tx) => {
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
      // Claim the exact challenge this OTP was requested for: a challenge that
      // expired or was replaced after the match cannot complete a login, and a
      // password reset that raced us has already deleted it.
      const challengeClaim = await tx.mfaChallenge.deleteMany({
        where: {
          id: challenge.id,
          purpose: MFA_CHALLENGE_PURPOSE.LOGIN,
          expiresAt: { gt: now },
          attempts: { lt: MFA.CHALLENGE_MAX_ATTEMPTS },
        },
      });
      if (challengeClaim.count === 0) return false;
      await tx.mfaChallenge.deleteMany({ where: { userId: user.id } });
      return true;
    });
    if (!claimed) throw this.invalidOtp();
    try {
      await this.mail.sendMfaRecoveryNotice(user.email);
    } catch (err) {
      this.logger.error(`Failed to send MFA recovery notice: ${(err as Error).message}`);
    }
    return { user, ...stash };
  }

  async beginTotp(userId: string, mfaCode?: string): Promise<TotpBeginDto> {
    const user = await this.requireUser(userId);
    if (this.isEnabled(user)) {
      await this.assertStepUp(user, mfaCode);
    }
    const secret = new OTPAuth.Secret({ size: 20 });
    const totp = this.totpFor(user.email, secret);
    const payload = encryptSecret(secret.base32, this.totpKey);
    const tokenHash = this.tokens.hash(generateToken(32));
    await this.prisma.$transaction(async (tx) => {
      if (!(await claimCredentialSnapshot(tx, userId, credentialSnapshot(user)))) throw credentialsChangedError();
      // Replace the pending enrollment atomically so two concurrent "begin"
      // calls cannot leave two live secrets behind.
      await tx.mfaChallenge.deleteMany({
        where: { userId, purpose: MFA_CHALLENGE_PURPOSE.ENROLL },
      });
      await tx.mfaChallenge.create({
        data: {
          userId,
          tokenHash,
          purpose: MFA_CHALLENGE_PURPOSE.ENROLL,
          payload,
          expiresAt: new Date(Date.now() + MFA.CHALLENGE_TTL_MS),
        },
      });
    });
    return { secret: secret.base32, otpauthUrl: totp.toString() };
  }

  async confirmTotp(userId: string, code: string): Promise<TotpConfirmDto> {
    const user = await this.requireUser(userId);
    const now = new Date();
    const pending = await this.prisma.mfaChallenge.findFirst({
      where: { userId, purpose: MFA_CHALLENGE_PURPOSE.ENROLL },
      orderBy: { createdAt: "desc" },
    });
    if (
      !pending ||
      pending.expiresAt <= now ||
      !pending.payload ||
      pending.attempts >= MFA.CHALLENGE_MAX_ATTEMPTS
    ) {
      throw new AppError(ErrorCode.MFA_INVALID, "Start authenticator setup again.");
    }
    const secret = OTPAuth.Secret.fromBase32(decryptSecret(pending.payload, this.totpKey));
    if (!this.validTotp(user.email, secret, code)) {
      await this.recordChallengeFailure(pending.id);
      throw this.invalid();
    }
    const codes = generateBackupCodes();
    const updated = await this.prisma.$transaction(async (tx) => {
      // Claim exactly the enrollment this code was checked against. A
      // concurrent begin (replaced it), disable (removed it), second confirm
      // (already consumed it), expiry, or attempt cap makes the claim fail
      // instead of installing a secret the user may no longer be looking at.
      const claimed = await tx.mfaChallenge.deleteMany({
        where: {
          id: pending.id,
          purpose: MFA_CHALLENGE_PURPOSE.ENROLL,
          tokenHash: pending.tokenHash,
          expiresAt: { gt: new Date() },
          attempts: { lt: MFA.CHALLENGE_MAX_ATTEMPTS },
        },
      });
      if (claimed.count === 0) return null;
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
    if (!updated) {
      throw new AppError(ErrorCode.MFA_INVALID, "Start authenticator setup again.");
    }
    return {
      backupCodes: codes.map(formatBackupCode),
      user: await userDtoWithRename(this.prisma, this.cfg, updated),
    };
  }

  async disableTotp(userId: string, mfaCode: string): Promise<User> {
    const user = await this.requireUser(userId);
    if (!this.isEnabled(user)) {
      throw new AppError(ErrorCode.VALIDATION_ERROR, "Authenticator is not enabled.");
    }
    await this.assertStepUp(user, mfaCode);
    return this.disableMfa(userId, credentialSnapshot(user));
  }

  async regenerateBackupCodes(userId: string, mfaCode: string): Promise<string[]> {
    const user = await this.requireUser(userId);
    if (!this.isEnabled(user)) {
      throw new AppError(ErrorCode.VALIDATION_ERROR, "Authenticator is not enabled.");
    }
    await this.assertStepUp(user, mfaCode);
    const codes = generateBackupCodes();
    await this.prisma.$transaction(async tx => {
      if (!(await claimCredentialSnapshot(tx, userId, credentialSnapshot(user)))) throw credentialsChangedError();
      await tx.mfaBackupCode.deleteMany({ where: { userId } });
      await tx.mfaBackupCode.createMany({
        data: codes.map((codeValue) => ({
          userId,
          codeHash: hashBackupCode(codeValue, this.cfg.jwtSecret),
        })),
      });
    });
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

  async disableMfa(userId: string, snapshot?: CredentialSnapshot): Promise<User> {
    return this.prisma.$transaction(async tx => {
      if (snapshot && !(await claimCredentialSnapshot(tx, userId, snapshot))) throw credentialsChangedError();
      await tx.mfaBackupCode.deleteMany({ where: { userId } });
      await tx.mfaChallenge.deleteMany({ where: { userId } });
      return tx.user.update({
        where: { id: userId },
        data: { totpSecretEnc: null, totpEnabledAt: null },
      });
    });
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
      // Guard the write on `usedAt: null` so two concurrent requests carrying
      // the same backup code can't both spend it.
      const consumed = await this.prisma.mfaBackupCode.updateMany({
        where: { id: row.id, usedAt: null },
        data: { usedAt: new Date() },
      });
      if (consumed.count === 0) return false;
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
    const record = await this.prisma.mfaChallenge.findFirst({
      where: { tokenHash: { in: this.tokens.lookupHashes(token) } },
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

  /**
   * Count a wrong code atomically. Incrementing the row in the database keeps
   * parallel guesses from all writing attempts = 1, and the challenge is
   * dropped once the shared counter reaches the cap.
   */
  private async recordChallengeFailure(id: string): Promise<void> {
    await this.prisma.mfaChallenge.updateMany({
      where: { id },
      data: { attempts: { increment: 1 } },
    });
    await this.prisma.mfaChallenge
      .deleteMany({ where: { id, attempts: { gte: MFA.CHALLENGE_MAX_ATTEMPTS } } })
      .catch(() => undefined);
  }

  private async createAndSendRecoveryOtp(user: User, challengeId: string): Promise<void> {
    const { id: userId, email } = user;
    const token = this.tokens.generateVerificationToken();
    // One live recovery code per account: replace it atomically so parallel
    // "email me a code" requests cannot leave a stale code as the newest row.
    await this.prisma.$transaction(async (tx) => {
      if (!(await claimCredentialSnapshot(tx, userId, credentialSnapshot(user)))) throw credentialsChangedError();
      const current = await tx.user.findUnique({ where: { id: userId }, select: { email: true, emailVerifiedAt: true } });
      const challenge = await tx.mfaChallenge.findFirst({
        where: {
          id: challengeId, userId, purpose: MFA_CHALLENGE_PURPOSE.LOGIN,
          expiresAt: { gt: new Date() }, attempts: { lt: MFA.CHALLENGE_MAX_ATTEMPTS },
        },
      });
      // A late request must not recreate a recovery code for the old mailbox
      // or retire a newer challenge's code after its own challenge was replaced.
      if (!current?.emailVerifiedAt || current.email !== email || !challenge) throw this.invalid();
      await tx.emailVerificationToken.deleteMany({
        where: { userId, purpose: EMAIL_OTP_PURPOSE.MFA_RECOVERY },
      });
      await tx.emailVerificationToken.create({
        data: {
          userId,
          purpose: EMAIL_OTP_PURPOSE.MFA_RECOVERY,
          token: hashEmailOtp(userId, token, this.cfg.jwtSecret),
          expiresAt: new Date(Date.now() + EMAIL_OTP.TTL_MS),
        },
      });
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
    if (record.attempts >= EMAIL_OTP.MAX_ATTEMPTS) {
      // A crash between counting the last wrong guess and retiring the row must
      // not reopen the counter for another guess.
      await this.prisma.emailVerificationToken
        .updateMany({ where: { id: record.id, consumedAt: null }, data: { consumedAt: new Date() } })
        .catch(() => undefined);
      throw this.invalidOtp();
    }
    if (!equalHex(hashEmailOtp(userId, otp, this.cfg.jwtSecret), record.token)) {
      await this.recordRecoveryOtpFailure(record.id);
      throw this.invalidOtp();
    }
    return record;
  }

  /** Atomic counterpart to the auth service's OTP attempt counter. */
  private async recordRecoveryOtpFailure(id: string): Promise<void> {
    await this.prisma.emailVerificationToken.updateMany({
      where: { id, consumedAt: null },
      data: { attempts: { increment: 1 } },
    });
    await this.prisma.emailVerificationToken.updateMany({
      where: { id, consumedAt: null, attempts: { gte: EMAIL_OTP.MAX_ATTEMPTS } },
      data: { consumedAt: new Date() },
    });
  }

  private async requireUser(userId: string): Promise<User> {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user) throw new AppError(ErrorCode.UNAUTHORIZED, "Account not found.");
    return user;
  }

  private readStash(challengeToken: string, payload: string | null): { dek: Buffer | null } {
    if (!payload) return { dek: null };
    try {
      const stash = this.crypto.unwrapMfaStash(challengeToken, payload);
      return { dek: stash.dek };
    } catch {
      // A stash we can't open would mint a session without the library key.
      // Fail the sign-in instead of leaving the user in a broken session.
      throw new AppError(
        ErrorCode.SESSION_REVOKED,
        "Your sign-in attempt expired. Please sign in again.",
      );
    }
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
