import {
  CanActivate,
  ExecutionContext,
  Injectable,
} from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import { ErrorCode } from "@ordo/shared";
import type { AuthenticatedRequest } from "../common/decorators/current-user.decorator.js";
import { AppError } from "../common/errors/app-error.js";
import { getAccessToken } from "../common/utils/request.js";
import { SessionService } from "./session.service.js";
import { PrismaService } from "../prisma/prisma.service.js";
import { APP_CONFIG, type AppConfig } from "../config/config.module.js";
import { Inject } from "@nestjs/common";
import { ALLOW_WITHOUT_MFA_KEY } from "./allow-without-mfa.decorator.js";

/**
 * Validates the access token (cookie or Bearer) against the session table and
 * attaches `req.user = { userId, sessionId }`. Distinguishes expired tokens so
 * the client can transparently refresh. When MFA_REQUIRED is on, blocks
 * everything except AllowWithoutMfa routes until TOTP is enabled.
 */
@Injectable()
export class AuthGuard implements CanActivate {
  constructor(
    private readonly sessions: SessionService,
    private readonly prisma: PrismaService,
    private readonly reflector: Reflector,
    @Inject(APP_CONFIG) private readonly cfg: AppConfig,
  ) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const req = ctx.switchToHttp().getRequest<AuthenticatedRequest>();
    const token = getAccessToken(req);
    if (!token) {
      throw new AppError(ErrorCode.UNAUTHORIZED, "Sign in to continue.");
    }
    const result = await this.sessions.validateAccess(token);
    if (!result) {
      // Present but unknown (rotated, revoked, or never issued). Ask the client
      // to refresh rather than treating it as a hard logout — in-flight
      // requests often lose the race with a successful token rotation.
      throw new AppError(ErrorCode.TOKEN_EXPIRED, "Your session has expired.");
    }
    if (result.expired) {
      throw new AppError(ErrorCode.TOKEN_EXPIRED, "Your session has expired.");
    }
    req.user = { userId: result.userId, sessionId: result.sessionId };

    if (this.cfg.mfaRequired) {
      const allow = this.reflector.getAllAndOverride<boolean>(ALLOW_WITHOUT_MFA_KEY, [
        ctx.getHandler(),
        ctx.getClass(),
      ]);
      if (!allow) {
        const user = await this.prisma.user.findUnique({
          where: { id: result.userId },
          select: { totpEnabledAt: true },
        });
        if (!user?.totpEnabledAt) {
          throw new AppError(
            ErrorCode.MFA_ENROLLMENT_REQUIRED,
            "Set up an authenticator app to continue.",
          );
        }
      }
    }
    return true;
  }
}
