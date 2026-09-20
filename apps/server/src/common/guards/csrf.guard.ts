import { CanActivate, ExecutionContext, Injectable } from "@nestjs/common";
import type { Request } from "express";
import { CSRF_TOKEN_HEADER, ErrorCode } from "@ordo/shared";
import { AppError } from "../errors/app-error.js";
import { getAccessCookie, getBearerToken, getCsrfCookie } from "../utils/request.js";
import { equalUtf8 } from "../utils/tokens.js";

const SAFE = new Set(["GET", "HEAD", "OPTIONS"]);

/**
 * Double-submit CSRF for cookie sessions. Bearer (Android / Expo) skips it.
 * Safe methods and requests with no access cookie (login, telemetry) skip it.
 */
@Injectable()
export class CsrfGuard implements CanActivate {
  canActivate(ctx: ExecutionContext): boolean {
    const req = ctx.switchToHttp().getRequest<Request>();
    if (SAFE.has((req.method || "GET").toUpperCase())) return true;
    if (getBearerToken(req)) return true;
    if (!getAccessCookie(req)) return true;

    const expected = getCsrfCookie(req);
    const provided = req.get(CSRF_TOKEN_HEADER) ?? "";
    if (!expected || !provided || !equalUtf8(expected, provided)) {
      throw new AppError(ErrorCode.CSRF_INVALID, "Reload the page and try again.");
    }
    return true;
  }
}
