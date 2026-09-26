#!/usr/bin/env node
/**
 * Install, migrate, and optionally start the Ordo backend.
 *
 * Updates install a published GitHub Release (latest stable, or the one you
 * pick). They do not pull the current branch. Interactive on a TTY. Non-interactive
 * with --yes, CI=true, or a non-TTY stdin.
 *
 *   ./scripts/deploy-server
 *   ./scripts/deploy-server update
 *   ./scripts/deploy-server update --yes --release v0.1.0
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
  statSync,
  writeFileSync,
} = require("node:fs");
const { dirname, join, resolve } = require("node:path");
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
const { hiddenPreCount, promptReleaseMenu, releaseMenuRows } = require("./release-menu.js");

const HELP = `Usage: deploy-server [install|update] [options]

Install, update, and migrate the Ordo backend from a GitHub Release.

Commands
  install   First-time setup: prompts (on a TTY), writes .env, install, migrate, build
  update    Keep .env, install a release, backup SQLite, rebuild, apply pending migrations

If you omit the command and this already looks like an install (.env or a
database), update is assumed. Otherwise install is assumed.

A release is a published GitHub Release, not the tip of main or whatever
branch is checked out. On a terminal, move with the arrow keys and press
enter. Type a version to jump to a specific tag. --yes with no --release
installs the latest stable release.

Modes
  Interactive (default on a terminal): install asks port, sign-ups, mail, proxy.
  Both commands let you move through releases with the arrow keys, then ask
  whether to start. Type a version and press enter to pick a specific tag.
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
  --trust-proxy <n>              Reverse-proxy hops (default 0; 1 behind nginx/Caddy)
  --cors <origins>               Extra browser origins (empty = same-origin + localhost)
  --database-url <url>           SQLite URL (default file:./ordo.db)
  --jwt-secret <secret>          Session secret (default: auto-saved .ordo-secret)
  --write-env                    Write apps/server/.env in non-interactive mode
  --force-env                    Overwrite an existing .env
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
  .env, .ordo-secret, .ordo-library-key, SQLite, backups, and avatars under
  apps/server/prisma/ are kept. Other files are replaced by the release.

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
`;

const DEFAULTS = {
  port: 3000,
  registration: false,
  listenHost: "127.0.0.1",
  emailVerification: false,
  mfaRequired: false,
  smtpUrl: "",
  smtpFrom: "",
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
        if (!flag.startsWith("-") && (flag === "install" || flag === "update")) {
          if (args.command) throw new Error("Specify only one of install or update.");
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

function renderEnv(settings) {
  const lines = [
    "# Written by scripts/deploy-server. All keys are optional; delete a line to use the default.",
    `PORT=${settings.port}`,
    `LISTEN_HOST=${settings.listenHost}`,
    `DATABASE_URL=${quoteEnv(settings.databaseUrl)}`,
    `REGISTRATION_ENABLED=${settings.registration}`,
    `EMAIL_VERIFICATION_REQUIRED=${settings.emailVerification}`,
    `MFA_REQUIRED=${settings.mfaRequired}`,
    `TRUST_PROXY=${settings.trustProxy}`,
    `CORS_ALLOWED_ORIGINS=${quoteEnv(settings.cors)}`,
  ];
  if (settings.jwtSecret) {
    lines.push(`JWT_SECRET=${quoteEnv(settings.jwtSecret)}`);
  } else {
    lines.push("# JWT_SECRET auto-generates to .ordo-secret if unset");
  }
  if (settings.smtpUrl) {
    lines.push(`SMTP_URL=${quoteEnv(settings.smtpUrl)}`);
    if (settings.smtpFrom) lines.push(`SMTP_FROM=${quoteEnv(settings.smtpFrom)}`);
  } else {
    lines.push("# SMTP_URL=smtp://user:pass@smtp.example.com:587");
    lines.push("# SMTP_REQUIRED=true  # never print codes; fail if mail cannot send");
  }
  lines.push("");
  return lines.join("\n");
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
  if (explicit === "install" || explicit === "update") return explicit;
  return installed ? "update" : "install";
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
  const pids = new Set(parseSsPids(ssText));
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
    if (parseSsPids(ssText).includes(pid)) {
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
  const result = spawnSync("ss", ["-lptnH", `sport = :${port}`], { encoding: "utf8" });
  if (result.status !== 0) return "";
  return result.stdout ?? "";
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
    throw new Error(`Node.js ${engines}+ is required (this is ${process.versions.node}).`);
  }
  const pnpm = spawnSync("pnpm", ["--version"], { encoding: "utf8" });
  if (pnpm.status !== 0) {
    throw new Error("pnpm is required. Install it from https://pnpm.io");
  }
}

async function promptSettings(ask, current) {
  const yn = async (question, fallback) => {
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
  if (smtp) {
    smtpFrom = await text("SMTP from address", current.smtpFrom || "ordo <noreply@ordo.local>");
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

  if (interactive && command === "install") {
    log("Ordo backend install\n");
    settings = await promptSettings(ask(), settings);
  } else if (command === "update") {
    log("Ordo backend update\n");
  }

  const dbPath = sqlitePathFromUrl(settings.databaseUrl, serverDir);
  const db = inspectDatabase(dbPath);
  const migrate = migratePlan(db.kind, args.skipMigrate);
  if (migrate.action === "error") throw new Error(migrate.reason);

  const envExists = existsSync(envPath);
  let envDecision = decideWriteEnv(args, envExists);
  if (interactive && command === "install" && envExists && !args.forceEnv && args.writeEnv !== false) {
    const raw = (await ask()("apps/server/.env already exists. Overwrite it? [y/N] ")).trim().toLowerCase();
    envDecision = ["y", "yes"].includes(raw)
      ? { write: true, reason: "Overwriting apps/server/.env." }
      : { write: false, reason: "Leaving existing apps/server/.env in place." };
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
      arrows: interactive && options.ask == null && Boolean(streamIn.isTTY),
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
    const raw = (await ask()(`Restart the running server on port ${settings.port} when done? [Y/n] `))
      .trim()
      .toLowerCase();
    if (["n", "no"].includes(raw)) start = false;
  } else if (start == null && interactive) {
    start = ["y", "yes"].includes(
      (await ask()("Start the server in the foreground when done? [y/N] ")).trim().toLowerCase(),
    );
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

  if (envDecision.write) {
    if (!args.dryRun) {
      mkdirSync(serverDir, { recursive: true });
      writeFileSync(envPath, renderEnv(settings), { encoding: "utf8" });
    }
    log(`Wrote ${envPath}`);
  }

  if (!args.skipInstall && !dependenciesReady(repoRoot)) {
    run(
      "pnpm",
      ["install", "--frozen-lockfile"],
      { cwd: repoRoot, env: childEnv, dryRun: args.dryRun, log },
    );
  }

  if (!args.skipBuild) {
    run("pnpm", ["--filter", "@ordo/shared", "build"], {
      cwd: repoRoot,
      env: childEnv,
      dryRun: args.dryRun,
      log,
    });
  }

  const upgradeCli = join(serverDir, "dist", "prisma", "upgrade-cli.js");

  if (migrate.action !== "skip") {
    run("pnpm", ["exec", "prisma", "generate"], {
      cwd: serverDir,
      env: childEnv,
      dryRun: args.dryRun,
      log,
    });
  }

  if (!args.skipBuild) {
    run("pnpm", ["--filter", "@ordo/server", "build"], {
      cwd: repoRoot,
      env: childEnv,
      dryRun: args.dryRun,
      log,
    });
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
      backupPath = backupSqlite(dbPath, { log, dryRun: args.dryRun });
    }
    if (migrate.action !== "skip") {
      run("node", ["dist/prisma/upgrade-cli.js"], {
        cwd: serverDir,
        env: childEnv,
        dryRun: args.dryRun,
        log,
      });
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

  log("");
  log(`API will listen on http://${settings.listenHost}:${settings.port}`);
  log(`Check: curl http://127.0.0.1:${settings.port}/api/server/info`);
  if (settings.listenHost === "127.0.0.1") {
    log("Bound to localhost. Put nginx or Caddy in front (deploy/nginx.conf.example), or pass --public.");
  }
  log(`Data:  ${dbPath}`);
  log("Secret: apps/server/.ordo-secret (created on first start if JWT_SECRET is unset)");
  log("Keep a backup of the database and the secret file.");
  if (launch === "none") {
    log("");
    log("Start with:");
    log(`  cd apps/server && NODE_ENV=production pnpm start`);
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
  inspectDatabase,
  migratePlan,
  looksInstalled,
  inferCommand,
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
