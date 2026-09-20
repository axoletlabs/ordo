/**
 * Stable error codes used across server and client.
 * The wire format for errors is:
 *   { error: { code: ErrorCode, message: string, details?: unknown } }
 */
export const ErrorCode = {
  // auth
  INVALID_CREDENTIALS: "invalid_credentials",
  UNAUTHORIZED: "unauthorized",
  TOKEN_EXPIRED: "token_expired",
  SESSION_REVOKED: "session_revoked",
  EMAIL_ALREADY_EXISTS: "email_already_exists",
  EMAIL_NOT_VERIFIED: "email_not_verified",
  INVALID_VERIFICATION_TOKEN: "invalid_verification_token",
  REGISTRATION_DISABLED: "registration_disabled",
  MFA_REQUIRED: "mfa_required",
  MFA_ENROLLMENT_REQUIRED: "mfa_enrollment_required",
  MFA_INVALID: "mfa_invalid",
  CSRF_INVALID: "csrf_invalid",

  // avatars
  AVATAR_TOO_LARGE: "avatar_too_large",
  AVATAR_UNSUPPORTED_TYPE: "avatar_unsupported_type",
  AVATAR_ANIMATED_DISABLED: "avatar_animated_disabled",
  AVATAR_NOT_FOUND: "avatar_not_found",

  // folders
  FOLDER_NOT_FOUND: "folder_not_found",
  FOLDER_PROTECTED: "folder_protected",
  INVALID_FOLDER_PASSWORD: "invalid_folder_password",
  FOLDER_TOKEN_EXPIRED: "folder_token_expired",

  // bookmarks
  BOOKMARK_NOT_FOUND: "bookmark_not_found",
  FETCH_FAILED: "fetch_failed",
  HIGHLIGHT_NOT_FOUND: "highlight_not_found",

  // tags
  TAG_NOT_FOUND: "tag_not_found",
  TAG_ALREADY_EXISTS: "tag_already_exists",

  // import / export
  IMPORT_NOT_FOUND: "import_not_found",
  IMPORT_INVALID_STATE: "import_invalid_state",
  IMPORT_FILE_TOO_LARGE: "import_file_too_large",
  IMPORT_UNSUPPORTED_FORMAT: "import_unsupported_format",
  IMPORT_PARSE_FAILED: "import_parse_failed",

  // generic
  VALIDATION_ERROR: "validation_error",
  NOT_FOUND: "not_found",
  FORBIDDEN: "forbidden",
  CONFLICT: "conflict",
  RATE_LIMITED: "rate_limited",
  INTERNAL_ERROR: "internal_error",
} as const;

export type ErrorCode = (typeof ErrorCode)[keyof typeof ErrorCode];
