#!/usr/bin/env node
/**
 * Install, migrate, and optionally start the Ordo backend.
 *
 * Updates install a published GitHub Release (latest stable, or the one you
 * pick). They do not pull the current branch. Interactive on a TTY. Non-interactive
 * with --yes, CI=true, or a non-TTY stdin.
 *
 *   curl -fsSL https://ordo.axolet.com/install | bash
 *   ./scripts/deploy-server
 *   ./scripts/deploy-server update
 *   ./scripts/deploy-server update --yes --release v0.1.0
 *   ./scripts/deploy-server uninstall
 *   ./scripts/deploy-server --help
 */
"use strict";

const { spawnSync } = require("node:child_process");
const {
  closeSync,
  copyFileSync,
  existsSync,
  mkdirSync,
  openSync,
  readFileSync,
  readlinkSync,
  readSync,
  rmSync,
  statSync,
  writeFileSync,
} = require("node:fs");
const { dirname, isAbsolute, join, relative, resolve } = require("node:path");
const readline = require("node:readline/promises");
const { stdin, stdout } = require("node:process");
const { createHash } = require("node:crypto");
const {
  DEFAULT_REPO,
  applySelectedRelease,
  chooseListedRelease,
  formatReleaseMenu,
  githubToken,
  listReleases,
  normalizeReleaseSpec,
  normalizeRepo,
  planLines,
  readInstalledRelease,
  releaseApplyMode,
  releaseByTag,
  resolveReleaseChoice,
  visibleReleases,
} = require("./server-release.js");
const { compareVersions } = require("./release-policy.js");
const { hiddenPreCount, promptReleaseMenu, releaseMenuRows } = require("./release-menu.js");
const { promptChoiceMenu } = require("./choice-menu.js");

const HELP = `Usage: deploy-server [install|update|uninstall] [options]

Install, update, and migrate the Ordo backend from a GitHub Release.

From a fresh machine:

  curl -fsSL https://ordo.axolet.com/install | bash

Commands
  install    First-time setup: a guided wizard (on a TTY) that writes a complete,
             documented apps/server/.env — including generated secrets — then
             installs dependencies, builds, and prepares the database
  update     Keep .env, install a release, backup SQLite, rebuild, apply pending migrations
  uninstall  Stop the server and remove this install, including the database

If you omit the command and this already looks like an install (.env or a
database), update is assumed. Otherwise install is assumed.

A release is a published GitHub Release, not the tip of main or whatever
branch is checked out. On a terminal, move with the arrow keys and press
enter. Type a version to jump to a specific tag. --yes with no --release
installs the latest stable release.

Modes
  Interactive (default on a terminal): a step-by-step wizard. Arrow keys
  move, enter selects, enter on a blank line keeps the default, and every
  answer is shown in a summary you confirm before anything is written.
  Non-interactive: --yes, CI=true, or piped stdin. Uses flags and defaults.

Options
  -y, --yes, --non-interactive   Do not prompt
  --release <tag|latest>         Release to install (default latest; latest-pre includes pre-releases)
  --pre                          Let "latest" be a pre-release, and show pre-releases in the menu
  --repo <owner/name>            GitHub repository (default ${DEFAULT_REPO})
  --require-asset                Refuse a release that has no ordo-server-vX.Y.Z.tar.gz asset
  --source-archive               Use the GitHub source archive even when the server asset exists
  --no-release                   Do not download a release; build the tree already on disk
  --from-git                     git pull --ff-only the current branch instead of a release
  --port <n>                     HTTP port (default 3000)
  --registration <bool>          Allow sign-ups after the first account (default false)
  --public                       Listen on 0.0.0.0 instead of 127.0.0.1
  --email-verification <bool>    Require a code on sign-up (default false)
  --mfa-required <bool>          Require MFA for every account (default false)
  --smtp-url <url>               SMTP URL; omit to print codes in the console
  --smtp-from <addr>             From address when SMTP is set
  --smtp-required <bool>         Never print codes; fail when mail cannot send
                                 (default: true when --smtp-url is passed)
  --trust-proxy <n>              Reverse-proxy hops (default 0; 1 behind nginx/Caddy)
  --cors <origins>               Extra browser origins (empty = same-origin + localhost)
  --database-url <url>           SQLite URL (default file:./ordo.db)
  --jwt-secret <secret>          Session secret (default: generated and written to .env)
  --write-env                    Write apps/server/.env in non-interactive mode
  --force-env                    Overwrite an existing .env
  --migrate-env                  Rewrite an existing .env in the documented format
                                 (values, secrets, and custom keys are preserved)
  --no-write-env                 Never write .env
  --pull                         Same as --from-git
  --no-pull                      Same as --no-release
  --backup                       Snapshot SQLite before migrating (default)
  --no-backup                    Do not snapshot SQLite
  --start                        Start the server in the foreground when done
  --no-start                     Do not start (non-interactive default)
  --skip-install                 Skip pnpm install
  --skip-build                   Skip compile
  --skip-migrate                 Skip prisma generate / schema upgrade
  --dry-run                      Print the plan without changing anything
  -h, --help                     Show this help

Running server
  update stops an ordo process that is already listening on the port before
  it snapshots or migrates SQLite, then starts that process again in the
  background (logs: apps/server/ordo.log). --start still runs in the
  foreground. --no-start leaves it stopped. A different program on the port
  is left alone, and the script refuses to bind over it.

Release data
  .env (complete and documented, secrets included), .ordo-secret,
  .ordo-library-key, SQLite, backups, and avatars under apps/server/prisma/
  are kept. Other files are replaced by the release. An update can rewrite
  .env into the documented format with --migrate-env (or by prompt); every
  existing value is carried over.

Database
  Missing or empty SQLite file  → generate client, apply all migrations
  Already on Prisma migrate     → generate client, apply pending migrations
  Old db-push file (has tables, no _prisma_migrations)
                                → generate client, then the same boot-time adopt
                                  used by the server (repair, baseline, later SQL, FTS).
                                  Do not run prisma migrate deploy yourself on that
                                  file; this command handles it.

Examples
  ./scripts/deploy-server
  ./scripts/deploy-server --yes
  ./scripts/deploy-server update
  ./scripts/deploy-server update --yes
  ./scripts/deploy-server update --yes --release v0.1.0
  ./scripts/deploy-server update --yes --release latest --pre
  ./scripts/deploy-server update --from-git
  ./scripts/deploy-server --yes --port 8080 --trust-proxy 1 --start
  ./scripts/deploy-server --yes --public --registration true
  ./scripts/deploy-server uninstall
  ./scripts/deploy-server uninstall --yes
`;

const DEFAULTS = {
  port: 3000,
  registration: false,
  listenHost: "127.0.0.1",
  emailVerification: false,
  mfaRequired: false,
  smtpUrl: "",
  smtpFrom: "",
  smtpRequired: false,
  trustProxy: 0,
  cors: "",
  databaseUrl: "file:./ordo.db",
  jwtSecret: "",
};

function parseBool(raw, flag) {
  const v = String(raw).trim().toLowerCase();
  if (["1", "true", "yes", "on"].includes(v)) return true;
  if (["0", "false", "no", "off"].includes(v)) return false;
  throw new Error(`${flag} expects a boolean, got ${JSON.stringify(raw)}`);
}

function parsePort(raw) {
  const n = Number(raw);
  if (!Number.isInteger(n) || n < 1 || n > 65535) {
    throw new Error(`--port expects an integer 1–65535, got ${JSON.stringify(raw)}`);
  }
  return n;
}

function parseTrustProxy(raw) {
  const n = Number(raw);
  if (!Number.isInteger(n) || n < 0 || n > 32) {
    throw new Error(`--trust-proxy expects an integer 0–32, got ${JSON.stringify(raw)}`);
  }
  return n;
}

function takeValue(argv, i, flag) {
  const next = argv[i + 1];
  if (next == null || next.startsWith("-")) {
    throw new Error(`${flag} requires a value`);
  }
  return next;
}

function splitFlag(arg) {
  const eq = arg.indexOf("=");
  if (eq === -1) return [arg, null];
  return [arg.slice(0, eq), arg.slice(eq + 1)];
}

/** Parse CLI args. Throws on unknown flags or bad values. */
function parseArgs(argv) {
  const args = {
    command: null,
    help: false,
    yes: false,
    writeEnv: null,
    forceEnv: false,
    migrateEnv: false,
    start: null,
    pull: null,
    backup: null,
    skipInstall: false,
    skipBuild: false,
    skipMigrate: false,
    dryRun: false,
    release: null,
    pre: false,
    repo: null,
    noRelease: false,
    fromGit: false,
    requireAsset: false,
    sourceArchive: false,
    port: null,
    registration: null,
    public: false,
    emailVerification: null,
    mfaRequired: null,
    smtpUrl: null,
    smtpFrom: null,
    smtpRequired: null,
    trustProxy: null,
    cors: null,
    databaseUrl: null,
    jwtSecret: null,
  };

  for (let i = 0; i < argv.length; i += 1) {
    const [flag, inline] = splitFlag(argv[i]);
    const consume = () => {
      if (inline != null) return inline;
      const v = takeValue(argv, i, flag);
      i += 1;
      return v;
    };

    switch (flag) {
      case "-h":
      case "--help":
        args.help = true;
        break;
      case "-y":
      case "--yes":
      case "--non-interactive":
        args.yes = true;
        break;
      case "--write-env":
        args.writeEnv = true;
        break;
      case "--no-write-env":
        args.writeEnv = false;
        break;
      case "--force-env":
        args.forceEnv = true;
        break;
      case "--start":
        args.start = true;
        break;
      case "--no-start":
        args.start = false;
        break;
      case "--release":
        args.release = consume();
        break;
      case "--pre":
        args.pre = true;
        break;
      case "--repo":
        args.repo = normalizeRepo(consume());
        break;
      case "--require-asset":
        args.requireAsset = true;
        break;
      case "--source-archive":
        args.sourceArchive = true;
        break;
      case "--no-release":
        args.noRelease = true;
        break;
      case "--from-git":
        args.fromGit = true;
        break;
      case "--pull":
        args.pull = true;
        args.fromGit = true;
        break;
      case "--no-pull":
        args.pull = false;
        args.noRelease = true;
        break;
      case "--backup":
        args.backup = true;
        break;
      case "--no-backup":
        args.backup = false;
        break;
      case "--skip-install":
        args.skipInstall = true;
        break;
      case "--skip-build":
        args.skipBuild = true;
        break;
      case "--skip-migrate":
        args.skipMigrate = true;
        break;
      case "--dry-run":
        args.dryRun = true;
        break;
      case "--port":
        args.port = parsePort(consume());
        break;
      case "--public":
        args.public = true;
        break;
      case "--registration":
        args.registration = parseBool(consume(), flag);
        break;
      case "--email-verification":
        args.emailVerification = parseBool(consume(), flag);
        break;
      case "--mfa-required":
        args.mfaRequired = parseBool(consume(), flag);
        break;
      case "--smtp-url":
        args.smtpUrl = consume();
        break;
      case "--smtp-from":
        args.smtpFrom = consume();
        break;
      case "--smtp-required":
        args.smtpRequired = parseBool(consume(), flag);
        break;
      case "--migrate-env":
        args.migrateEnv = true;
        break;
      case "--trust-proxy":
        args.trustProxy = parseTrustProxy(consume());
        break;
      case "--cors":
        args.cors = consume();
        break;
      case "--database-url":
        args.databaseUrl = consume();
        break;
      case "--jwt-secret":
        args.jwtSecret = consume();
        break;
      default:
        if (!flag.startsWith("-") && (flag === "install" || flag === "update" || flag === "uninstall")) {
          if (args.command) throw new Error("Specify only one of install, update, or uninstall.");
          args.command = flag;
          break;
        }
        throw new Error(`Unknown option ${flag}. See --help.`);
    }
  }

  if (args.fromGit && args.noRelease) {
    throw new Error("Use either --from-git or --no-release, not both.");
  }
  if (args.release && args.fromGit) {
    throw new Error("--release cannot be combined with --from-git.");
  }
  if (args.release && args.noRelease) {
    throw new Error("--release cannot be combined with --no-release.");
  }
  if (args.repo) normalizeRepo(args.repo);

  return args;
}

function isInteractive(args, env = process.env, stream = stdin) {
  if (args.yes) return false;
  if (env.CI === "true" || env.CI === "1") return false;
  return Boolean(stream.isTTY);
}

function findRepoRoot(startDir) {
  let dir = resolve(startDir);
  while (true) {
    if (
      existsSync(join(dir, "pnpm-workspace.yaml")) &&
      existsSync(join(dir, "apps", "server", "package.json"))
    ) {
      return dir;
    }
    const parent = dirname(dir);
    if (parent === dir) {
      throw new Error("Run this from the ordo repository (missing pnpm-workspace.yaml).");
    }
    dir = parent;
  }
}

function isAbsoluteFilePath(path) {
  return path.startsWith("/") || /^[A-Za-z]:[\\/]/.test(path);
}

/**
 * Same rule as apps/server/src/config/configuration.ts resolveDatabaseUrl,
 * using apps/server as cwd.
 */
function sqlitePathFromUrl(databaseUrl, serverDir) {
  const raw = databaseUrl.startsWith("file:") ? databaseUrl.slice("file:".length) : databaseUrl;
  if (!raw) return join(serverDir, "prisma", "ordo.db");
  if (isAbsoluteFilePath(raw)) return raw;
  return resolve(serverDir, "prisma", raw);
}

function parseDotEnv(text) {
  const out = {};
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

function loadExistingEnv(envPath) {
  if (!existsSync(envPath)) return {};
  return parseDotEnv(readFileSync(envPath, "utf8"));
}

function envBool(raw, fallback) {
  if (raw == null || raw === "") return fallback;
  const v = String(raw).trim().toLowerCase();
  if (["1", "true", "yes", "on"].includes(v)) return true;
  if (["0", "false", "no", "off"].includes(v)) return false;
  return fallback;
}

function envInt(raw, fallback) {
  if (raw == null || raw === "") return fallback;
  const n = Number(raw);
  return Number.isInteger(n) ? n : fallback;
}

function settingsFromSources(args, existingEnv) {
  return {
    port: args.port ?? envInt(existingEnv.PORT, DEFAULTS.port),
    registration: args.registration ?? envBool(existingEnv.REGISTRATION_ENABLED, DEFAULTS.registration),
    listenHost: args.public
      ? "0.0.0.0"
      : existingEnv.LISTEN_HOST?.trim() || DEFAULTS.listenHost,
    emailVerification:
      args.emailVerification ??
      envBool(existingEnv.EMAIL_VERIFICATION_REQUIRED, DEFAULTS.emailVerification),
    mfaRequired: args.mfaRequired ?? envBool(existingEnv.MFA_REQUIRED, DEFAULTS.mfaRequired),
    smtpUrl: args.smtpUrl ?? existingEnv.SMTP_URL ?? DEFAULTS.smtpUrl,
    smtpFrom: args.smtpFrom ?? existingEnv.SMTP_FROM ?? DEFAULTS.smtpFrom,
    // Fail closed: an explicit --smtp-url means codes must go by email.
    smtpRequired:
      args.smtpRequired ??
      (args.smtpUrl != null ? true : envBool(existingEnv.SMTP_REQUIRED, DEFAULTS.smtpRequired)),
    trustProxy: args.trustProxy ?? envInt(existingEnv.TRUST_PROXY, DEFAULTS.trustProxy),
    cors: args.cors ?? existingEnv.CORS_ALLOWED_ORIGINS ?? DEFAULTS.cors,
    databaseUrl: args.databaseUrl ?? existingEnv.DATABASE_URL ?? DEFAULTS.databaseUrl,
    jwtSecret: args.jwtSecret ?? existingEnv.JWT_SECRET ?? DEFAULTS.jwtSecret,
  };
}

function quoteEnv(value) {
  if (/^[A-Za-z0-9_./-]*$/.test(value)) return value;
  return JSON.stringify(value);
}

/** Every key renderEnv manages. Anything else in an old .env is preserved. */
const MANAGED_ENV_KEYS = new Set([
  "PORT",
  "LISTEN_HOST",
  "CORS_ALLOWED_ORIGINS",
  "REGISTRATION_ENABLED",
  "EMAIL_VERIFICATION_REQUIRED",
  "MFA_REQUIRED",
  "SMTP_URL",
  "SMTP_FROM",
  "SMTP_REQUIRED",
  "DATABASE_URL",
  "JWT_SECRET",
  "LIBRARY_KEK",
  "TRUST_PROXY",
  "RATE_LIMIT_ENABLED",
]);

/**
 * Render a complete, documented apps/server/.env. Production installs get an
 * explicit file: every supported key is present, secrets included, so the
 * server never has to invent configuration at boot.
 */
function renderEnv(settings, opts = {}) {
  const secrets = opts.secrets ?? {};
  const preserved = opts.preserved ?? {};
  const stamp = opts.stamp ?? new Date().toISOString().slice(0, 10);
  const lines = [
    "# ordo server configuration",
    `# Written by scripts/deploy-server on ${stamp}.`,
    "# Every key is documented here and in apps/server/.env.example.",
    "# Edit, restart the server, done:  cd apps/server && NODE_ENV=production pnpm start",
    "",
    "# ── HTTP ────────────────────────────────────────────────────────────────",
    "# Port browsers and reverse proxies connect to.",
    `PORT=${settings.port}`,
    "# Bind address. 127.0.0.1 = this machine only; 0.0.0.0 = this machine and the LAN.",
    `LISTEN_HOST=${settings.listenHost}`,
    "# Extra browser origins allowed besides this API (comma-separated).",
    `CORS_ALLOWED_ORIGINS=${quoteEnv(settings.cors)}`,
    "",
    "# ── Accounts ────────────────────────────────────────────────────────────",
    "# Allow sign-ups after the first account. The first account can always register,",
    "# so a private instance can still be created.",
    `REGISTRATION_ENABLED=${settings.registration}`,
    "# Require a one-time email code when signing up or changing email.",
    `EMAIL_VERIFICATION_REQUIRED=${settings.emailVerification}`,
    "# Require TOTP multi-factor auth for every account (users cannot opt out).",
    `MFA_REQUIRED=${settings.mfaRequired}`,
    "",
    "# ── Mail ────────────────────────────────────────────────────────────────",
    "# SMTP URL for verification codes and notices, e.g.",
    "#   smtp://user:pass@smtp.example.com:587        (587 = STARTTLS)",
    `SMTP_URL=${settings.smtpUrl ? quoteEnv(settings.smtpUrl) : ""}`,
    "# From address people see in their inbox.",
    `SMTP_FROM=${quoteEnv(settings.smtpFrom || "ordo <noreply@ordo.local>")}`,
    "# true = codes are only ever sent by email; mail failures are errors.",
    "# false = fall back to printing codes in the server log.",
    `SMTP_REQUIRED=${settings.smtpRequired ?? Boolean(settings.smtpUrl)}`,
    "",
    "# ── Database ────────────────────────────────────────────────────────────",
    "# SQLite file. Relative paths resolve from apps/server/prisma/.",
    `DATABASE_URL=${quoteEnv(settings.databaseUrl)}`,
    "",
    "# ── Security ────────────────────────────────────────────────────────────",
    "# Session secret. Generated by setup; everyone is signed out if it changes.",
    "# Keep a copy with your database backups.",
    secrets.jwtSecret
      ? `JWT_SECRET=${quoteEnv(secrets.jwtSecret)}`
      : "# JWT_SECRET=   # run scripts/deploy-server to generate one",
    "# Wraps the per-library encryption keys. Generated by setup; losing it",
    "# loses access to encrypted libraries. Keep a copy with your backups.",
    secrets.libraryKek
      ? `LIBRARY_KEK=${quoteEnv(secrets.libraryKek)}`
      : "# LIBRARY_KEK=   # run scripts/deploy-server to generate one",
    "",
    "# ── Network & limits ────────────────────────────────────────────────────",
    "# Reverse-proxy hops to trust for X-Forwarded-For. 0 = socket address only.",
    "# Set to 1 behind nginx, Caddy, or a Cloudflare tunnel (deploy/ has examples).",
    `TRUST_PROXY=${settings.trustProxy}`,
    "# In-memory rate limiting for sign-in, sign-up, and resets. Keep on.",
    `RATE_LIMIT_ENABLED=${settings.rateLimitEnabled ?? true}`,
  ];
  const extra = Object.entries(preserved).filter(([key]) => !MANAGED_ENV_KEYS.has(key));
  if (extra.length) {
    lines.push(
      "",
      "# ── Preserved from your previous .env ───────────────────────────────────",
      ...extra.map(([key, value]) => `${key}=${quoteEnv(value)}`),
    );
  }
  lines.push("");
  return lines.join("\n");
}

/**
 * Resolve the two secrets for an explicit .env: existing env value first (so
 * sessions and encrypted libraries survive), then the legacy sidecar files
 * the server used to auto-generate, then a fresh value.
 */
function resolveSetupSecrets(serverDir, existingEnv = {}, { randomBytesFn } = {}) {
  const random = randomBytesFn ?? require("node:crypto").randomBytes;
  const readTrim = (path) => {
    try {
      return readFileSync(path, "utf8").trim() || null;
    } catch {
      return null;
    }
  };
  const fromEnvJwt = existingEnv.JWT_SECRET?.trim() || null;
  const fromEnvKek = existingEnv.LIBRARY_KEK?.trim() || null;
  const fileJwt = readTrim(join(serverDir, ".ordo-secret"));
  const fileKek = readTrim(join(serverDir, ".ordo-library-key"));
  return {
    jwtSecret: fromEnvJwt ?? fileJwt ?? random(48).toString("hex"),
    libraryKek: fromEnvKek ?? fileKek ?? random(32).toString("hex"),
    jwtSource: fromEnvJwt ? "env" : fileJwt ? "file" : "generated",
    kekSource: fromEnvKek ? "env" : fileKek ? "file" : "generated",
  };
}

/** Keys from an old .env that renderEnv does not manage, so nothing is lost. */
function preservedEnvKeys(existingEnv = {}) {
  const out = {};
  for (const [key, value] of Object.entries(existingEnv)) {
    if (!MANAGED_ENV_KEYS.has(key)) out[key] = value;
  }
  return out;
}

/** An .env written before setup made secrets explicit can be migrated. */
function needsEnvMigration(existingEnv = {}) {
  return !existingEnv.JWT_SECRET || !existingEnv.LIBRARY_KEK;
}

/** Validate an SMTP URL the wizard accepts. Returns an error string or null. */
function validateSmtpUrl(raw) {
  const value = String(raw).trim();
  if (value === "" || value === "(empty)") return null;
  let url;
  try {
    url = new URL(value);
  } catch {
    return "That is not a URL. Try smtp://user:pass@smtp.example.com:587";
  }
  if (url.protocol !== "smtp:" && url.protocol !== "smtps:") {
    return "The URL must start with smtp:// or smtps://";
  }
  if (!url.hostname) {
    return "The URL needs a mail host, like smtp://user:pass@smtp.example.com:587";
  }
  return null;
}

function ignoreSqliteExperimentalWarning() {
  if (ignoreSqliteExperimentalWarning.installed) return;
  ignoreSqliteExperimentalWarning.installed = true;
  const { emitWarning } = process;
  process.emitWarning = (warning, ...args) => {
    const message = typeof warning === "string" ? warning : warning?.message;
    if (typeof message === "string" && message.includes("SQLite is an experimental feature")) {
      return;
    }
    return emitWarning.call(process, warning, ...args);
  };
}

function inspectDatabase(filePath) {
  ignoreSqliteExperimentalWarning();
  if (!existsSync(filePath)) return { kind: "missing", tables: [] };
  const size = statSync(filePath).size;
  if (size === 0) return { kind: "empty", tables: [] };

  const header = Buffer.alloc(16);
  const fd = openSync(filePath, "r");
  try {
    readSync(fd, header, 0, 16, 0);
  } finally {
    closeSync(fd);
  }
  if (!header.toString("utf8").startsWith("SQLite format 3")) {
    return { kind: "other", tables: [] };
  }

  const { DatabaseSync } = require("node:sqlite");
  const db = new DatabaseSync(filePath, { readOnly: true });
  try {
    const tables = db
      .prepare(`SELECT name FROM sqlite_master WHERE type = 'table'`)
      .all()
      .map((row) => String(row.name));
    const names = new Set(tables);
    if (names.has("_prisma_migrations")) return { kind: "migrated", tables };
    if (names.has("User") || names.has("Bookmark") || names.has("Folder")) {
      return { kind: "legacy", tables };
    }
    return { kind: "empty", tables };
  } finally {
    db.close();
  }
}

function migratePlan(kind, skipMigrate) {
  if (skipMigrate) {
    return {
      action: "skip",
      reason: "Skipping Prisma generate/migrate (--skip-migrate).",
    };
  }
  if (kind === "other") {
    return {
      action: "error",
      reason: "DATABASE_URL does not point at a SQLite file.",
    };
  }
  if (kind === "legacy") {
    return {
      action: "adopt",
      reason:
        "Existing database has no Prisma migration history. Generating the client, then adopting it (repair, baseline, later SQL, FTS). Do not run prisma migrate deploy on this file.",
    };
  }
  if (kind === "migrated") {
    return {
      action: "deploy",
      reason: "Database is already on Prisma migrate. Generating the client and applying pending migrations.",
    };
  }
  return {
    action: "setup",
    reason: "No application schema yet. Generating the client and applying migrations.",
  };
}

function looksInstalled(envPath, dbPath, secretPath) {
  if (existsSync(envPath)) return true;
  if (secretPath && existsSync(secretPath)) return true;
  if (existsSync(dbPath) && statSync(dbPath).size > 0) return true;
  return false;
}

function inferCommand(explicit, installed) {
  if (explicit === "install" || explicit === "update" || explicit === "uninstall") return explicit;
  return installed ? "update" : "install";
}

function isInsideDir(parent, child) {
  const root = resolve(parent);
  const target = resolve(child);
  const rel = relative(root, target);
  return rel === "" || (!rel.startsWith("..") && !isAbsolute(rel));
}

function assertSafeUninstallRoot(repoRoot, home) {
  const root = resolve(repoRoot);
  if (root === "/" || root === resolve(home || "")) {
    throw new Error(`Refusing to remove ${root}.`);
  }
}

/** True when this pid is the server or the pnpm process that started it. */
function installProcess(details, serverDir) {
  if (!details?.cwd || !details.cmdline) return false;
  if (resolve(details.cwd) !== resolve(serverDir)) return false;
  return details.cmdline.includes("dist/main.js") || details.cmdline.includes("pnpm");
}

function stopProcessGroup(pid, log) {
  log(`Stopping ordo (pid ${pid}).`);
  const signal = (sig) => {
    try {
      process.kill(-pid, sig);
    } catch (error) {
      if (error.code === "ESRCH") return;
      try {
        process.kill(pid, sig);
      } catch (inner) {
        if (inner.code !== "ESRCH") throw inner;
      }
    }
  };
  signal("SIGTERM");
  const deadline = Date.now() + 15000;
  while (Date.now() < deadline) {
    if (!pidAlive(pid)) return;
    sleepMs(200);
  }
  log(`ordo (pid ${pid}) did not exit. Sending SIGKILL.`);
  signal("SIGKILL");
}

function stopInstalledServer(serverDir, port, log) {
  const pidPath = join(serverDir, ".ordo.pid");
  const pids = new Set();
  const filed = readPidFile(pidPath);
  if (filed) pids.add(filed);
  const listener = classifyPort(port, serverDir, pidPath, listenSnapshot(port));
  if (listener?.kind === "ordo") pids.add(listener.pid);
  for (const pid of pids) {
    if (!pidAlive(pid)) continue;
    if (!installProcess(processDetails(pid), serverDir)) continue;
    stopProcessGroup(pid, log);
  }
  if (listener?.kind === "other") {
    log(`Left ${listener.command} (pid ${listener.pid}) running. It is not ordo.`);
  }
}

async function uninstallCommand({
  repoRoot,
  args,
  interactive,
  choose,
  ask,
  log,
  home,
  stopInstall,
}) {
  const root = resolve(repoRoot);
  const serverDir = join(root, "apps", "server");
  assertSafeUninstallRoot(root, home);
  if (existsSync(join(root, ".git"))) {
    throw new Error(
      `${root} is a git checkout.\nUninstall removes an installed copy, not a source checkout.`,
    );
  }
  const envText = existsSync(join(serverDir, ".env")) ? readFileSync(join(serverDir, ".env"), "utf8") : "";
  const dbPath = sqlitePathFromUrl(parseDotEnv(envText).DATABASE_URL || "file:./ordo.db", serverDir);
  const outside = isInsideDir(root, dbPath) ? null : dbPath;
  if (args.dryRun) {
    log(`Would stop ordo and remove ${root}`);
    if (outside) log(`Would leave the database at ${outside}`);
    return { ok: true, command: "uninstall", dryRun: true, removed: false, database: outside };
  }

  let proceed = args.yes === true;
  if (!proceed) {
    if (!interactive) throw new Error(`Pass --yes to remove ${root}.`);
    const question = outside
      ? `Remove ${root}? The database at ${outside} is left in place.`
      : `Remove ${root}, including the database?`;
    proceed = choose
      ? await choose(question, false)
      : ["y", "yes"].includes((await ask(`${question} [y/N] `)).trim().toLowerCase());
  }
  if (!proceed) {
    log("Uninstall cancelled.");
    return { ok: true, command: "uninstall", cancelled: true, removed: false, database: outside };
  }

  const port = Number(parseDotEnv(envText).PORT || DEFAULTS.port);
  (stopInstall ?? stopInstalledServer)(serverDir, Number.isInteger(port) ? port : DEFAULTS.port, log);
  rmSync(root, { recursive: true, force: true });
  log(`Uninstalled Ordo from ${root}`);
  if (outside) log(`Left the database at ${outside}`);
  return { ok: true, command: "uninstall", removed: true, database: outside };
}

function sqlQuote(value) {
  return `'${String(value).replaceAll("'", "''")}'`;
}

function backupStamp(now = new Date()) {
  return now.toISOString().replace(/[:.]/g, "-");
}

/** Snapshot SQLite next to the live file. Prefers VACUUM INTO; copies if that fails. */
function backupSqlite(filePath, { log, dryRun, now } = {}) {
  if (!existsSync(filePath) || statSync(filePath).size === 0) return null;
  const backupPath = `${filePath}.bak-${backupStamp(now)}`;
  log?.(`Backing up SQLite to ${backupPath}`);
  if (dryRun) return backupPath;
  ignoreSqliteExperimentalWarning();
  const { DatabaseSync } = require("node:sqlite");
  const db = new DatabaseSync(filePath);
  try {
    db.exec(`VACUUM INTO ${sqlQuote(backupPath)}`);
  } catch {
    copyFileSync(filePath, backupPath);
  } finally {
    db.close();
  }
  return backupPath;
}

function blockingGitChanges(porcelain) {
  return String(porcelain)
    .split(/\r?\n/)
    .map((line) => line.trimEnd())
    .filter((line) => line && !line.startsWith("??"));
}

function dirtyWorktreeMessage(porcelain, flag = "--no-release") {
  const changes = blockingGitChanges(porcelain);
  if (changes.length === 0) return null;
  return [
    "Working tree has local changes, so switching to a release would fail:",
    ...changes.map((line) => `  ${line}`),
    `Commit or stash them, or pass ${flag}.`,
  ].join("\n");
}

function gitOutput(repoRoot, args) {
  const result = spawnSync("git", args, {
    cwd: repoRoot,
    encoding: "utf8",
  });
  return result;
}

function assertCleanGit(repoRoot, flag = "--no-release") {
  const status = gitOutput(repoRoot, ["status", "--porcelain"]);
  if (status.status !== 0) {
    throw new Error(`git status failed. Fix the repository or pass ${flag}.`);
  }
  const message = dirtyWorktreeMessage(status.stdout ?? "", flag);
  if (message) throw new Error(message);
}

function gitHead(repoRoot) {
  const result = gitOutput(repoRoot, ["rev-parse", "HEAD"]);
  if (result.status !== 0) return null;
  return String(result.stdout ?? "").trim() || null;
}

function shouldReexec(before, after, already) {
  return Boolean(before && after && before !== after && already !== after);
}

function reexecArgs(argv, mode = "git") {
  if (mode === "release") {
    if (argv.includes("--no-release") || argv.includes("--no-pull")) return [...argv];
    return [...argv, "--no-release"];
  }
  if (argv.includes("--no-pull") || argv.includes("--no-release")) return [...argv];
  return [...argv, "--no-pull"];
}

function fileHash(path) {
  if (!existsSync(path)) return null;
  return createHash("sha256").update(readFileSync(path)).digest("hex");
}

/** Continue the update with the script that the release or pull just checked out. */
function reexecDeploy(repoRoot, argv, stamp, env, mode = "git") {
  const script = join(repoRoot, "scripts", "deploy-server.js");
  const stampEnv = mode === "release" ? "ORDO_DEPLOY_SCRIPT" : "ORDO_DEPLOY_HEAD";
  const result = spawnSync(process.execPath, [script, ...reexecArgs(argv, mode)], {
    cwd: repoRoot,
    env: { ...env, [stampEnv]: stamp },
    stdio: "inherit",
  });
  return result.status ?? 1;
}

function gitPull(repoRoot, { log, dryRun } = {}) {
  const gitDir = join(repoRoot, ".git");
  if (!existsSync(gitDir)) {
    log?.("Skipping git pull (no .git directory).");
    return { pulled: false, reason: "no-git" };
  }
  log?.("$ git pull --ff-only");
  if (dryRun) return { pulled: true, reason: "dry-run" };
  assertCleanGit(repoRoot, "--no-pull");
  const result = spawnSync("git", ["pull", "--ff-only"], {
    cwd: repoRoot,
    stdio: "inherit",
  });
  if (result.status !== 0) {
    throw new Error(
      "git pull --ff-only failed. Fix the working tree and try again, or pass --no-pull.",
    );
  }
  return { pulled: true, reason: "ok" };
}

function dependenciesReady(repoRoot) {
  const lock = join(repoRoot, "pnpm-lock.yaml");
  const installed = join(repoRoot, "node_modules", ".pnpm", "lock.yaml");
  if (!existsSync(lock) || !existsSync(installed)) return false;
  return readFileSync(lock).equals(readFileSync(installed));
}

function parseSsPids(text) {
  const pids = new Set();
  for (const match of String(text).matchAll(/pid=(\d+)/g)) {
    pids.add(Number(match[1]));
  }
  return [...pids];
}

function readPidFile(pidPath) {
  if (!existsSync(pidPath)) return null;
  const n = Number(readFileSync(pidPath, "utf8").trim());
  return Number.isInteger(n) && n > 0 ? n : null;
}

function pidAlive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

function processDetails(pid) {
  try {
    if (process.platform === "darwin") {
      // No /proc on macOS; ps + lsof cover the same two facts.
      const ps = spawnSync("ps", ["-p", String(pid), "-o", "command="], { encoding: "utf8" });
      const lsof = spawnSync("lsof", ["-a", "-p", String(pid), "-d", "cwd", "-Fn"], { encoding: "utf8" });
      const cwdLine = (lsof.stdout ?? "").split("\n").find((line) => line.startsWith("n"));
      const cwd = cwdLine ? cwdLine.slice(1) : "";
      const cmdline = (ps.stdout ?? "").trim();
      if (!cmdline && !cwd) return null;
      return { pid, cmdline, cwd };
    }
    const cmdline = readFileSync(`/proc/${pid}/cmdline`).toString("utf8").replaceAll("\0", " ").trim();
    const cwd = readlinkSync(`/proc/${pid}/cwd`);
    return { pid, cmdline, cwd };
  } catch {
    return null;
  }
}

function isOrdoServer(details, serverDir) {
  if (!details) return false;
  return details.cwd === serverDir && details.cmdline.includes("dist/main.js");
}

function classifyPort(port, serverDir, pidPath, ssText) {
  const pids = new Set(snapshotPids(ssText));
  const filed = readPidFile(pidPath);
  if (filed) pids.add(filed);
  let ordo = null;
  for (const pid of pids) {
    if (!pidAlive(pid)) continue;
    const details = processDetails(pid);
    if (isOrdoServer(details, serverDir)) {
      ordo = { kind: "ordo", pid, cwd: details.cwd };
      continue;
    }
    if (snapshotPids(ssText).includes(pid)) {
      return {
        kind: "other",
        pid,
        command: details?.cmdline?.slice(0, 160) || `pid ${pid}`,
      };
    }
  }
  return ordo;
}

function chooseStart({ wasRunning, start }) {
  if (start === true) return "foreground";
  if (wasRunning && start !== false) return "detached";
  return "none";
}

function healthUrl(settings) {
  const host =
    settings.listenHost === "::1" || settings.listenHost === "::" ? "[::1]" : "127.0.0.1";
  return `http://${host}:${settings.port}/api/server/info`;
}

function isOrdoInfo(body) {
  return Boolean(body && typeof body.version === "string" && "registrationEnabled" in body);
}

function sleepMs(ms) {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

function stopPid(pid, log) {
  log(`Stopping ordo (pid ${pid}) so the database can be updated.`);
  try {
    process.kill(pid, "SIGTERM");
  } catch (error) {
    if (error.code === "ESRCH") return;
    throw error;
  }
  const deadline = Date.now() + 15000;
  while (Date.now() < deadline) {
    if (!pidAlive(pid)) return;
    sleepMs(200);
  }
  log(`ordo (pid ${pid}) did not exit. Sending SIGKILL.`);
  try {
    process.kill(pid, "SIGKILL");
  } catch {
    /* already gone */
  }
}

function listenSnapshot(port) {
  const result =
    process.platform === "darwin"
      ? spawnSync("lsof", ["-nP", "-Fp", `-iTCP:${port}`, "-sTCP:LISTEN"], { encoding: "utf8" })
      : spawnSync("ss", ["-lptnH", `sport = :${port}`], { encoding: "utf8" });
  if (result.status !== 0) return "";
  return result.stdout ?? "";
}

/** lsof -Fp emits one `p<PID>` line per listener. */
function parseLsofPids(text) {
  const pids = [];
  for (const match of (text ?? "").matchAll(/^p(\d+)$/gm)) pids.push(Number(match[1]));
  return pids;
}

/** Listener pids from a listenSnapshot, in this platform's format. */
function snapshotPids(text) {
  return process.platform === "darwin" ? parseLsofPids(text) : parseSsPids(text);
}

function startDetached(serverDir, childEnv, logPath, pidPath, log) {
  const { spawn } = require("node:child_process");
  mkdirSync(serverDir, { recursive: true });
  const logFd = openSync(logPath, "a");
  const child = spawn("pnpm", ["start"], {
    cwd: serverDir,
    env: childEnv,
    detached: true,
    stdio: ["ignore", logFd, logFd],
  });
  closeSync(logFd);
  child.unref();
  writeFileSync(pidPath, `${child.pid}\n`, { encoding: "utf8" });
  log(`Started ordo in the background (pid ${child.pid}). Logs: ${logPath}`);
  return child.pid;
}

async function waitForReady(settings, { fetchImpl = globalThis.fetch, attempts = 60, delayMs = 500 } = {}) {
  const url = healthUrl(settings);
  let last = "no response";
  for (let i = 0; i < attempts; i += 1) {
    try {
      const response = await fetchImpl(url);
      if (response.ok) {
        const body = await response.json();
        if (isOrdoInfo(body)) return body;
        last = "response was not ordo";
      } else {
        last = `HTTP ${response.status}`;
      }
    } catch (error) {
      last = error instanceof Error ? error.message : String(error);
    }
    if (i < attempts - 1) sleepMs(delayMs);
  }
  throw new Error(`Server did not become ready at ${url} (${last}).`);
}

function decideWriteEnv(args, envExists) {
  if (args.writeEnv === false) {
    return { write: false, reason: "Not writing .env (--no-write-env)." };
  }
  if (args.forceEnv) {
    return { write: true, reason: "Writing apps/server/.env (--force-env)." };
  }
  if (envExists) {
    return {
      write: false,
      reason: "Leaving existing apps/server/.env in place (pass --force-env to replace it).",
    };
  }
  return { write: true, reason: "Writing apps/server/.env from flags and defaults." };
}

function compareNodeVersion(actual, minimum) {
  const a = actual.split(".").map((n) => Number(n));
  const m = minimum.split(".").map((n) => Number(n));
  for (let i = 0; i < 3; i += 1) {
    const av = a[i] ?? 0;
    const mv = m[i] ?? 0;
    if (av > mv) return 1;
    if (av < mv) return -1;
  }
  return 0;
}

function checkToolchain(repoRoot) {
  const pkg = JSON.parse(readFileSync(join(repoRoot, "package.json"), "utf8"));
  const engines = String(pkg.engines?.node ?? ">=22.13").replace(/^>=/, "");
  if (compareNodeVersion(process.versions.node, engines) < 0) {
    throw new Error(
      `This machine has Node.js ${process.versions.node}. Ordo needs ${engines} or newer.`,
    );
  }
  const pnpm = spawnSync("pnpm", ["--version"], { encoding: "utf8" });
  if (pnpm.status !== 0) {
    throw new Error("pnpm is not installed. See https://pnpm.io/installation");
  }
}

function promptYesNo(question, fallback, io) {
  return promptChoiceMenu({
    title: question,
    detail: io.detail || "",
    options: [
      { label: "Yes", value: true },
      { label: "No", value: false },
    ],
    selected: fallback ? 0 : 1,
    input: io.input,
    output: io.output,
  });
}

/** ANSI helpers. When color is off every helper returns the text unchanged. */
function makePainter(enabled) {
  const wrap = (code) => (text) => (enabled && text ? `\x1b[${code}m${text}\x1b[0m` : text);
  return { bold: wrap("1"), dim: wrap("2"), green: wrap("32"), cyan: wrap("36") };
}

/** The banner the interactive wizard opens with. */
function formatSetupBanner(color = false) {
  const p = makePainter(color);
  return [
    "",
    p.bold("  ordo · self-hosted server"),
    p.dim("  ──────────────────────────"),
    "  A few questions, then this setup:",
    "    1. writes a complete, documented apps/server/.env",
    "    2. generates the session and library-encryption secrets",
    "    3. installs dependencies and compiles the server",
    "    4. creates the database and applies migrations",
    "",
    p.dim("  ↑↓ move    enter select    enter on a blank line keeps the default"),
    "",
  ].join("\n");
}

/** A numbered step header: `Step 2 of 5 · Accounts`. */
function formatStepHeader(step, total, label, color = false) {
  const p = makePainter(color);
  return `\n${p.dim(`Step ${step} of ${total}`)} ${p.bold(`· ${label}`)}`;
}

function describeMail(settings) {
  if (!settings.smtpUrl) return "Codes in the server log";
  return settings.smtpRequired ? "SMTP, email only" : "SMTP, log fallback";
}

function describeNetwork(settings) {
  if (settings.trustProxy > 0) {
    const hops = settings.trustProxy === 1 ? "1 hop" : `${settings.trustProxy} hops`;
    return `Reverse proxy in front, ${hops}`;
  }
  if (settings.listenHost === "0.0.0.0") return "This machine and the LAN";
  return "Only this machine";
}

/** The label/value rows both the summary and the wizard confirm screen share. */
function setupSummaryRows(settings, folder) {
  const host = settings.listenHost === "0.0.0.0" ? "0.0.0.0" : "127.0.0.1";
  const accounts = settings.registration
    ? "Anyone who can reach the server"
    : "Only the first account";
  const signup = settings.emailVerification ? "Email code required" : "No email code";
  const rows = [];
  if (folder) rows.push(`  Folder      ${folder}`);
  rows.push(`  Address     http://${host}:${settings.port}`);
  rows.push(`  Accounts    ${accounts}`);
  rows.push(`  Sign-up     ${signup}`);
  rows.push(`  Mail        ${describeMail(settings)}`);
  rows.push(`  Network     ${describeNetwork(settings)}`);
  return rows;
}

function formatSetupSummary(settings, folder) {
  const lines = ["", "Ready", "", ...setupSummaryRows(settings, folder), ""];
  lines.push("Installing. Compiling the server can take a few minutes.");
  lines.push("");
  return lines.join("\n");
}

/** The panel shown after a successful install or update. */
function formatNextSteps({ settings, dbPath, envPath, launch, color = false }) {
  const p = makePainter(color);
  const host = settings.listenHost === "0.0.0.0" ? "0.0.0.0" : "127.0.0.1";
  const lines = ["", p.bold("  Setup finished"), p.dim("  ─────────────"), ""];
  lines.push(`  Address     http://${host}:${settings.port}`);
  lines.push(`  Config      ${envPath}`);
  lines.push(`  Database    ${dbPath}`);
  if (launch === "detached") lines.push("  Log         apps/server/ordo.log");
  lines.push("");
  lines.push(p.dim("  Keep a copy of the config, the database, and the secrets in it."));
  lines.push("");
  if (launch === "none") {
    lines.push("  Start the server");
    lines.push(p.cyan("    cd apps/server && NODE_ENV=production pnpm start"));
  }
  lines.push("  Check that it answers");
  lines.push(p.cyan(`    curl http://127.0.0.1:${settings.port}/api/server/info`));
  lines.push("  Point the app at it");
  lines.push(p.dim("    Sign in → “Use your own server” → ")
    + p.cyan(`http://<this-host>:${settings.port}`));
  lines.push("  Update later");
  lines.push(p.cyan("    ./scripts/deploy-server update"));
  lines.push("  Remove everything");
  lines.push(p.cyan("    ./scripts/deploy-server uninstall"));
  lines.push("  Full guide");
  lines.push(p.dim("    docs/SERVER-SETUP.md"));
  lines.push("");
  return lines.join("\n");
}

/**
 * The guided, interactive setup wizard. Asks a handful of questions with
 * explanations, validates answers, shows a summary, and lets the operator
 * confirm, redo, or cancel before anything is written.
 */
async function promptGuidedSettings(ask, current, pick, log, extras = {}) {
  const color = extras.color ?? false;
  const p = makePainter(color);
  const portInUse = extras.portInUse ?? (() => null);
  const folder = extras.folder ?? "";
  const TOTAL_STEPS = 5;
  const header = (step, label) => log(formatStepHeader(step, TOTAL_STEPS, label, color));

  while (true) {
    // ── Step 1: Port ────────────────────────────────────────────────────────
    header(1, "Port");
    log("");
    log("  Which port should the server listen on?");
    log(p.dim("  Browsers and reverse proxies connect here. 3000 is fine if it is free."));
    let portDefault = String(current.port);
    const busy = await portInUse(current.port);
    if (busy && busy.kind === "other") {
      log(p.dim(`  Port ${current.port} is already used by another program on this machine,`));
      log(p.dim("  so pick another one (3001 and up are usually free)."));
      portDefault = String(Number(current.port) + 1);
    }
    const portText = (await ask(p.bold(`Port [${portDefault}] `))).trim();
    const port = parsePort(portText === "" ? portDefault : portText);

    // ── Step 2: Accounts ────────────────────────────────────────────────────
    header(2, "Accounts");
    const registration = await pick({
      title: "Who can create an account?",
      detail: "The first sign-up becomes the owner either way.",
      options: [
        { label: "Only the first account", value: false },
        { label: "Anyone who can reach the server", value: true },
      ],
      selected: current.registration ? 1 : 0,
    });

    // ── Step 3: Sign-up email ───────────────────────────────────────────────
    header(3, "Sign-up email");
    const emailVerification = await pick({
      title: "Require an email code for new accounts?",
      detail: "With mail configured the code is emailed; without it the code is printed",
      options: [
        { label: "Sign in straight away", value: false },
        { label: "Send a one-time code first", value: true },
      ],
      selected: current.emailVerification ? 1 : 0,
    });

    // ── Step 4: Mail ────────────────────────────────────────────────────────
    header(4, "Mail");
    log("");
    log("  Where should email be sent from?");
    log(p.dim("  Leave it empty to print one-time codes in the server log instead."));
    let smtp = "";
    while (true) {
      const smtpRaw = (await ask(p.bold("SMTP URL [empty] "))).trim();
      const error = validateSmtpUrl(smtpRaw);
      if (!error) {
        smtp = smtpRaw === "" || smtpRaw === "(empty)" ? "" : smtpRaw;
        break;
      }
      log(`  ${error}`);
    }
    let smtpFrom = current.smtpFrom;
    let smtpRequired = current.smtpRequired;
    if (smtp) {      log(p.dim("  Which address should people see in their inbox?"));
      const fallback = current.smtpFrom || "ordo <noreply@ordo.local>";
      const fromRaw = (await ask(p.bold(`From [${fallback}] `))).trim();
      smtpFrom = fromRaw === "" ? fallback : fromRaw;
      smtpRequired = true;
      log(p.dim("  Codes are only sent by email now — if mail fails, sign-up says so"));
      log(p.dim("  instead of printing codes to the log. Re-run setup to change that."));
    } else {
      smtpRequired = false;
    }

    // ── Step 5: Network ─────────────────────────────────────────────────────
    header(5, "Network");
    const behindProxy = await pick({
      title: "Is a reverse proxy in front of this server?",
      detail: "nginx, Caddy, or Cloudflare. The server then trusts their visitor address.",
      options: [
        { label: "No proxy", value: false },
        { label: "A proxy is in front", value: true },
      ],
      selected: current.trustProxy > 0 ? 1 : 0,
    });
    let trustProxy = 0;
    let listenHost = "127.0.0.1";
    if (behindProxy) {
      log("");
      log("  How many proxies sit in front?");
      log(p.dim("  1 for a single nginx, Caddy, or Cloudflare. The server stays on localhost."));
      const fallback = String(current.trustProxy || 1);
      const hopsRaw = (await ask(p.bold(`Hops [${fallback}] `))).trim();
      trustProxy = parseTrustProxy(hopsRaw === "" ? fallback : hopsRaw);
    } else {
      const exposeLan = await pick({
        title: "Who can open that port?",
        detail: "Localhost is only this machine. LAN is for a phone on the same Wi-Fi.",
        options: [
          { label: "Only this machine", value: false },
          { label: "This machine and the LAN", value: true },
        ],
        selected: current.listenHost === "0.0.0.0" ? 1 : 0,
      });
      listenHost = exposeLan ? "0.0.0.0" : "127.0.0.1";
    }

    const next = {
      ...current,
      port,
      registration,
      emailVerification,
      smtpUrl: smtp,
      smtpFrom,
      smtpRequired,
      trustProxy,
      listenHost,
    };

    // ── Summary + confirm ───────────────────────────────────────────────────
    log("");
    log(p.bold("  Ready to install"));
    log(p.dim("  ─────────────────"));
    for (const line of setupSummaryRows(next, folder)) log(line);
    const confirm = await pick({
      title: "Install with these settings?",
      detail: "Nothing is written until you confirm.",
      options: [
        { label: "Install now", value: "install" },
        { label: "Answer the questions again", value: "again" },
        { label: "Cancel setup", value: "cancel" },
      ],
      selected: 0,
    });
    if (confirm === "install") return next;
    if (confirm === "cancel") {
      const error = new Error("Setup cancelled. Nothing was installed.");
      error.code = "CANCELLED";
      throw error;
    }
    log(p.dim("  Starting over — the previous answers are the new defaults."));
  }
}

async function promptSettings(ask, current, choose, pick, log, extras = {}) {
  if (pick) return promptGuidedSettings(ask, current, pick, log ?? (() => {}), extras);
  const yn = async (question, fallback) => {
    if (choose) return choose(question, fallback);
    const hint = fallback ? "Y/n" : "y/N";
    const raw = (await ask(`${question} [${hint}] `)).trim().toLowerCase();
    if (!raw) return fallback;
    if (["y", "yes"].includes(raw)) return true;
    if (["n", "no"].includes(raw)) return false;
    return fallback;
  };
  const text = async (question, fallback) => {
    const raw = await ask(`${question} [${fallback}] `);
    return raw.trim() === "" ? fallback : raw.trim();
  };

  const port = parsePort(await text("HTTP port", String(current.port)));
  const registration = await yn(
    "Allow new sign-ups after the first account?",
    current.registration,
  );
  const emailVerification = await yn("Require email verification?", current.emailVerification);
  const smtpUrl = await text(
    "SMTP URL (empty = print one-time codes in the console)",
    current.smtpUrl || "(empty)",
  );
  const smtp = smtpUrl === "(empty)" ? "" : smtpUrl;
  let smtpFrom = current.smtpFrom;
  let smtpRequired = current.smtpRequired;
  if (smtp) {
    smtpFrom = await text("SMTP from address", current.smtpFrom || "ordo <noreply@ordo.local>");
    smtpRequired = true;
  }
  const behindProxy = await yn("Behind nginx, Caddy, or Cloudflare?", current.trustProxy > 0);
  const trustProxy = behindProxy
    ? parseTrustProxy(await text("Reverse-proxy hops to trust", String(current.trustProxy || 1)))
    : 0;
  let listenHost = current.listenHost || DEFAULTS.listenHost;
  if (behindProxy) {
    listenHost = "127.0.0.1";
  } else {
    const exposeLan = await yn(
      "Listen on the LAN without a reverse proxy (0.0.0.0)?",
      listenHost === "0.0.0.0",
    );
    listenHost = exposeLan ? "0.0.0.0" : "127.0.0.1";
  }

  return {
    ...current,
    port,
    registration,
    emailVerification,
    smtpUrl: smtp,
    smtpFrom,
    smtpRequired,
    trustProxy,
    listenHost,
  };
}

function run(command, commandArgs, { cwd, env, dryRun, log }) {
  const pretty = [command, ...commandArgs].join(" ");
  log(`$ ${pretty}`);
  if (dryRun) return;
  const result = spawnSync(command, commandArgs, {
    cwd,
    env,
    stdio: "inherit",
  });
  if (result.status !== 0) {
    throw new Error(`${pretty} failed (${result.status ?? result.error?.message})`);
  }
}

function createAsk(streamIn, streamOut) {
  return async (question) => {
    const rl = readline.createInterface({ input: streamIn, output: streamOut });
    try {
      return await rl.question(question);
    } finally {
      rl.close();
    }
  };
}

async function resolveDeployRelease({
  args,
  interactive,
  ask,
  repoRoot,
  log,
  releases,
  fetchImpl,
  token,
  arrows = false,
  stdin: menuIn,
  stdout: menuOut,
}) {
  const repo = args.repo ?? DEFAULT_REPO;
  const installed = readInstalledRelease(repoRoot);
  const hasGit = existsSync(join(repoRoot, ".git"));
  let release;
  if (interactive && args.release == null) {
    const catalog = Array.isArray(releases) ? releases : await listReleases(repo, { fetchImpl, token });
    if (visibleReleases(catalog, { pre: args.pre }).length === 0) {
      throw new Error(
        args.pre
          ? `No GitHub releases were found on ${repo}. Publish a vX.Y.Z release, or pass --from-git to update the current branch.`
          : `No stable GitHub releases were found on ${repo}. Pass --pre to include pre-releases, or pass --from-git to update the current branch.`,
      );
    }
    if (arrows) {
      log("");
      try {
        release = await promptReleaseMenu({
          rows: releaseMenuRows(catalog, { installedTag: installed?.tag ?? null, pre: args.pre }),
          hiddenPre: hiddenPreCount(catalog, { pre: args.pre }),
          input: menuIn,
          output: menuOut,
        });
      } catch (error) {
        if (!error.fetchTag || Array.isArray(releases)) throw error;
        release = await releaseByTag(repo, error.fetchTag, { fetchImpl, token });
      }
    } else {
      log("");
      log(`Published releases of ${repo}`);
      const menu = formatReleaseMenu(catalog, { installedTag: installed?.tag ?? null, pre: args.pre });
      if (menu) log(menu);
      log("");
      const raw = await ask("Release to install [latest]: ");
      try {
        release = chooseListedRelease(catalog, raw, { pre: args.pre });
      } catch (error) {
        if (!error.fetchTag || Array.isArray(releases)) throw error;
        release = await releaseByTag(repo, error.fetchTag, { fetchImpl, token });
      }
    }
  } else {
    const spec = normalizeReleaseSpec(args.release ?? "latest", { pre: args.pre });
    release = await resolveReleaseChoice(spec, { repo, releases, fetchImpl, token });
  }
  if (installed?.tag && (args.release == null || /^latest(?:-pre)?$/i.test(args.release)) &&
      compareVersions(release.tag_name, installed.tag) < 0) {
    throw new Error(`Latest release ${release.tag_name} is older than installed ${installed.tag}. Choose an explicit --release tag to downgrade.`);
  }
  const mode = releaseApplyMode(release, {
    hasGit,
    sourceArchive: args.sourceArchive,
    requireAsset: args.requireAsset,
  });
  return { release, mode, installed, repo };
}

async function deploy(options = {}) {
  const argv = options.argv ?? process.argv.slice(2);
  const env = options.env ?? process.env;
  const log = options.log ?? console.log;
  const args = parseArgs(argv);
  if (args.help) {
    log(HELP);
    return { ok: true, help: true };
  }

  const repoRoot = options.repoRoot ?? findRepoRoot(options.cwd ?? __dirname);
  const serverDir = join(repoRoot, "apps", "server");
  const envPath = join(serverDir, ".env");
  const secretPath = join(serverDir, ".ordo-secret");
  const streamIn = options.stdin ?? stdin;
  const streamOut = options.stdout ?? stdout;
  const interactive = options.interactive ?? isInteractive(args, env, streamIn);
  const existingEnv = loadExistingEnv(envPath);
  let settings = settingsFromSources(args, existingEnv);
  const command = inferCommand(
    args.command,
    looksInstalled(envPath, sqlitePathFromUrl(settings.databaseUrl, serverDir), secretPath),
  );
  const ask = () => options.ask ?? createAsk(streamIn, streamOut);
  const useArrows = interactive && options.ask == null && Boolean(streamIn.isTTY);
  const pick = useArrows
    ? (spec) => promptChoiceMenu({ input: streamIn, output: streamOut, ...spec })
    : null;
  const choose = pick
    ? (question, fallback, detail) =>
        pick({
          title: question,
          detail,
          options: [
            { label: "Yes", value: true },
            { label: "No", value: false },
          ],
          selected: fallback ? 0 : 1,
        })
    : null;

  if (command === "uninstall") {
    return uninstallCommand({
      repoRoot,
      args,
      interactive,
      choose,
      ask: ask(),
      log,
      home: env.HOME,
      stopInstall: options.stopInstall,
    });
  }

  if (interactive && command === "install") {
    const useColor = Boolean(streamOut.isTTY) && !env.NO_COLOR;
    if (pick) {
      log(formatSetupBanner(useColor));
    } else {
      log("ordo backend install\n");
    }
    const portInUse = (port) => {
      if (args.dryRun) return null;
      return classifyPort(port, serverDir, join(serverDir, ".ordo.pid"), listenSnapshot(port));
    };
    settings = await promptSettings(ask(), settings, choose, pick, log, {
      folder: repoRoot,
      portInUse,
      color: useColor,
    });
  } else if (command === "update") {
    log("ordo backend update\n");
  }

  const dbPath = sqlitePathFromUrl(settings.databaseUrl, serverDir);
  const db = inspectDatabase(dbPath);
  const migrate = migratePlan(db.kind, args.skipMigrate);
  if (migrate.action === "error") throw new Error(migrate.reason);

  const envExists = existsSync(envPath);
  let envDecision = decideWriteEnv(args, envExists);
  if (interactive && command === "install" && envExists && !args.forceEnv && args.writeEnv !== false) {
    const overwrite = pick
      ? await pick({
          title: "A settings file is already here. Replace it?",
          detail: "No keeps the port, accounts, and mail settings already in that file.",
          options: [
            { label: "Keep the existing file", value: false },
            { label: "Replace it with these answers", value: true },
          ],
          selected: 0,
        })
      : ["y", "yes"].includes(
          (await ask()("apps/server/.env already exists. Overwrite it? [y/N] ")).trim().toLowerCase(),
        );
    envDecision = overwrite
      ? { write: true, reason: "Overwriting apps/server/.env." }
      : { write: false, reason: "Leaving existing apps/server/.env in place." };
  }
  // An .env from before setup wrote explicit secrets can be moved onto the
  // documented format without changing a single value.
  if (
    envExists &&
    !envDecision.write &&
    needsEnvMigration(existingEnv) &&
    (args.migrateEnv || interactive)
  ) {
    let migrate = args.migrateEnv;
    if (!args.migrateEnv) {
      migrate = pick
        ? await pick({
            title: "Move this .env onto the documented format?",
            detail: "Every value is kept and the secrets are written out plainly. Recommended.",
            options: [
              { label: "Yes, rewrite it", value: true },
              { label: "Leave the file alone", value: false },
            ],
            selected: 0,
          })
        : ["y", "yes"].includes(
            (await ask()("Rewrite apps/server/.env in the documented format? [Y/n] "))
              .trim()
              .toLowerCase(),
          );
    }
    if (migrate) {
      envDecision = {
        write: true,
        reason: "Rewriting apps/server/.env in the documented format. Values are kept.",
      };
      // The file keeps its own values; only flags passed now override them.
      settings = settingsFromSources(args, existingEnv);
    } else {
      envDecision = {
        write: false,
        reason:
          "Leaving apps/server/.env as is. Pass --migrate-env to rewrite it in the documented format.",
      };
    }
  }

  const gitPresent = existsSync(join(repoRoot, ".git"));
  const fromGit = args.fromGit;
  let pull = fromGit && gitPresent;
  let chosen = null;
  if (!fromGit && !args.noRelease) {
    chosen = await resolveDeployRelease({
      args,
      interactive,
      ask: ask(),
      repoRoot,
      log,
      releases: options.releases,
      fetchImpl: options.fetch ?? globalThis.fetch,
      token: githubToken(env),
      arrows: useArrows,
      stdin: streamIn,
      stdout: streamOut,
    });
  }

  const backup =
    args.backup !== false && migrate.action !== "skip" && existsSync(dbPath) && statSync(dbPath).size > 0;

  const pidPath = join(serverDir, ".ordo.pid");
  const logPath = join(serverDir, "ordo.log");
  const listener =
    options.listener !== undefined
      ? options.listener
      : args.dryRun
        ? null
        : classifyPort(settings.port, serverDir, pidPath, listenSnapshot(settings.port));

  let start = args.start;
  if (start == null && interactive && listener?.kind === "ordo") {
    const restart = pick
      ? await pick({
          title: `The server is already running on port ${settings.port}. Restart it?`,
          detail: "Yes stops it so the database can update, then starts it again in the background.",
          options: [
            { label: "Restart it", value: true },
            { label: "Leave it stopped", value: false },
          ],
          selected: 0,
        })
      : !["n", "no"].includes(
          (await ask()(`Restart the running server on port ${settings.port} when done? [Y/n] `))
            .trim()
            .toLowerCase(),
        );
    if (!restart) start = false;
  } else if (start == null && interactive) {
    const foreground = pick
      ? await pick({
          title: "Start the server when this finishes?",
          detail: "In this terminal the log stays on screen. Otherwise you start it yourself.",
          options: [
            { label: "Not yet", value: false },
            { label: "In this terminal", value: true },
          ],
          selected: 0,
        })
      : ["y", "yes"].includes(
          (await ask()("Start the server in the foreground when done? [y/N] ")).trim().toLowerCase(),
        );
    if (foreground) start = true;
  }
  if (start == null && listener?.kind !== "ordo") start = false;

  const launch = chooseStart({ wasRunning: listener?.kind === "ordo", start });
  if (listener?.kind === "other" && launch !== "none") {
    throw new Error(
      `Port ${settings.port} is already used by ${listener.command} (pid ${listener.pid}). Stop it or choose another --port.`,
    );
  }

  log("");
  log(command === "update" ? "Updating the existing backend." : "Installing the backend.");
  log(envDecision.reason);
  log(migrate.reason);
  if (fromGit && pull) log("Will run git pull --ff-only on the current branch.");
  else if (fromGit) log("Skipping git pull (no .git directory).");
  else if (chosen?.release) {
    for (const line of planLines({
      release: chosen.release,
      mode: chosen.mode,
      installed: chosen.installed,
    })) {
      log(line);
    }
  } else log("Staying on the copy already on disk (--no-release).");
  if (backup) log("Will snapshot SQLite before applying schema changes.");
  else if (args.backup === false) log("Skipping SQLite backup (--no-backup).");
  if (listener?.kind === "ordo") {
    const next =
      launch === "foreground"
        ? "start it in the foreground"
        : launch === "detached"
          ? "start it in the background"
          : "leave it stopped";
    log(`Will stop ordo (pid ${listener.pid}) before the database change, then ${next}.`);
  } else if (listener?.kind === "other") {
    log(`Port ${settings.port} is in use by ${listener.command} (pid ${listener.pid}). It will not be stopped.`);
  }
  if (!args.skipInstall && dependenciesReady(repoRoot)) {
    log("Dependencies already match pnpm-lock.yaml. Skipping pnpm install.");
  }
  if (args.dryRun) log("Dry run: no files or commands will change.");
  log("");

  if (pull) {
    const before = args.dryRun ? null : gitHead(repoRoot);
    gitPull(repoRoot, { log, dryRun: args.dryRun });
    const after = args.dryRun ? null : gitHead(repoRoot);
    if (!args.dryRun && shouldReexec(before, after, env.ORDO_DEPLOY_HEAD)) {
      log("Checked out a new deploy script. Continuing with that copy.");
      const exitCode = (options.reexec ?? reexecDeploy)(repoRoot, argv, after, env, "git");
      return { ok: exitCode === 0, reexec: true, exitCode, command };
    }
  }
  if (chosen?.release && !args.dryRun) {
    if (gitPresent) assertCleanGit(repoRoot, "--no-release");
    const scriptPath = join(repoRoot, "scripts", "deploy-server.js");
    const before = fileHash(scriptPath);
    await applySelectedRelease({
      repoRoot,
      release: chosen.release,
      repo: chosen.repo,
      fetchImpl: options.fetch ?? globalThis.fetch,
      token: githubToken(env),
      sourceArchive: args.sourceArchive,
      requireAsset: args.requireAsset,
      dryRun: false,
      log,
    });
    const after = fileHash(scriptPath);
    if (shouldReexec(before, after, env.ORDO_DEPLOY_SCRIPT)) {
      log("Checked out a new deploy script. Continuing with that copy.");
      const exitCode = (options.reexec ?? reexecDeploy)(repoRoot, argv, after, env, "release");
      return { ok: exitCode === 0, reexec: true, exitCode, command };
    }
  }
  if (!args.dryRun) checkToolchain(repoRoot);

  const childEnv = {
    ...env,
    DATABASE_URL: settings.databaseUrl,
    NODE_ENV: env.NODE_ENV === "test" ? env.NODE_ENV : "production",
  };

  // Long steps print a marker up front and a green tick when they finish.
  const useColor = Boolean(streamOut.isTTY) && !env.NO_COLOR;
  const painter = makePainter(useColor);
  const phase = (label) => {
    log("");
    log(`${painter.cyan("●")} ${label}`);
    return (doneLabel, extra) => {
      log(`${painter.green("✓")} ${doneLabel || label}`);
      if (extra) log(painter.dim(`  ${extra}`));
    };
  };

  let writtenSecrets = null;
  if (envDecision.write) {
    const done = phase("Writing apps/server/.env");
    // --jwt-secret (or the existing env) wins; sidecar files carry over; else generate.
    const secretSource = settings.jwtSecret
      ? { ...existingEnv, JWT_SECRET: settings.jwtSecret }
      : existingEnv;
    writtenSecrets = resolveSetupSecrets(serverDir, secretSource);
    const preserved = preservedEnvKeys(existingEnv);
    if (!args.dryRun) {
      mkdirSync(serverDir, { recursive: true });
      writeFileSync(
        envPath,
        renderEnv(settings, { secrets: writtenSecrets, preserved }),
        { encoding: "utf8" },
      );
    }
    done(relative(repoRoot, envPath) || envPath);
    log(
      painter.dim(
        `  Secrets: JWT_SECRET (${writtenSecrets.jwtSource}) and LIBRARY_KEK (${writtenSecrets.kekSource}) are stored in it.`,
      ),
    );
  }

  if (!args.skipInstall && !dependenciesReady(repoRoot)) {
    const done = phase("Installing dependencies (can take a few minutes)");
    run(
      "pnpm",
      ["install", "--frozen-lockfile"],
      { cwd: repoRoot, env: childEnv, dryRun: args.dryRun, log },
    );
    done("Dependencies installed");
  }

  if (!args.skipBuild) {
    const done = phase("Compiling the shared packages");
    run("pnpm", ["--filter", "@ordo/shared", "build"], {
      cwd: repoRoot,
      env: childEnv,
      dryRun: args.dryRun,
      log,
    });
    done("Shared packages compiled");
  }

  const upgradeCli = join(serverDir, "dist", "prisma", "upgrade-cli.js");

  if (migrate.action !== "skip") {
    const done = phase("Generating the database client");
    run("pnpm", ["exec", "prisma", "generate"], {
      cwd: serverDir,
      env: childEnv,
      dryRun: args.dryRun,
      log,
    });
    done("Database client generated");
  }

  if (!args.skipBuild) {
    const done = phase("Compiling the server");
    run("pnpm", ["--filter", "@ordo/server", "build"], {
      cwd: repoRoot,
      env: childEnv,
      dryRun: args.dryRun,
      log,
    });
    done("Server compiled");
  } else if (migrate.action !== "skip" && !args.dryRun && !existsSync(upgradeCli)) {
    throw new Error(
      "Server build is missing (dist/prisma/upgrade-cli.js). Drop --skip-build or build @ordo/server first.",
    );
  }

  let backupPath = null;
  let stopped = false;
  const quietDb = listener?.kind === "ordo" && (migrate.action !== "skip" || launch !== "none");
  try {
    if (quietDb && !args.dryRun) {
      stopPid(listener.pid, log);
      stopped = true;
    }
    if (backup) {
      const done = phase("Backing up the database");
      backupPath = backupSqlite(dbPath, { log, dryRun: args.dryRun });
      done(`Database backed up to ${backupPath}`);
    }
    if (migrate.action !== "skip") {
      const done = phase(migrate.action === "setup" ? "Creating the database" : "Applying migrations");
      run("node", ["dist/prisma/upgrade-cli.js"], {
        cwd: serverDir,
        env: childEnv,
        dryRun: args.dryRun,
        log,
      });
      done(migrate.action === "setup" ? "Database created and migrated" : "Migrations applied");
    }
  } catch (error) {
    if (stopped && start !== false) {
      try {
        startDetached(serverDir, childEnv, logPath, pidPath, log);
      } catch {
        log("The previous server was stopped and could not be restarted.");
      }
    }
    const message = error instanceof Error ? error.message : String(error);
    if (backupPath) {
      throw new Error(
        `${message}\nDatabase snapshot: ${backupPath}\nRestore with: cp ${JSON.stringify(backupPath)} ${JSON.stringify(dbPath)}`,
      );
    }
    throw error instanceof Error ? error : new Error(message);
  }

  if (args.dryRun) {
    log("");
    log(painter.dim("Dry run complete. Nothing was installed or changed."));
  } else {
    log(formatNextSteps({
      settings,
      dbPath: relative(repoRoot, dbPath) || dbPath,
      envPath: relative(repoRoot, envPath) || envPath,
      launch,
      color: useColor,
    }));
    if (settings.listenHost === "127.0.0.1") {
      log(
        painter.dim(
          "  Only this machine can open that address. Put nginx or Caddy in front for HTTPS",
        ),
      );
      log(painter.dim("  (deploy/nginx.conf.example, deploy/Caddyfile.example), or re-run setup."));
    } else if (settings.trustProxy === 0) {
      log(painter.dim("  That port is open on this network. Put a proxy in front if it faces"));
      log(painter.dim("  the internet."));
    }
  }

  if (launch === "foreground") {
    run("pnpm", ["start"], {
      cwd: serverDir,
      env: childEnv,
      dryRun: args.dryRun,
      log,
    });
  } else if (launch === "detached") {
    if (!args.dryRun) {
      startDetached(serverDir, childEnv, logPath, pidPath, log);
      const info = await (options.waitForReady ?? waitForReady)(settings);
      log(`Ready: ${healthUrl(settings)} (${info.name ?? "ordo"} ${info.version})`);
    } else {
      log(`$ pnpm start  # background, then check ${healthUrl(settings)}`);
    }
  }

  return {
    ok: true,
    command,
    settings,
    migrate,
    envDecision,
    pull,
    release: chosen?.release
      ? { tag: chosen.release.tag_name, mode: chosen.mode }
      : null,
    backup,
    start: launch === "foreground",
    launch,
    db,
    interactive,
  };
}

module.exports = {
  HELP,
  DEFAULTS,
  parseArgs,
  isInteractive,
  sqlitePathFromUrl,
  parseDotEnv,
  settingsFromSources,
  renderEnv,
  MANAGED_ENV_KEYS,
  resolveSetupSecrets,
  preservedEnvKeys,
  needsEnvMigration,
  validateSmtpUrl,
  inspectDatabase,
  migratePlan,
  looksInstalled,
  inferCommand,
  makePainter,
  formatSetupBanner,
  formatStepHeader,
  formatSetupSummary,
  setupSummaryRows,
  formatNextSteps,
  promptGuidedSettings,
  isInsideDir,
  assertSafeUninstallRoot,
  installProcess,
  uninstallCommand,
  backupSqlite,
  gitPull,
  dirtyWorktreeMessage,
  shouldReexec,
  reexecArgs,
  dependenciesReady,
  parseSsPids,
  isOrdoServer,
  classifyPort,
  chooseStart,
  healthUrl,
  isOrdoInfo,
  decideWriteEnv,
  compareNodeVersion,
  deploy,
};

if (require.main === module) {
  deploy()
    .then((result) => {
      if (result?.reexec) process.exit(result.exitCode ?? 1);
    })
    .catch((error) => {
      console.error(`error: ${error.message}`);
      process.exit(1);
    });
}
