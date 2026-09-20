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
  /**
   * Bearer/query secret for GET /api/telemetry/stats. Empty disables the page
   * (self-host default). Heartbeats still work without it.
   */
  telemetryStatsSecret: string;
}

const EnvSchema = z.object({
  PORT: z.coerce.number().int().positive().default(3000),
  DATABASE_URL: z
    .string()
    .default(resolve(process.cwd(), "prisma", "ordo.db").replace(/^file:/, "")),
  JWT_SECRET: z.string().optional(),
  REGISTRATION_ENABLED: z
    .string()
    .default("true")
    .transform((v) => v.toLowerCase()),
  EMAIL_VERIFICATION_REQUIRED: z
    .string()
    .default("false")
    .transform((v) => v.toLowerCase()),
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
    .default("false")
    .transform((v) => v.toLowerCase()),
  MFA_REQUIRED: z
    .string()
    .default("false")
    .transform((v) => v.toLowerCase()),
  TELEMETRY_STATS_SECRET: z.string().optional(),
});

function toBool(v: string): boolean {
  return v === "true" || v === "1" || v === "yes" || v === "on";
}

/** Parse a dotenv file. Quotes are stripped; existing keys in `env` win. */
export function parseDotEnv(text: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    const eq = line.indexOf("=");
    if (eq <= 0) continue;
    const key = line.slice(0, eq).trim();
    let value = line.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    out[key] = value;
  }
  return out;
}

/** Fill missing keys on `env` from a dotenv file. No-op if the file is absent. */
export function applyDotEnvFile(filePath: string, env: NodeJS.ProcessEnv = process.env): void {
  if (!existsSync(filePath)) return;
  const parsed = parseDotEnv(readFileSync(filePath, "utf8"));
  for (const [key, value] of Object.entries(parsed)) {
    if (env[key] === undefined) env[key] = value;
  }
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
 * Prisma Client resolves relative `file:` URLs from cwd, while `prisma migrate`
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
  // Tests pass env explicitly. A local `.env` should not leak into Jest.
  if (process.env.NODE_ENV !== "test") {
    applyDotEnvFile(join(process.cwd(), ".env"));
  }
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
    telemetryStatsSecret: parsed.TELEMETRY_STATS_SECRET?.trim() ?? "",
  };
}

function resolveRateLimitEnabled(raw: string | undefined): boolean {
  if (raw !== undefined && raw.trim() !== "") return toBool(raw);
  return process.env.NODE_ENV !== "test";
}
