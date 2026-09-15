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
    "--yes",
    "--port=8080",
    "--registration",
    "false",
    "--trust-proxy",
    "1",
    "--smtp-url",
    "smtp://mail.example:587",
    "--no-start",
    "--dry-run",
  ]);
  assert.equal(args.yes, true);
  assert.equal(args.port, 8080);
  assert.equal(args.registration, false);
  assert.equal(args.trustProxy, 1);
  assert.equal(args.smtpUrl, "smtp://mail.example:587");
  assert.equal(args.start, false);
  assert.equal(args.dryRun, true);
});

test("parseArgs rejects unknown flags and bad values", () => {
  assert.throws(() => parseArgs(["--nope"]), /Unknown option/);
  assert.throws(() => parseArgs(["--port", "nope"]), /--port/);
  assert.throws(() => parseArgs(["--registration", "maybe"]), /boolean/);
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
  assert.equal(settings.trustProxy, 1);
});

test("renderEnv quotes values that need it and comments unset secrets", () => {
  const text = renderEnv({
    port: 3000,
    databaseUrl: "file:./ordo.db",
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
  assert.match(migratePlan("legacy", false).reason, /adopt/);
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
  assert.equal(result.ok, true);
  assert.equal(result.interactive, false);
  assert.equal(result.settings.port, 8080);
  assert.equal(result.migrate.action, "adopt");
  assert.equal(result.envDecision.write, true);
  assert.match(lines.join("\n"), /adopt this file/i);
  assert.doesNotMatch(lines.join("\n"), /\$ pnpm exec prisma migrate deploy/);
});

test("interactive dry-run uses prompt answers", async () => {
  const root = tempRepo();
  const answers = ["8080", "n", "n", "", "y", "1", "n"];
  let i = 0;
  const result = await deploy({
    argv: ["--dry-run", "--skip-install", "--skip-build", "--skip-migrate"],
    repoRoot: root,
    env: { ...process.env, CI: "" },
    interactive: true,
    ask: async () => answers[i++] ?? "",
    log: () => {},
  });
  assert.equal(result.interactive, true);
  assert.equal(result.settings.port, 8080);
  assert.equal(result.settings.registration, false);
  assert.equal(result.settings.trustProxy, 1);
  assert.equal(result.start, false);
  assert.equal(i, answers.length);
});

test("--help prints usage and exits cleanly", () => {
  const result = spawnSync(process.execPath, [join(__dirname, "deploy-server.js"), "--help"], {
    encoding: "utf8",
  });
  assert.equal(result.status, 0);
  assert.match(result.stdout, /Non-interactive/);
  assert.match(result.stdout, /--trust-proxy/);
  assert.equal(HELP.includes("migrate deploy"), true);
});
