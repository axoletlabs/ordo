/**
 * Map an error to a human-readable message. Never leaks raw error objects.
 *
 * Prefer the server message for codes where the server is specific
 * (wrong password vs wrong login, validation details, size limits).
 */
import { ApiClientError, LOCAL_ERROR } from "./api/client";
import { APP_NAME, ErrorCode } from "@ordo/shared";

const FRIENDLY: Record<string, string> = {
  [ErrorCode.EMAIL_ALREADY_EXISTS]: "An account with this email already exists.",
  [ErrorCode.EMAIL_NOT_VERIFIED]: "Please verify your email before signing in.",
  [ErrorCode.INVALID_VERIFICATION_TOKEN]: "This verification code is invalid or has expired.",
  [ErrorCode.REGISTRATION_DISABLED]: "This server isn't accepting new sign-ups.",
  [ErrorCode.SESSION_REVOKED]: "Your session has ended. Please sign in again.",
  [ErrorCode.TOKEN_EXPIRED]: "Your session has expired.",
  [ErrorCode.UNAUTHORIZED]: "You need to sign in to do that.",
  [ErrorCode.MFA_REQUIRED]: "Enter your authenticator or backup code.",
  [ErrorCode.MFA_ENROLLMENT_REQUIRED]: "Set up an authenticator app to continue.",
  [ErrorCode.MFA_INVALID]: "That code is incorrect or has expired.",
  [ErrorCode.AVATAR_UNSUPPORTED_TYPE]: "Use a JPEG, PNG, or WebP image.",
  [ErrorCode.AVATAR_ANIMATED_DISABLED]: "Animated images are disabled on this server.",
  [ErrorCode.AVATAR_NOT_FOUND]: "No profile picture yet.",
  [ErrorCode.FOLDER_NOT_FOUND]: "This folder no longer exists.",
  [ErrorCode.FOLDER_PROTECTED]: "This folder is locked.",
  [ErrorCode.FOLDER_TOKEN_EXPIRED]: "Folder access expired. Unlock it again.",
  [ErrorCode.INVALID_FOLDER_PASSWORD]: "That password is incorrect.",
  [ErrorCode.BOOKMARK_NOT_FOUND]: "This bookmark no longer exists.",
  [ErrorCode.FETCH_FAILED]: "Couldn't load that page.",
  [ErrorCode.TAG_NOT_FOUND]: "This tag no longer exists.",
  [ErrorCode.TAG_ALREADY_EXISTS]: "A tag with this name already exists.",
  [ErrorCode.NOT_FOUND]: "That item wasn't found.",
  [ErrorCode.FORBIDDEN]: "You don't have access to that.",
  [ErrorCode.CONFLICT]: "That change couldn't be saved.",
  [ErrorCode.RATE_LIMITED]: "Too many requests. Please wait a moment.",
  [ErrorCode.INTERNAL_ERROR]: "Something went wrong on the server.",
  [ErrorCode.VALIDATION_ERROR]: "Please check your input.",
  [ErrorCode.INVALID_CREDENTIALS]: "Incorrect email or password.",
  [ErrorCode.AVATAR_TOO_LARGE]: "That image is too large.",
  [ErrorCode.IMPORT_NOT_FOUND]: "This import no longer exists.",
  [ErrorCode.IMPORT_INVALID_STATE]: "This import can't be confirmed again.",
  [ErrorCode.IMPORT_FILE_TOO_LARGE]: "That file is too large to import.",
  [ErrorCode.IMPORT_UNSUPPORTED_FORMAT]: `Use an ${APP_NAME}, HTML, or CSV bookmark export.`,
  [ErrorCode.IMPORT_PARSE_FAILED]: "That file couldn't be read.",
};

export function errorMessage(err: unknown, fallback = "Something went wrong."): string {
  if (err instanceof ApiClientError) {
    if (err.code === LOCAL_ERROR.TIMEOUT) {
      return "The server took too long to respond.";
    }
    if (err.status === 0 || err.code === LOCAL_ERROR.NETWORK) {
      return "Couldn't reach the server. Check your connection.";
    }
    // Prefer the server message so specific copy (wrong password vs login,
    // "session not found", "this folder is not locked") is not overwritten.
    if (err.message && !/^Cannot (GET|POST|PUT|PATCH|DELETE) /i.test(err.message)) {
      return err.message;
    }
    return FRIENDLY[err.code] || fallback;
  }
  if (err instanceof Error && err.message) return err.message;
  return fallback;
}

/** True if the error is a folder-protection signal requiring an unlock prompt. */
export function isFolderProtected(err: unknown): boolean {
  return err instanceof ApiClientError && err.code === ErrorCode.FOLDER_PROTECTED;
}

/** Folder id from a FOLDER_PROTECTED error, when the server included it. */
export function folderProtectedId(err: unknown): string | null {
  if (!isFolderProtected(err) || !(err instanceof ApiClientError)) return null;
  const details = err.details;
  if (!details || typeof details !== "object" || !("folderId" in details)) return null;
  const id = (details as { folderId?: unknown }).folderId;
  return typeof id === "string" && id.length > 0 ? id : null;
}

/** Server asked for a TOTP/backup code after the rest of the action was accepted. */
export function isMfaRequiredError(err: unknown): boolean {
  return err instanceof ApiClientError && err.code === ErrorCode.MFA_REQUIRED;
}

/** Wrong or expired authenticator/backup code. */
export function isMfaInvalidError(err: unknown): boolean {
  return err instanceof ApiClientError && err.code === ErrorCode.MFA_INVALID;
}
