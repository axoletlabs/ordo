import { HttpException, HttpStatus } from "@nestjs/common";
import { ErrorCode } from "@ordo/shared";

/** Maps stable error codes to HTTP statuses. */
const STATUS_BY_CODE: Record<string, HttpStatus> = {
  [ErrorCode.INVALID_CREDENTIALS]: HttpStatus.UNAUTHORIZED,
  [ErrorCode.UNAUTHORIZED]: HttpStatus.UNAUTHORIZED,
  [ErrorCode.TOKEN_EXPIRED]: HttpStatus.UNAUTHORIZED,
  [ErrorCode.SESSION_REVOKED]: HttpStatus.UNAUTHORIZED,
  [ErrorCode.EMAIL_NOT_VERIFIED]: HttpStatus.UNAUTHORIZED,
  [ErrorCode.MFA_REQUIRED]: HttpStatus.UNAUTHORIZED,
  [ErrorCode.MFA_ENROLLMENT_REQUIRED]: HttpStatus.FORBIDDEN,
  [ErrorCode.MFA_INVALID]: HttpStatus.UNAUTHORIZED,
  [ErrorCode.CSRF_INVALID]: HttpStatus.FORBIDDEN,

  [ErrorCode.EMAIL_ALREADY_EXISTS]: HttpStatus.CONFLICT,
  [ErrorCode.INVALID_VERIFICATION_TOKEN]: HttpStatus.BAD_REQUEST,
  [ErrorCode.REGISTRATION_DISABLED]: HttpStatus.FORBIDDEN,

  [ErrorCode.FOLDER_NOT_FOUND]: HttpStatus.NOT_FOUND,
  [ErrorCode.FOLDER_PROTECTED]: HttpStatus.FORBIDDEN,
  [ErrorCode.INVALID_FOLDER_PASSWORD]: HttpStatus.FORBIDDEN,
  [ErrorCode.FOLDER_TOKEN_EXPIRED]: HttpStatus.UNAUTHORIZED,

  [ErrorCode.BOOKMARK_NOT_FOUND]: HttpStatus.NOT_FOUND,
  [ErrorCode.FETCH_FAILED]: HttpStatus.BAD_REQUEST,
  [ErrorCode.HIGHLIGHT_NOT_FOUND]: HttpStatus.NOT_FOUND,

  [ErrorCode.TAG_NOT_FOUND]: HttpStatus.NOT_FOUND,
  [ErrorCode.TAG_ALREADY_EXISTS]: HttpStatus.CONFLICT,

  [ErrorCode.AVATAR_TOO_LARGE]: HttpStatus.PAYLOAD_TOO_LARGE,
  [ErrorCode.AVATAR_UNSUPPORTED_TYPE]: HttpStatus.BAD_REQUEST,
  [ErrorCode.AVATAR_ANIMATED_DISABLED]: HttpStatus.BAD_REQUEST,
  [ErrorCode.AVATAR_NOT_FOUND]: HttpStatus.NOT_FOUND,

  [ErrorCode.VALIDATION_ERROR]: HttpStatus.BAD_REQUEST,
  [ErrorCode.NOT_FOUND]: HttpStatus.NOT_FOUND,
  [ErrorCode.FORBIDDEN]: HttpStatus.FORBIDDEN,
  [ErrorCode.CONFLICT]: HttpStatus.CONFLICT,
  [ErrorCode.RATE_LIMITED]: HttpStatus.TOO_MANY_REQUESTS,
  [ErrorCode.INTERNAL_ERROR]: HttpStatus.INTERNAL_SERVER_ERROR,
};

export interface AppErrorPayload {
  code: string;
  message: string;
  details?: unknown;
}

/**
 * Domain error carrying a stable machine-readable code plus a human message.
 * The global exception filter renders this into the `{ error: {...} }` envelope.
 */
export class AppError extends HttpException {
  readonly code: string;
  readonly details?: unknown;

  constructor(code: ErrorCode, message: string, details?: unknown) {
    const status = STATUS_BY_CODE[code] ?? HttpStatus.INTERNAL_SERVER_ERROR;
    super({ code, message, details }, status);
    this.code = code;
    this.details = details;
  }

  static from(code: ErrorCode, message: string, details?: unknown): AppError {
    return new AppError(code, message, details);
  }
}
