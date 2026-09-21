const assert = require("node:assert/strict");
const { spawnSync } = require("node:child_process");
const { mkdirSync, writeFileSync } = require("node:fs");
const { tmpdir } = require("node:os");
const { join } = require("node:path");
const { test } = require("node:test");
const {
  HELP,
  parseArgs,
  isInteractive,
  sqlitePathFromUrl,
  settingsFromSources,
  renderEnv,
  inspectDatabase,
  migratePlan,
  looksInstalled,
  inferCommand,
  backupSqlite,
  decideWriteEnv,
  compareNodeVersion,
  deploy,
} = require("./deploy-server.js");

function tempRepo() {
  const root = join(
    tmpdir(),
    `ordo-deploy-${process.pid}-${Date.now()}-${Math.random().toString(36).slice(2)}`,
  );
  mkdirSync(join(root, "apps", "server"), { recursive: true });
  writeFileSync(join(root, "pnpm-workspace.yaml"), "packages:\n  - apps/*\n");
  writeFileSync(
    join(root, "package.json"),
    JSON.stringify({ engines: { node: ">=22.13" } }),
  );
  writeFileSync(join(root, "apps", "server", "package.json"), JSON.stringify({ name: "@ordo/server" }));
  return root;
}

test("parseArgs reads long flags, equals form, and booleans", () => {
  const args = parseArgs([
    "update",
    "--yes",
    "--port=8080",
    "--registration",
    "false",
    "--public",
    "--trust-proxy",
    "1",
    "--smtp-url",
    "smtp://mail.example:587",
    "--no-start",
    "--no-pull",
    "--dry-run",
  ]);
  assert.equal(args.command, "update");
  assert.equal(args.yes, true);
  assert.equal(args.port, 8080);
  assert.equal(args.registration, false);
  assert.equal(args.public, true);
  assert.equal(args.trustProxy, 1);
  assert.equal(args.smtpUrl, "smtp://mail.example:587");
  assert.equal(args.start, false);
  assert.equal(args.pull, false);
  assert.equal(args.dryRun, true);
});

test("parseArgs rejects unknown flags and bad values", () => {
  assert.throws(() => parseArgs(["--nope"]), /Unknown option/);
  assert.throws(() => parseArgs(["--port", "nope"]), /--port/);
  assert.throws(() => parseArgs(["--registration", "maybe"]), /boolean/);
  assert.throws(() => parseArgs(["install", "update"]), /only one/);
});

test("inferCommand treats an existing install as update", () => {
  assert.equal(inferCommand("install", true), "install");
  assert.equal(inferCommand("update", false), "update");
  assert.equal(inferCommand(null, true), "update");
  assert.equal(inferCommand(null, false), "install");
  const root = tempRepo();
  const envPath = join(root, "apps", "server", ".env");
  const dbPath = join(root, "apps", "server", "prisma", "ordo.db");
  assert.equal(looksInstalled(envPath, dbPath), false);
  writeFileSync(envPath, "PORT=3000\n");
  assert.equal(looksInstalled(envPath, dbPath), true);
});

test("isInteractive is off for --yes, CI, and non-TTY", () => {
  assert.equal(isInteractive({ yes: true }, {}, { isTTY: true }), false);
  assert.equal(isInteractive({ yes: false }, { CI: "true" }, { isTTY: true }), false);
  assert.equal(isInteractive({ yes: false }, {}, { isTTY: false }), false);
  assert.equal(isInteractive({ yes: false }, {}, { isTTY: true }), true);
});

test("sqlitePathFromUrl matches the server prisma/ rule", () => {
  const serverDir = "/opt/ordo/apps/server";
  assert.equal(sqlitePathFromUrl("file:./ordo.db", serverDir), join(serverDir, "prisma", "ordo.db"));
  assert.equal(sqlitePathFromUrl("file:/data/ordo.db", serverDir), "/data/ordo.db");
});

test("settingsFromSources prefer flags over an existing .env", () => {
  const settings = settingsFromSources(
    parseArgs(["--port", "4000", "--registration", "false"]),
    { PORT: "3000", REGISTRATION_ENABLED: "true", TRUST_PROXY: "1" },
  );
  assert.equal(settings.port, 4000);
  assert.equal(settings.registration, false);
  assert.equal(settings.listenHost, "127.0.0.1");
  assert.equal(settings.trustProxy, 1);
});

test("--public binds 0.0.0.0 even when .env says localhost", () => {
  const settings = settingsFromSources(parseArgs(["--public"]), {
    LISTEN_HOST: "127.0.0.1",
  });
  assert.equal(settings.listenHost, "0.0.0.0");
});

test("renderEnv quotes values that need it and comments unset secrets", () => {
  const text = renderEnv({
    port: 3000,
    databaseUrl: "file:./ordo.db",
    listenHost: "127.0.0.1",
    registration: true,
    emailVerification: false,
    mfaRequired: false,
    trustProxy: 1,
    cors: "",
    jwtSecret: "",
    smtpUrl: "smtp://user:p@ss@mail:587",
    smtpFrom: "ordo <noreply@example.com>",
  });
  assert.match(text, /PORT=3000/);
  assert.match(text, /LISTEN_HOST=127.0.0.1/);
  assert.ok(text.includes('DATABASE_URL="file:./ordo.db"'));
  assert.match(text, /TRUST_PROXY=1/);
  assert.match(text, /JWT_SECRET auto-generates/);
  assert.match(text, /SMTP_URL="smtp:\/\/user:p@ss@mail:587"/);
});

test("inspectDatabase and migratePlan cover missing, migrated, and legacy files", () => {
  const { DatabaseSync } = require("node:sqlite");
  const root = tempRepo();
  const prismaDir = join(root, "apps", "server", "prisma");
  mkdirSync(prismaDir, { recursive: true });
  const missing = join(prismaDir, "missing.db");
  assert.equal(inspectDatabase(missing).kind, "missing");
  assert.equal(migratePlan("missing", false).action, "setup");

  const migrated = join(prismaDir, "migrated.db");
  const migratedDb = new DatabaseSync(migrated);
  migratedDb.exec(`CREATE TABLE _prisma_migrations (id TEXT); CREATE TABLE "User" (id TEXT);`);
  migratedDb.close();
  assert.equal(inspectDatabase(migrated).kind, "migrated");
  assert.equal(migratePlan("migrated", false).action, "deploy");

  const legacy = join(prismaDir, "legacy.db");
  const legacyDb = new DatabaseSync(legacy);
  legacyDb.exec(`CREATE TABLE "User" (id TEXT); CREATE TABLE "Bookmark" (id TEXT);`);
  legacyDb.close();
  assert.equal(inspectDatabase(legacy).kind, "legacy");
  assert.equal(migratePlan("legacy", false).action, "adopt");
  assert.match(migratePlan("legacy", false).reason, /adopting it/);
  assert.doesNotMatch(migratePlan("legacy", false).reason, /first server start/);
  assert.equal(migratePlan("legacy", true).action, "skip");
});

test("decideWriteEnv never clobbers an existing file without --force-env", () => {
  const keep = decideWriteEnv({ writeEnv: null, forceEnv: false }, true);
  assert.equal(keep.write, false);
  const first = decideWriteEnv({ writeEnv: null, forceEnv: false }, false);
  assert.equal(first.write, true);
  const force = decideWriteEnv({ writeEnv: null, forceEnv: true }, true);
  assert.equal(force.write, true);
  const skip = decideWriteEnv({ writeEnv: false, forceEnv: true }, false);
  assert.equal(skip.write, false);
});

test("compareNodeVersion accepts the documented floor", () => {
  assert.equal(compareNodeVersion("22.13.0", "22.13") >= 0, true);
  assert.equal(compareNodeVersion("22.12.0", "22.13") < 0, true);
});

test("backupSqlite snapshots a live SQLite file next to it", () => {
  const { DatabaseSync } = require("node:sqlite");
  const { existsSync } = require("node:fs");
  const root = tempRepo();
  const dbPath = join(root, "apps", "server", "prisma", "ordo.db");
  mkdirSync(join(root, "apps", "server", "prisma"), { recursive: true });
  const db = new DatabaseSync(dbPath);
  db.exec(`CREATE TABLE "User" (id TEXT);`);
  db.close();
  const now = new Date("2026-09-15T06:55:00.000Z");
  const lines = [];
  const backupPath = backupSqlite(dbPath, { log: (line) => lines.push(String(line)), now });
  assert.equal(backupPath, `${dbPath}.bak-2026-09-15T06-55-00-000Z`);
  assert.equal(existsSync(backupPath), true);
  assert.match(lines.join("\n"), /Backing up SQLite/);
  const copy = new DatabaseSync(backupPath, { readOnly: true });
  const tables = copy.prepare(`SELECT name FROM sqlite_master WHERE type = 'table'`).all();
  copy.close();
  assert.equal(tables.some((row) => row.name === "User"), true);
});

test("deploy --yes --dry-run writes a plan and skips migrate deploy on a legacy db", async () => {
  const { DatabaseSync } = require("node:sqlite");
  const root = tempRepo();
  const prismaDir = join(root, "apps", "server", "prisma");
  mkdirSync(prismaDir, { recursive: true });
  const dbPath = join(prismaDir, "ordo.db");
  const db = new DatabaseSync(dbPath);
  db.exec(`CREATE TABLE "User" (id TEXT);`);
  db.close();

  const lines = [];
  const result = await deploy({
    argv: ["--yes", "--dry-run", "--skip-install", "--skip-build", "--port", "8080"],
    repoRoot: root,
    env: { ...process.env, CI: "1" },
    log: (line) => lines.push(String(line)),
  });
  const log = lines.join("\n");
  assert.equal(result.ok, true);
  assert.equal(result.command, "update");
  assert.equal(result.interactive, false);
  assert.equal(result.settings.port, 8080);
  assert.equal(result.migrate.action, "adopt");
  assert.equal(result.envDecision.write, true);
  assert.equal(result.backup, true);
  assert.equal(result.pull, false);
  assert.match(log, /adopting it/i);
  assert.match(log, /\$ node dist\/prisma\/upgrade-cli\.js/);
  assert.match(log, /Backing up SQLite/);
  assert.doesNotMatch(log, /\$ pnpm exec prisma migrate deploy/);
});

test("update --yes --dry-run keeps .env, pulls, and runs the upgrade CLI", async () => {
  const { DatabaseSync } = require("node:sqlite");
  const root = tempRepo();
  mkdirSync(join(root, ".git"));
  writeFileSync(join(root, "apps", "server", ".env"), "PORT=3000\nREGISTRATION_ENABLED=true\n");
  const prismaDir = join(root, "apps", "server", "prisma");
  mkdirSync(prismaDir, { recursive: true });
  const db = new DatabaseSync(join(prismaDir, "ordo.db"));
  db.exec(`CREATE TABLE _prisma_migrations (id TEXT); CREATE TABLE "User" (id TEXT);`);
  db.close();

  const lines = [];
  const result = await deploy({
    argv: ["update", "--yes", "--dry-run", "--skip-install", "--skip-build"],
    repoRoot: root,
    env: { ...process.env, CI: "1" },
    log: (line) => lines.push(String(line)),
  });
  const log = lines.join("\n");
  assert.equal(result.command, "update");
  assert.equal(result.envDecision.write, false);
  assert.equal(result.migrate.action, "deploy");
  assert.equal(result.pull, true);
  assert.equal(result.backup, true);
  assert.match(log, /Updating the existing backend/);
  assert.match(log, /Leaving existing apps\/server\/\.env/);
  assert.match(log, /\$ git pull --ff-only/);
  assert.match(log, /\$ node dist\/prisma\/upgrade-cli\.js/);
  assert.doesNotMatch(log, /\$ pnpm exec prisma migrate deploy/);
  assert.doesNotMatch(log, /Wrote /);
});

test("interactive dry-run uses prompt answers", async () => {
  const root = tempRepo();
  const answers = ["8080", "n", "n", "", "y", "1", "n"];
  let i = 0;
  const result = await deploy({
    argv: ["install", "--dry-run", "--skip-install", "--skip-build", "--skip-migrate"],
    repoRoot: root,
    env: { ...process.env, CI: "" },
    interactive: true,
    ask: async () => answers[i++] ?? "",
    log: () => {},
  });
  assert.equal(result.command, "install");
  assert.equal(result.interactive, true);
  assert.equal(result.settings.port, 8080);
  assert.equal(result.settings.registration, false);
  assert.equal(result.settings.listenHost, "127.0.0.1");
  assert.equal(result.settings.trustProxy, 1);
  assert.equal(result.start, false);
  assert.equal(result.pull, false);
  assert.equal(i, answers.length);
});

test("--help prints usage and exits cleanly", () => {
  const result = spawnSync(process.execPath, [join(__dirname, "deploy-server.js"), "--help"], {
    encoding: "utf8",
  });
  assert.equal(result.status, 0);
  assert.match(result.stdout, /Non-interactive/);
  assert.match(result.stdout, /--trust-proxy/);
  assert.match(result.stdout, /--public/);
  assert.match(result.stdout, /update/);
  assert.equal(HELP.includes("migrate deploy"), true);
  assert.equal(HELP.includes("upgrade"), true);
});
