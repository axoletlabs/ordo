import { z } from "zod";
import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { join, resolve } from "node:path";
import { randomBytes } from "node:crypto";
import { APP_NAME, AVATAR } from "@ordo/shared";

export type AvatarStorage = "filesystem" | "database";

/**
 * Resolved, typed application configuration.
 * All values default such that the server boots with ZERO environment config.
 */
export interface AppConfig {
  port: number;
  databaseUrl: string;
  /** App secret / token pepper. Auto-generated + persisted if unset. */
  jwtSecret: string;
  registrationEnabled: boolean;
  emailVerificationRequired: boolean;
  corsAllowedOrigins: string[]; // [] => reflect request origin
  smtpUrl: string | null;
  smtpFrom: string;
  /**
   * When false, every rate-limit check is a no-op. Defaults on except in
   * `NODE_ENV=test` (Jest), so local/prod are protected and existing tests
   * keep their unlimited register/login loops. Override with RATE_LIMIT_ENABLED.
   */
  rateLimitEnabled: boolean;
  /**
   * How many reverse-proxy hops to trust when reading `X-Forwarded-For`.
   * 0 (default) uses the socket address only — clients cannot spoof the IP.
   * Set to 1 behind a typical nginx / Caddy / Cloudflare tunnel.
   */
  trustProxy: number;
  profilePictureMaxBytes: number;
  avatarStorage: AvatarStorage;
  avatarDir: string;
  avatarAllowAnimated: boolean;
  mfaRequired: boolean;
}

const EnvSchema = z.object({
  PORT: z.coerce.number().int().positive().default(3000),
  DATABASE_URL: z
    .string()
    .default(resolve(process.cwd(), "prisma", "ordo.db").replace(/^file:/, "")),
  JWT_SECRET: z.string().optional(),
  REGISTRATION_ENABLED: z
    .string()
    .transform((v) => v.toLowerCase())
    .default("true"),
  EMAIL_VERIFICATION_REQUIRED: z
    .string()
    .transform((v) => v.toLowerCase())
    .default("false"),
  CORS_ALLOWED_ORIGINS: z.string().default(""),
  SMTP_URL: z.string().optional(),
  SMTP_FROM: z.string().default(`${APP_NAME} <noreply@ordo.local>`),
  RATE_LIMIT_ENABLED: z.string().optional(),
  TRUST_PROXY: z.coerce.number().int().min(0).max(32).default(0),
  PROFILE_PICTURE_MAX_BYTES: z.coerce
    .number()
    .int()
    .positive()
    .max(20 * 1024 * 1024)
    .default(AVATAR.DEFAULT_MAX_BYTES),
  AVATAR_STORAGE: z.enum(["filesystem", "database"]).default("filesystem"),
  AVATAR_DIR: z.string().optional(),
  AVATAR_ALLOW_ANIMATED: z
    .string()
    .transform((v) => v.toLowerCase())
    .default("false"),
  MFA_REQUIRED: z
    .string()
    .transform((v) => v.toLowerCase())
    .default("false"),
});

function toBool(v: string): boolean {
  return v === "true" || v === "1" || v === "yes" || v === "on";
}

/** Generate and persist a stable secret so tokens survive restarts. */
function resolveSecret(): string {
  const fromEnv = process.env.JWT_SECRET?.trim();
  if (fromEnv) return fromEnv;

  const secretPath = join(process.cwd(), ".ordo-secret");
  if (existsSync(secretPath)) {
    return readFileSync(secretPath, "utf8").trim();
  }
  const generated = randomBytes(48).toString("hex");
  try {
    mkdirSync(process.cwd(), { recursive: true });
    writeFileSync(secretPath, generated, { mode: 0o600 });
  } catch {
    // best-effort persistence; if it fails we still boot with an in-memory secret
  }
  return generated;
}

function sqliteFilePath(databaseUrl: string): string | null {
  if (!databaseUrl.startsWith("file:")) return null;
  return databaseUrl.slice("file:".length);
}

function isAbsoluteFilePath(path: string): boolean {
  return path.startsWith("/") || /^[A-Za-z]:[\\/]/.test(path);
}

/**
 * Prisma Client resolves relative `file:` URLs from cwd, while `prisma db push`
 * resolves them from the schema directory. Normalize so `file:./ordo.db` (as
 * documented in `.env.example`) always targets `prisma/ordo.db`.
 */
export function resolveDatabaseUrl(raw: string): string {
  const pathPart = raw.startsWith("file:") ? raw.slice("file:".length) : raw;
  if (!pathPart) return raw.startsWith("file:") ? raw : `file:${raw}`;
  if (isAbsoluteFilePath(pathPart)) return `file:${pathPart}`;
  return `file:${resolve(process.cwd(), "prisma", pathPart)}`;
}

/** Unique per database file so tests and instances don't share `/tmp/avatars`. */
export function defaultAvatarDir(databaseUrl: string): string {
  const dbPath = sqliteFilePath(databaseUrl);
  if (dbPath) {
    const base = dbPath.replace(/\.db$/i, "");
    return `${base}-avatars`;
  }
  return resolve(process.cwd(), "data", "avatars");
}

export function loadConfig(): AppConfig {
  const parsed = EnvSchema.parse(process.env);
  const secret = resolveSecret();

  const corsRaw = (parsed.CORS_ALLOWED_ORIGINS ?? "").trim();
  const corsAllowedOrigins = corsRaw
    ? corsRaw
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean)
    : [];

  const databaseUrl = resolveDatabaseUrl(parsed.DATABASE_URL);

  const avatarDirRaw = parsed.AVATAR_DIR?.trim();
  const avatarDir = avatarDirRaw
    ? resolve(avatarDirRaw)
    : defaultAvatarDir(databaseUrl);

  return {
    port: parsed.PORT,
    databaseUrl,
    jwtSecret: secret,
    registrationEnabled: toBool(parsed.REGISTRATION_ENABLED),
    emailVerificationRequired: toBool(parsed.EMAIL_VERIFICATION_REQUIRED),
    corsAllowedOrigins,
    smtpUrl: parsed.SMTP_URL?.trim() || null,
    smtpFrom: parsed.SMTP_FROM,
    rateLimitEnabled: resolveRateLimitEnabled(parsed.RATE_LIMIT_ENABLED),
    trustProxy: parsed.TRUST_PROXY,
    profilePictureMaxBytes: parsed.PROFILE_PICTURE_MAX_BYTES,
    avatarStorage: parsed.AVATAR_STORAGE,
    avatarDir,
    avatarAllowAnimated: toBool(parsed.AVATAR_ALLOW_ANIMATED),
    mfaRequired: toBool(parsed.MFA_REQUIRED),
  };
}

function resolveRateLimitEnabled(raw: string | undefined): boolean {
  if (raw !== undefined && raw.trim() !== "") return toBool(raw);
  return process.env.NODE_ENV !== "test";
}
