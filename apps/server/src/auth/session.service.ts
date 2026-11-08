import { Injectable } from "@nestjs/common";
import { ErrorCode, SESSION, type SessionDeviceType } from "@ordo/shared";
import type { Prisma, Session, User } from "../prisma/client.js";
import { PrismaService } from "../prisma/prisma.service.js";
import { AppError } from "../common/errors/app-error.js";
import type { TokenPair } from "./token.service.js";
import { TokenService } from "./token.service.js";
import { LibraryCryptoService } from "../crypto/library-crypto.service.js";

export interface AccessValidation {
  userId: string;
  sessionId: string;
  expired: boolean;
  dek: Buffer | null;
}

/**
 * The credential state a caller checked before it started slow work (bcrypt,
 * scrypt, TOTP). Session creation re-proves this snapshot atomically with the
 * insert, so a login that lost a race with a password reset/change or an MFA
 * toggle cannot mint a session for credentials that no longer exist.
 */
export interface CredentialSnapshot {
  passwordHash: string;
  /** Compared only when the key is present; `undefined` skips the check. */
  totpEnabledAt?: Date | null;
  /** Compared only when the key is present; `undefined` skips the check. */
  totpSecretEnc?: string | null;
}

export function credentialSnapshot(
  user: Pick<User, "passwordHash" | "totpEnabledAt" | "totpSecretEnc">,
): CredentialSnapshot {
  return {
    passwordHash: user.passwordHash,
    totpEnabledAt: user.totpEnabledAt,
    totpSecretEnc: user.totpSecretEnc,
  };
}

export function credentialsChangedError(): AppError {
  return new AppError(
    ErrorCode.SESSION_REVOKED,
    "Your sign-in was interrupted. Please sign in again.",
  );
}

/**
 * Prove `snapshot` and hold the user row for the rest of the transaction.
 *
 * A no-op UPDATE still runs as a write, so SQLite evaluates the `WHERE` under
 * the write lock: a password reset/change or MFA toggle that commits first
 * makes the match fail, and one that tries to commit later waits. Everything
 * the caller writes afterwards in this same transaction is therefore based on
 * the snapshot it verified.
 */
export async function claimCredentialSnapshot(
  tx: Prisma.TransactionClient,
  userId: string,
  snapshot: CredentialSnapshot,
): Promise<boolean> {
  const matched = await tx.$executeRaw`
    UPDATE "User" SET "updatedAt" = "updatedAt"
    WHERE "id" = ${userId} AND "passwordHash" = ${snapshot.passwordHash}
  `;
  if (matched === 0) return false;
  if (snapshot.totpEnabledAt === undefined && snapshot.totpSecretEnc === undefined) return true;
  const current = await tx.user.findUnique({
    where: { id: userId },
    select: { totpEnabledAt: true, totpSecretEnc: true },
  });
  if (!current) return false;
  if (
    snapshot.totpEnabledAt !== undefined &&
    !sameInstant(current.totpEnabledAt, snapshot.totpEnabledAt)
  ) {
    return false;
  }
  if (
    snapshot.totpSecretEnc !== undefined &&
    current.totpSecretEnc !== snapshot.totpSecretEnc
  ) {
    return false;
  }
  return true;
}

function sameInstant(a: Date | null, b: Date | null): boolean {
  if (a === null || b === null) return a === b;
  return a.getTime() === b.getTime();
}

/** Manages session rows: creation, access validation, refresh rotation, revocation. */
@Injectable()
export class SessionService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly tokens: TokenService,
    private readonly crypto: LibraryCryptoService,
  ) {}

  async create(
    userId: string,
    meta: { deviceInfo: string; deviceName: string | null; deviceType: SessionDeviceType; ip: string },
    dek: Buffer | null = null,
    snapshot?: CredentialSnapshot,
  ): Promise<{ session: Session; tokens: TokenPair }> {
    const pair = this.tokens.generatePair();
    const wraps = dek ? this.crypto.wrapForSession(dek, pair) : { dekWrapped: null, dekRefreshWrapped: null };
    const session = await this.prisma.$transaction(async (tx) => {
      if (snapshot && !(await claimCredentialSnapshot(tx, userId, snapshot))) return null;
      return tx.session.create({
        data: {
          userId,
          deviceInfo: meta.deviceInfo,
          deviceName: meta.deviceName,
          deviceType: meta.deviceType,
          ip: meta.ip,
          accessTokenHash: pair.accessHash,
          accessTokenExpiresAt: pair.accessTokenExpiresAt,
          refreshTokenHash: pair.refreshHash,
          refreshTokenExpiresAt: pair.refreshTokenExpiresAt,
          lastSeenAt: new Date(),
          dekWrapped: wraps.dekWrapped,
          dekRefreshWrapped: wraps.dekRefreshWrapped,
        },
      });
    });
    if (!session) throw credentialsChangedError();
    await this.enforceSessionCap(userId, session.id);
    return { session, tokens: pair };
  }

  /** Validate an access token against the session table. Returns null if unknown. */
  async validateAccess(token: string): Promise<AccessValidation | null> {
    const session = await this.findByAccessHashes(this.tokens.lookupHashes(token));
    if (!session) return null;

    const now = new Date();
    if (this.isIdle(session, now) || session.refreshTokenExpiresAt < now) {
      await this.prisma.session.delete({ where: { id: session.id } }).catch(() => undefined);
      return null;
    }
    if (session.accessTokenExpiresAt < now) {
      return { userId: session.userId, sessionId: session.id, expired: true, dek: null };
    }

    let dek: Buffer | null = null;
    if (session.dekWrapped) {
      try {
        dek = this.crypto.unwrapAccess(session.dekWrapped, token);
      } catch {
        return null;
      }
    }

    void this.prisma.session
      .update({ where: { id: session.id }, data: { lastSeenAt: now } })
      .catch(() => undefined);

    return { userId: session.userId, sessionId: session.id, expired: false, dek };
  }

  /** Rotate the token pair on an existing session (rotating refresh token). */
  async rotate(
    refreshToken: string,
    meta?: { deviceInfo: string; deviceName: string | null; deviceType: SessionDeviceType },
  ): Promise<{ session: Session; tokens: TokenPair }> {
    const hashes = this.tokens.lookupHashes(refreshToken);
    const current = await this.prisma.session.findFirst({
      where: { refreshTokenHash: { in: hashes } },
    });
    if (current) {
      return this.rotateSession(current, refreshToken, meta);
    }

    const reused = await this.prisma.session.findFirst({
      where: { previousRefreshTokenHash: { in: hashes } },
    });
    if (reused) {
      await this.prisma.session.delete({ where: { id: reused.id } }).catch(() => undefined);
      throw new AppError(ErrorCode.SESSION_REVOKED, "Your session has ended. Please sign in again.");
    }

    throw new AppError(ErrorCode.SESSION_REVOKED, "Your session has ended. Please sign in again.");
  }

  async revoke(sessionId: string, userId: string): Promise<void> {
    const session = await this.prisma.session.findUnique({ where: { id: sessionId } });
    if (!session || session.userId !== userId) {
      throw new AppError(ErrorCode.NOT_FOUND, "Session not found.");
    }
    await this.prisma.session.delete({ where: { id: sessionId } });
  }

  async revokeByAccessHash(accessHash: string): Promise<void> {
    await this.prisma.session.deleteMany({ where: { accessTokenHash: accessHash } });
  }

  async revokeByAccessToken(accessToken: string): Promise<void> {
    await this.prisma.session.deleteMany({
      where: { accessTokenHash: { in: this.tokens.lookupHashes(accessToken) } },
    });
  }

  /** Revoke every session for a user. */
  async revokeAll(userId: string): Promise<number> {
    const result = await this.prisma.session.deleteMany({
      where: { userId },
    });
    return result.count;
  }

  async listForUser(userId: string, currentSessionId: string) {
    const sessions = await this.prisma.session.findMany({
      where: { userId },
      orderBy: { lastSeenAt: "desc" },
      select: {
        id: true,
        deviceInfo: true,
        deviceName: true,
        deviceType: true,
        ip: true,
        lastSeenAt: true,
        createdAt: true,
      },
    });
    return sessions.map((s) => ({ ...s, current: s.id === currentSessionId }));
  }

  private async rotateSession(
    session: Session,
    refreshToken: string,
    meta?: { deviceInfo: string; deviceName: string | null; deviceType: SessionDeviceType },
  ): Promise<{ session: Session; tokens: TokenPair }> {
    const now = new Date();
    if (this.isIdle(session, now) || session.refreshTokenExpiresAt < now) {
      await this.prisma.session.delete({ where: { id: session.id } }).catch(() => undefined);
      throw new AppError(ErrorCode.TOKEN_EXPIRED, "Your session has expired.");
    }

    let dek: Buffer | null = null;
    if (session.dekRefreshWrapped) {
      try {
        dek = this.crypto.unwrapRefresh(session.dekRefreshWrapped, refreshToken);
      } catch {
        throw new AppError(ErrorCode.SESSION_REVOKED, "Your session has ended. Please sign in again.");
      }
    }

    const pair = this.tokens.generatePair();
    const wraps = dek ? this.crypto.wrapForSession(dek, pair) : { dekWrapped: null, dekRefreshWrapped: null };
    // Guard the update on the hash we matched so two concurrent refreshes
    // with the same token can't both succeed (the loser would orphan the
    // winner's brand-new refresh token). A zero-count update means another
    // request already rotated this session — treat the token as used.
    const rotation = await this.prisma.session.updateMany({
      where: { id: session.id, refreshTokenHash: session.refreshTokenHash },
      data: {
        accessTokenHash: pair.accessHash,
        accessTokenExpiresAt: pair.accessTokenExpiresAt,
        previousRefreshTokenHash: session.refreshTokenHash,
        refreshTokenHash: pair.refreshHash,
        refreshTokenExpiresAt: pair.refreshTokenExpiresAt,
        lastSeenAt: now,
        dekWrapped: wraps.dekWrapped,
        dekRefreshWrapped: wraps.dekRefreshWrapped,
        ...(meta && {
          deviceInfo: meta.deviceInfo,
          deviceName: meta.deviceName,
          deviceType: meta.deviceType,
        }),
      },
    });
    if (rotation.count === 0) {
      throw new AppError(ErrorCode.SESSION_REVOKED, "Your session has ended. Please sign in again.");
    }
    const updated = await this.prisma.session.findUnique({ where: { id: session.id } });
    if (!updated) {
      throw new AppError(ErrorCode.SESSION_REVOKED, "Your session has ended. Please sign in again.");
    }
    return { session: updated, tokens: pair };
  }

  private isIdle(session: Pick<Session, "lastSeenAt">, now: Date): boolean {
    return now.getTime() - session.lastSeenAt.getTime() > SESSION.IDLE_MS;
  }

  private async findByAccessHashes(hashes: string[]): Promise<Session | null> {
    return this.prisma.session.findFirst({
      where: { accessTokenHash: { in: hashes } },
    });
  }

  private async enforceSessionCap(userId: string, keepId: string): Promise<void> {
    const others = await this.prisma.session.findMany({
      where: { userId, id: { not: keepId } },
      orderBy: { lastSeenAt: "asc" },
      select: { id: true },
    });
    const overflow = others.length + 1 - SESSION.MAX_PER_USER;
    if (overflow <= 0) return;
    await this.prisma.session.deleteMany({
      where: { id: { in: others.slice(0, overflow).map((row) => row.id) } },
    });
  }
}
