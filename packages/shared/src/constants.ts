/** Shared constants for client and server. */

/** User-facing product name (home screen, emails, authenticator issuer). */
export const APP_NAME = "ordo";

/** HTTP header that tells the server this is a mobile (token-based) client. */
export const CLIENT_TYPE_HEADER = "x-client-type";
export const CLIENT_TYPE_MOBILE = "mobile";

/** Best-effort device metadata used to identify active sessions. */
export const DEVICE_NAME_HEADER = "x-device-name";
export const DEVICE_TYPE_HEADER = "x-device-type";

/** Header carrying the short-lived folder unlock token. */
export const FOLDER_TOKEN_HEADER = "x-folder-token";
/** Header carrying comma-separated folder unlock tokens for global queries. */
export const FOLDER_TOKENS_HEADER = "x-folder-tokens";

/** Header carrying the opaque refresh token when not using cookies. */
export const REFRESH_TOKEN_HEADER = "x-refresh-token";

/** Cookie names for web clients. */
export const COOKIES = {
  ACCESS: "ordo_access",
  REFRESH: "ordo_refresh",
} as const;

/** Token lifetimes (milliseconds) for client-side scheduling. */
export const TOKEN_TTL = {
  ACCESS_MS: 15 * 60 * 1000, // 15 minutes
  REFRESH_MS: 30 * 24 * 60 * 60 * 1000, // 30 days
  FOLDER_MS: 10 * 60 * 1000, // 10 minutes
} as const;

/** Email OTPs (signup verification, email change, password reset). */
export const EMAIL_OTP = {
  LENGTH: 6,
  TTL_MS: 10 * 60 * 1000, // 10 minutes
  MAX_ATTEMPTS: 5,
} as const;

/** Stored on `EmailVerificationToken.purpose` so one flow cannot consume another. */
export const EMAIL_OTP_PURPOSE = {
  VERIFY: "verify",
  EMAIL_CHANGE: "email_change",
  PASSWORD_RESET: "password_reset",
  MFA_RECOVERY: "mfa_recovery",
} as const;
export type EmailOtpPurpose = (typeof EMAIL_OTP_PURPOSE)[keyof typeof EMAIL_OTP_PURPOSE];

/** TOTP + backup-code MFA. */
export const MFA = {
  ISSUER: APP_NAME,
  TOTP_DIGITS: 6,
  TOTP_PERIOD_S: 30,
  TOTP_WINDOW: 1,
  CHALLENGE_TTL_MS: 5 * 60 * 1000,
  CHALLENGE_MAX_ATTEMPTS: 5,
  BACKUP_CODE_COUNT: 10,
  BACKUP_CODE_LENGTH: 8,
} as const;

/** Stored on `MfaChallenge.purpose`. */
export const MFA_CHALLENGE_PURPOSE = {
  LOGIN: "login",
  ENROLL: "enroll",
} as const;
export type MfaChallengePurpose = (typeof MFA_CHALLENGE_PURPOSE)[keyof typeof MFA_CHALLENGE_PURPOSE];

/** Profile pictures. Pixel cap is an implementation detail, not a config knob. */
export const AVATAR = {
  DEFAULT_MAX_BYTES: 2 * 1024 * 1024,
  MAX_PX: 512,
  MIME: "image/webp",
  ALLOWED_TYPES: ["image/jpeg", "image/png", "image/webp"] as const,
} as const;
export type AvatarMime = (typeof AVATAR.ALLOWED_TYPES)[number];

export const DEFAULT_PAGE_SIZE = 20;
export const MAX_PAGE_SIZE = 100;

/** Max bookmarks or folders in one batch selection request. */
export const BATCH_ITEM_LIMIT = 200;

/**
 * Version of the server's article-extraction pipeline. Bumped whenever the
 * pipeline changes enough that stored content should be re-extracted; rows
 * with an older (or missing) version are refreshed in the background.
 */
export const EXTRACTION_VERSION = 11;

/** Client poll cadence while a bookmark is `pending` (200ms → 1.5s). */
export function extractionPollIntervalMs(dataUpdateCount: number): number {
  const n = Math.max(0, dataUpdateCount - 1);
  return Math.min(1_500, 200 * 2 ** Math.min(n, 3));
}

/** readProgress at or above this fraction marks a bookmark read/completed. */
export const READ_COMPLETION_THRESHOLD = 0.98;

export const TAG_NAME_MAX_LENGTH = 40;
export const MAX_TAGS_PER_BOOKMARK = 20;
export const MAX_TAG_SUGGESTIONS = 3;

/** Stable semantic keys; clients resolve them against their current theme. */
export const TAG_COLORS = [
  "slate",
  "red",
  "orange",
  "amber",
  "green",
  "teal",
  "blue",
  "indigo",
  "violet",
  "pink",
] as const;
export type TagColor = (typeof TAG_COLORS)[number];
export const DEFAULT_TAG_COLOR: TagColor = "blue";

export function normalizeTagColor(value: unknown): TagColor {
  return typeof value === "string" && (TAG_COLORS as readonly string[]).includes(value)
    ? (value as TagColor)
    : DEFAULT_TAG_COLOR;
}

/** Icon used when a folder is created without an explicit icon. */
export const DEFAULT_FOLDER_ICON = "folder-outline";

/** Folder PIN lock: four or six digits, entered in separate boxes. */
export const FOLDER_PIN_LENGTHS = [4, 6] as const;
export type FolderPinLength = (typeof FOLDER_PIN_LENGTHS)[number];

export function isFolderPinLength(value: unknown): value is FolderPinLength {
  return value === 4 || value === 6;
}

/**
 * Curated Ionicons (outline variants) offered as folder icons.
 * Keep names in sync with the Ionicons set used by the mobile app.
 */
export const FOLDER_ICONS = [
  // general & reading
  "folder-outline",
  "bookmark-outline",
  "book-outline",
  "reader-outline",
  "newspaper-outline",
  "library-outline",
  "star-outline",
  "heart-outline",
  "sparkles-outline",
  // travel & places
  "globe-outline",
  "compass-outline",
  "map-outline",
  "location-outline",
  "airplane-outline",
  "car-outline",
  "bicycle-outline",
  "boat-outline",
  "home-outline",
  "business-outline",
  // work & tech
  "briefcase-outline",
  "laptop-outline",
  "server-outline",
  "cloud-outline",
  "code-slash-outline",
  "terminal-outline",
  "bug-outline",
  "rocket-outline",
  "construct-outline",
  "hardware-chip-outline",
  "cube-outline",
  // media
  "albums-outline",
  "images-outline",
  "camera-outline",
  "videocam-outline",
  "film-outline",
  "musical-notes-outline",
  "headset-outline",
  "mic-outline",
  // fun & lifestyle
  "game-controller-outline",
  "extension-puzzle-outline",
  "fitness-outline",
  "barbell-outline",
  "medical-outline",
  "restaurant-outline",
  "cafe-outline",
  "wine-outline",
  "cart-outline",
  "pricetags-outline",
  "wallet-outline",
  "cash-outline",
  // people & communication
  "people-outline",
  "person-outline",
  "chatbubbles-outline",
  "mail-outline",
  "share-social-outline",
] as const;

export type FolderIcon = (typeof FOLDER_ICONS)[number];

export function normalizeFolderIcon(value: unknown): FolderIcon {
  return typeof value === "string" && (FOLDER_ICONS as readonly string[]).includes(value)
    ? (value as FolderIcon)
    : DEFAULT_FOLDER_ICON;
}

/** Import / export tuning. Limits are part of the public contract. */
export const IMPORT_EXPORT = {
  /** Maximum accepted import upload size (multipart file). */
  MAX_FILE_BYTES: 50 * 1024 * 1024,
  /** Staged import jobs (and their results) expire after this much idle time. */
  JOB_TTL_MS: 60 * 60 * 1000,
  /** How often the server sweeps expired import jobs. */
  SWEEP_MS: 10 * 60 * 1000,
  /** Bookmark rows per database write batch during import. */
  BATCH_SIZE: 500,
  /** Cap on invalid-row samples returned with a preview or result. */
  MAX_INVALID_SAMPLES: 20,
  /** Max length of a folder name (matches the folder create schema). */
  FOLDER_NAME_MAX: 100,
  /** Max length of an imported bookmark title; longer titles are truncated. */
  TITLE_MAX: 500,
  /** Separator used when flattening nested source folders into Ordo names. */
  FOLDER_PATH_SEPARATOR: " / ",
} as const;

/** Import file formats the server can detect and parse. */
export const IMPORT_FORMATS = ["ordo-json", "netscape-html", "csv"] as const;
export type ImportFormat = (typeof IMPORT_FORMATS)[number];

/** Export file formats. */
export const EXPORT_FORMATS = ["json", "html", "csv"] as const;
export type ExportFormat = (typeof EXPORT_FORMATS)[number];

/** MIME types for export downloads and the native save-as picker. */
export const EXPORT_MIME: Record<ExportFormat, string> = {
  json: "application/json",
  html: "text/html",
  csv: "text/csv",
};

/** What to do when an imported URL already exists in the account. */
export const DUPLICATE_POLICIES = ["skip", "update", "copy"] as const;
export type DuplicatePolicy = (typeof DUPLICATE_POLICIES)[number];

/** Query param keys. */
export const QUERY = {
  CURSOR: "cursor",
  LIMIT: "limit",
  SEARCH: "q",
  FOLDER_ID: "folderId",
  TAG_IDS: "tagIds",
} as const;
