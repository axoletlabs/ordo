import { ExecutionContext, createParamDecorator } from "@nestjs/common";
import type { Request } from "express";

/** Authenticated request augmented by AuthGuard. */
export interface AuthContext {
  userId: string;
  sessionId: string;
  /** Unwrapped library DEK for this request. Null for plaintext legacy users. */
  dek: Buffer | null;
}

export interface AuthenticatedRequest extends Request {
  user?: AuthContext;
}

export const CurrentUser = createParamDecorator((_data: unknown, ctx: ExecutionContext) => {
  const req = ctx.switchToHttp().getRequest<AuthenticatedRequest>();
  return req.user;
});
