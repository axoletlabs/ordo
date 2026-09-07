import {
  CallHandler,
  ExecutionContext,
  Injectable,
  NestInterceptor,
} from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import type { Observable } from "rxjs";
import type { Request } from "express";
import type { AuthenticatedRequest } from "../decorators/current-user.decorator.js";
import { getClientIp } from "../utils/request.js";
import { RATE_LIMIT_KEY, type RateLimitPolicyName } from "./rate-limit.decorator.js";
import { RateLimitService } from "./rate-limit.service.js";

@Injectable()
export class RateLimitInterceptor implements NestInterceptor {
  constructor(
    private readonly reflector: Reflector,
    private readonly rateLimit: RateLimitService,
  ) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    if (!this.rateLimit.enabled) return next.handle();

    const policy = this.reflector.getAllAndOverride<RateLimitPolicyName>(RATE_LIMIT_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (!policy) return next.handle();

    const req = context.switchToHttp().getRequest<AuthenticatedRequest>();
    this.apply(policy, req);
    return next.handle();
  }

  private apply(policy: RateLimitPolicyName, req: AuthenticatedRequest): void {
    const ip = getClientIp(req);
    switch (policy) {
      case "register":
        this.rateLimit.consumeRegister(ip);
        return;
      case "forgot-password":
        this.rateLimit.consumeForgotPassword(ip, emailFromBody(req));
        return;
      case "reset-password":
        this.rateLimit.consumeResetPassword(ip);
        return;
      case "bookmark-create": {
        const userId = req.user?.userId;
        if (userId) this.rateLimit.consumeBookmarkCreate(userId);
        return;
      }
      case "bookmark-prefetch": {
        const userId = req.user?.userId;
        if (userId) this.rateLimit.consumeBookmarkPrefetch(userId);
        return;
      }
      case "mfa-verify":
        this.rateLimit.consumeMfaVerify(ip);
        return;
      case "avatar-upload": {
        const userId = req.user?.userId;
        if (userId) this.rateLimit.consumeAvatarUpload(userId);
        return;
      }
      case "import-upload": {
        const userId = req.user?.userId;
        if (userId) this.rateLimit.consumeImportUpload(userId);
        return;
      }
      case "export": {
        const userId = req.user?.userId;
        if (userId) this.rateLimit.consumeExport(userId);
        return;
      }
    }
  }
}

function emailFromBody(req: Request): string | null {
  const raw = (req.body as { email?: unknown } | undefined)?.email;
  if (typeof raw !== "string") return null;
  const email = raw.trim().toLowerCase();
  return email && email.includes("@") ? email : null;
}
