import { Injectable } from "@nestjs/common";
import type { Session } from "../prisma/client.js";
import { ErrorCode, type SessionDeviceType } from "@ordo/shared";
import { PrismaService } from "../prisma/prisma.service.js";
import { AppError } from "../common/errors/app-error.js";
import type { TokenPair } from "./token.service.js";
import { TokenService } from "./token.service.js";

export interface AccessValidation {
  userId: string;
  sessionId: string;
  expired: boolean;
}

/** Manages session rows: creation, access validation, refresh rotation, revocation. */
@Injectable()
export class SessionService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly tokens: TokenService,
  ) {}

  async create(
    userId: string,
    meta: { deviceInfo: string; deviceName: string | null; deviceType: SessionDeviceType; ip: string },
  ): Promise<{ session: Session; tokens: TokenPair }> {
    const pair = this.tokens.generatePair();
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
      },
    });
    return { session, tokens: pair };
  }

  /** Validate an access token against the session table. Returns null if unknown. */
  async validateAccess(token: string): Promise<AccessValidation | null> {
    const hash = this.tokens.hash(token);
    const session = await this.prisma.session.findUnique({
      where: { accessTokenHash: hash },
      select: { id: true, userId: true, accessTokenExpiresAt: true, refreshTokenExpiresAt: true },
    });
    if (!session) return null;

    const now = new Date();
    // Whole session is dead — clean it up.
    if (session.refreshTokenExpiresAt < now) {
      await this.prisma.session.delete({ where: { id: session.id } }).catch(() => undefined);
      return null;
    }
    // Access expired but session alive → client should refresh.
    if (session.accessTokenExpiresAt < now) {
      return { userId: session.userId, sessionId: session.id, expired: true };
    }

    // Throttle lastSeen updates to ~once per minute via a fire-and-forget.
    void this.prisma.session
      .update({ where: { id: session.id }, data: { lastSeenAt: now } })
      .catch(() => undefined);

    return { userId: session.userId, sessionId: session.id, expired: false };
  }

  /** Rotate the token pair on an existing session (rotating refresh token). */
  async rotate(
    refreshToken: string,
    meta?: { deviceInfo: string; deviceName: string | null; deviceType: SessionDeviceType },
  ): Promise<{ session: Session; tokens: TokenPair }> {
    const hash = this.tokens.hash(refreshToken);
    const session = await this.prisma.session.findUnique({
      where: { refreshTokenHash: hash },
    });
    if (!session) {
      throw new AppError(ErrorCode.SESSION_REVOKED, "Your session has ended. Please sign in again.");
    }
    if (session.refreshTokenExpiresAt < new Date()) {
      await this.prisma.session.delete({ where: { id: session.id } }).catch(() => undefined);
      throw new AppError(ErrorCode.TOKEN_EXPIRED, "Your session has expired.");
    }

    const pair = this.tokens.generatePair();
    const updated = await this.prisma.session.update({
      where: { id: session.id },
      data: {
        accessTokenHash: pair.accessHash,
        accessTokenExpiresAt: pair.accessTokenExpiresAt,
        refreshTokenHash: pair.refreshHash,
        refreshTokenExpiresAt: pair.refreshTokenExpiresAt,
        lastSeenAt: new Date(),
        ...(meta && {
          deviceInfo: meta.deviceInfo,
          deviceName: meta.deviceName,
          deviceType: meta.deviceType,
        }),
      },
    });
    return { session: updated, tokens: pair };
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
}
