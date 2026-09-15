#!/usr/bin/env node
/**
 * Install, migrate, and optionally start the Ordo backend.
 *
 * Interactive on a TTY (asks port, sign-ups, mail, reverse proxy).
 * Non-interactive with --yes, CI=true, or a non-TTY stdin.
 *
 *   ./scripts/deploy-server
 *   ./scripts/deploy-server update
 *   ./scripts/deploy-server --yes --trust-proxy 1 --registration false
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
  readSync,
  statSync,
  writeFileSync,
} = require("node:fs");
const { dirname, join, resolve } = require("node:path");
const readline = require("node:readline/promises");
const { stdin, stdout } = require("node:process");

const HELP = `Usage: deploy-server [install|update] [options]

Install, update, and migrate the Ordo backend.

Commands
  install   First-time setup: prompts (on a TTY), writes .env, install, migrate, build
  update    Keep .env, pull git, backup SQLite, rebuild, apply all pending migrations

If you omit the command and this already looks like an install (.env or a
database), update is assumed. Otherwise install is assumed.

Modes
  Interactive (default on a terminal): install asks port, sign-ups, mail, proxy.
  update only asks about git pull and whether to start.
  Non-interactive: --yes, CI=true, or piped stdin. Uses flags and defaults.

Options
  -y, --yes, --non-interactive   Do not prompt
  --port <n>                     HTTP port (default 3000)
  --registration <bool>          Allow new sign-ups (default true)
  --email-verification <bool>    Require a code on sign-up (default false)
  --mfa-required <bool>          Require MFA for every account (default false)
  --smtp-url <url>               SMTP URL; omit to print codes in the console
  --smtp-from <addr>             From address when SMTP is set
  --trust-proxy <n>              Reverse-proxy hops (default 0; 1 behind nginx/Caddy)
  --cors <origins>               Comma-separated origins (empty allows the caller)
  --database-url <url>           SQLite URL (default file:./ordo.db)
  --jwt-secret <secret>          Session secret (default: auto-saved .ordo-secret)
  --write-env                    Write apps/server/.env in non-interactive mode
  --force-env                    Overwrite an existing .env
  --no-write-env                 Never write .env
  --pull                         git pull --ff-only before install (update default)
  --no-pull                      Do not pull
  --backup                       Snapshot SQLite before migrating (default)
  --no-backup                    Do not snapshot SQLite
  --start                        Start the server in the foreground when done
  --no-start                     Do not start (non-interactive default)
  --skip-install                 Skip pnpm install
  --skip-build                   Skip compile
  --skip-migrate                 Skip prisma generate / schema upgrade
  --dry-run                      Print the plan without changing anything
  -h, --help                     Show this help

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
  ./scripts/deploy-server --yes --port 8080 --trust-proxy 1 --registration false --start
`;

const DEFAULTS = {
  port: 3000,
  registration: true,
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
    port: null,
    registration: null,
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
      case "--pull":
        args.pull = true;
        break;
      case "--no-pull":
        args.pull = false;
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

function gitPull(repoRoot, { log, dryRun } = {}) {
  const gitDir = join(repoRoot, ".git");
  if (!existsSync(gitDir)) {
    log?.("Skipping git pull (no .git directory).");
    return { pulled: false, reason: "no-git" };
  }
  log?.("$ git pull --ff-only");
  if (dryRun) return { pulled: true, reason: "dry-run" };
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
  const registration = await yn("Allow new sign-ups?", current.registration);
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

  return {
    ...current,
    port,
    registration,
    emailVerification,
    smtpUrl: smtp,
    smtpFrom,
    trustProxy,
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
  const interactive = options.interactive ?? isInteractive(args, env, options.stdin ?? stdin);
  const existingEnv = loadExistingEnv(envPath);
  let settings = settingsFromSources(args, existingEnv);
  const command = inferCommand(
    args.command,
    looksInstalled(envPath, sqlitePathFromUrl(settings.databaseUrl, serverDir), secretPath),
  );
  const ask = () => options.ask ?? createAsk(options.stdin ?? stdin, options.stdout ?? stdout);

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
  let pull = args.pull ?? (command === "update" && gitPresent);
  if (interactive && command === "update" && args.pull == null && gitPresent) {
    const raw = (await ask()("Pull the latest commits with git pull --ff-only? [Y/n] ")).trim().toLowerCase();
    pull = !["n", "no"].includes(raw);
  }

  const backup =
    args.backup !== false && migrate.action !== "skip" && existsSync(dbPath) && statSync(dbPath).size > 0;

  let start = args.start;
  if (start == null && interactive) {
    start = ["y", "yes"].includes(
      (await ask()("Start the server in the foreground when done? [y/N] ")).trim().toLowerCase(),
    );
  }
  if (start == null) start = false;

  log("");
  log(command === "update" ? "Updating the existing backend." : "Installing the backend.");
  log(envDecision.reason);
  log(migrate.reason);
  if (pull) log("Will run git pull --ff-only.");
  else log("Skipping git pull.");
  if (backup) log("Will snapshot SQLite before applying schema changes.");
  else if (args.backup === false) log("Skipping SQLite backup (--no-backup).");
  if (args.dryRun) log("Dry run: no files or commands will change.");
  log("");

  if (pull) gitPull(repoRoot, { log, dryRun: args.dryRun });
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

  if (!args.skipInstall) {
    run(
      "pnpm",
      ["install", "--frozen-lockfile", "--config.dangerouslyAllowAllBuilds=true"],
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
    if (backup) {
      backupSqlite(dbPath, { log, dryRun: args.dryRun });
    }
    if (!args.skipBuild) {
      run("pnpm", ["--filter", "@ordo/server", "build"], {
        cwd: repoRoot,
        env: childEnv,
        dryRun: args.dryRun,
        log,
      });
    } else if (!args.dryRun && !existsSync(upgradeCli)) {
      throw new Error(
        "Server build is missing (dist/prisma/upgrade-cli.js). Drop --skip-build or build @ordo/server first.",
      );
    }
    run("node", ["dist/prisma/upgrade-cli.js"], {
      cwd: serverDir,
      env: childEnv,
      dryRun: args.dryRun,
      log,
    });
  } else if (!args.skipBuild) {
    run("pnpm", ["--filter", "@ordo/server", "build"], {
      cwd: repoRoot,
      env: childEnv,
      dryRun: args.dryRun,
      log,
    });
  }

  log("");
  log(`API will listen on http://localhost:${settings.port}`);
  log(`Check: curl http://localhost:${settings.port}/api/server/info`);
  log(`Data:  ${dbPath}`);
  log("Secret: apps/server/.ordo-secret (created on first start if JWT_SECRET is unset)");
  log("Keep a backup of the database and the secret file.");
  if (!start) {
    log("");
    log("Start with:");
    log(`  cd apps/server && NODE_ENV=production pnpm start`);
  }

  if (start) {
    run("pnpm", ["start"], {
      cwd: serverDir,
      env: childEnv,
      dryRun: args.dryRun,
      log,
    });
  }

  return {
    ok: true,
    command,
    settings,
    migrate,
    envDecision,
    pull,
    backup,
    start,
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
  decideWriteEnv,
  compareNodeVersion,
  deploy,
};

if (require.main === module) {
  deploy().catch((error) => {
    console.error(`error: ${error.message}`);
    process.exit(1);
  });
}
