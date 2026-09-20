import { Injectable } from "@nestjs/common";
import { ErrorCode, SESSION, type SessionDeviceType } from "@ordo/shared";
import type { Session } from "../prisma/client.js";
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
  ): Promise<{ session: Session; tokens: TokenPair }> {
    const pair = this.tokens.generatePair();
    const wraps = dek ? this.crypto.wrapForSession(dek, pair) : { dekWrapped: null, dekRefreshWrapped: null };
    const session = await this.prisma.session.create({
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

  /** Revoke every session for a user except the one identified by `keepSessionId`. */
  async revokeAllExcept(userId: string, keepSessionId: string): Promise<number> {
    const result = await this.prisma.session.deleteMany({
      where: { userId, id: { not: keepSessionId } },
    });
    return result.count;
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
    const updated = await this.prisma.session.update({
      where: { id: session.id },
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
