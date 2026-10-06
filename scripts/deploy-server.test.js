const assert = require("node:assert/strict");
const { spawnSync } = require("node:child_process");
const { existsSync, mkdirSync, rmSync, writeFileSync } = require("node:fs");
const { tmpdir } = require("node:os");
const { join } = require("node:path");
const { test } = require("node:test");
const {
  HELP,
  DEFAULTS,
  parseArgs,
  isInteractive,
  sqlitePathFromUrl,
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
  formatSetupSummary,
  formatSetupBanner,
  formatNextSteps,
  promptGuidedSettings,
  installProcess,
  backupSqlite,
  dirtyWorktreeMessage,
  shouldReexec,
  reexecArgs,
  dependenciesReady,
  parseSsPids,
  isOrdoServer,
  chooseStart,
  healthUrl,
  isOrdoInfo,
  decideWriteEnv,
  compareNodeVersion,
  deploy,
} = require("./deploy-server.js");

function publishedRelease(tag = "v0.1.0", extra = {}) {
  return {
    tag_name: tag,
    draft: false,
    prerelease: false,
    published_at: "2026-09-01T00:00:00Z",
    tarball_url: "https://example.test/tarball",
    assets: [
      {
        name: `ordo-server-${tag}.tar.gz`,
        browser_download_url: `https://example.test/${tag}.tar.gz`,
      },
    ],
    ...extra,
  };
}

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
  assert.equal(args.noRelease, true);
  assert.equal(args.dryRun, true);
});

test("parseArgs reads a release and rejects mixing it with git pull", () => {
  const args = parseArgs(["update", "--release", "v0.1.2", "--pre", "--repo", "axoletlabs/ordo", "--require-asset"]);
  assert.equal(args.command, "update");
  assert.equal(args.release, "v0.1.2");
  assert.equal(args.pre, true);
  assert.equal(args.repo, "axoletlabs/ordo");
  assert.equal(args.requireAsset, true);
  assert.equal(args.fromGit, false);
  assert.equal(parseArgs(["--from-git"]).fromGit, true);
  assert.equal(parseArgs(["--release=0.1.0"]).release, "0.1.0");
  assert.throws(() => parseArgs(["--release", "v0.1.0", "--from-git"]), /--from-git/);
  assert.throws(() => parseArgs(["--release", "v0.1.0", "--no-release"]), /--no-release/);
  assert.throws(() => parseArgs(["--repo", "not a repo"]), /owner\/name/);
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
  assert.equal(inferCommand("uninstall", false), "uninstall");
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

test("renderEnv writes a complete, documented file with explicit secrets", () => {
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
    smtpRequired: true,
  }, {
    stamp: "2026-10-06",
    secrets: { jwtSecret: "a".repeat(96), libraryKek: "b".repeat(64) },
  });
  assert.match(text, /PORT=3000/);
  assert.match(text, /LISTEN_HOST=127.0.0.1/);
  assert.ok(text.includes('DATABASE_URL="file:./ordo.db"'));
  assert.match(text, /TRUST_PROXY=1/);
  assert.match(text, /RATE_LIMIT_ENABLED=true/);
  assert.match(text, /SMTP_REQUIRED=true/);
  assert.ok(text.includes(`JWT_SECRET=${"a".repeat(96)}`));
  assert.ok(text.includes(`LIBRARY_KEK=${"b".repeat(64)}`));
  assert.doesNotMatch(text, /auto-generates/);
  // Every managed key is present, as an assignment or a documented comment.
  for (const key of MANAGED_ENV_KEYS) {
    assert.match(text, new RegExp(`^(# )?${key}=`, "m"), `${key} missing`);
  }
});

test("renderEnv keeps custom keys from a previous .env and notes missing secrets", () => {
  const text = renderEnv({ ...DEFAULTS }, { preserved: { AVATAR_DIR: "/srv/avatars" } });
  assert.match(text, /Preserved from your previous \.env/);
  assert.match(text, /AVATAR_DIR=\/srv\/avatars/);
  assert.match(text, /# JWT_SECRET=   # run scripts\/deploy-server to generate one/);
  assert.match(text, /# LIBRARY_KEK=   # run scripts\/deploy-server to generate one/);
});

test("resolveSetupSecrets prefers env, then the sidecar files, then generates", () => {
  const root = tempRepo();
  const serverDir = join(root, "apps", "server");
  mkdirSync(serverDir, { recursive: true });

  const generated = resolveSetupSecrets(serverDir, {}, { randomBytesFn: (n) => Buffer.alloc(n, 7) });
  assert.equal(generated.jwtSecret.length, 96);
  assert.equal(generated.libraryKek.length, 64);
  assert.equal(generated.jwtSource, "generated");
  assert.equal(generated.kekSource, "generated");

  writeFileSync(join(serverDir, ".ordo-secret"), "legacy-secret\n");
  writeFileSync(join(serverDir, ".ordo-library-key"), "legacy-kek\n");
  const fromFiles = resolveSetupSecrets(serverDir, {});
  assert.equal(fromFiles.jwtSecret, "legacy-secret");
  assert.equal(fromFiles.libraryKek, "legacy-kek");
  assert.equal(fromFiles.jwtSource, "file");

  const fromEnv = resolveSetupSecrets(serverDir, {
    JWT_SECRET: "env-secret",
    LIBRARY_KEK: "env-kek",
  });
  assert.equal(fromEnv.jwtSecret, "env-secret");
  assert.equal(fromEnv.libraryKek, "env-kek");
  assert.equal(fromEnv.jwtSource, "env");
  assert.equal(fromEnv.kekSource, "env");
});

test("preservedEnvKeys and needsEnvMigration find pre-explicit .env files", () => {
  assert.deepEqual(preservedEnvKeys({ PORT: "3000", AVATAR_DIR: "/a" }), { AVATAR_DIR: "/a" });
  assert.equal(needsEnvMigration({ JWT_SECRET: "x", LIBRARY_KEK: "y" }), false);
  assert.equal(needsEnvMigration({ JWT_SECRET: "x" }), true);
  assert.equal(needsEnvMigration({}), true);
});

test("validateSmtpUrl accepts smtp URLs and rejects the rest", () => {
  assert.equal(validateSmtpUrl(""), null);
  assert.equal(validateSmtpUrl("(empty)"), null);
  assert.equal(validateSmtpUrl("smtp://user:pass@smtp.example.com:587"), null);
  assert.equal(validateSmtpUrl("smtps://smtp.example.com"), null);
  assert.match(validateSmtpUrl("nope"), /not a URL/);
  assert.match(validateSmtpUrl("http://example.com"), /smtp:\/\//);
  assert.match(validateSmtpUrl("smtp://"), /mail host/);
});

test("an explicit --smtp-url fails closed without --smtp-required", () => {
  const flagged = settingsFromSources(parseArgs(["--smtp-url", "smtp://m:587"]), {});
  assert.equal(flagged.smtpRequired, true);
  const explicitOff = settingsFromSources(
    parseArgs(["--smtp-url", "smtp://m:587", "--smtp-required", "false"]),
    {},
  );
  assert.equal(explicitOff.smtpRequired, false);
  const fromEnv = settingsFromSources(parseArgs([]), { SMTP_URL: "smtp://m:587" });
  assert.equal(fromEnv.smtpRequired, false);
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
    releases: [publishedRelease()],
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
  assert.equal(result.release.tag, "v0.1.0");
  assert.equal(result.release.mode, "asset");
  assert.match(log, /ordo-server-v0\.1\.0\.tar\.gz/);
  assert.doesNotMatch(log, /git pull/);
  assert.match(log, /adopting it/i);
  assert.match(log, /\$ node dist\/prisma\/upgrade-cli\.js/);
  assert.match(log, /Backing up SQLite/);
  assert.doesNotMatch(log, /\$ pnpm exec prisma migrate deploy/);
});

test("update --yes --dry-run keeps .env, installs the latest stable release, and runs the upgrade CLI", async () => {
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
    releases: [
      publishedRelease("v0.2.0-beta.1", { prerelease: true, published_at: "2026-09-20T00:00:00Z" }),
      publishedRelease("v0.1.1", { published_at: "2026-09-02T00:00:00Z" }),
    ],
    log: (line) => lines.push(String(line)),
  });
  const log = lines.join("\n");
  assert.equal(result.command, "update");
  assert.equal(result.envDecision.write, false);
  assert.equal(result.migrate.action, "deploy");
  assert.equal(result.pull, false);
  assert.equal(result.release.tag, "v0.1.1");
  assert.equal(result.backup, true);
  assert.match(log, /Updating the existing backend/);
  assert.match(log, /Leaving existing apps\/server\/\.env/);
  assert.match(log, /Release: v0\.1\.1/);
  assert.match(log, /not the tip of the current branch/);
  assert.doesNotMatch(log, /git pull/);
  assert.match(log, /\$ node dist\/prisma\/upgrade-cli\.js/);
  assert.doesNotMatch(log, /\$ pnpm exec prisma migrate deploy/);
  assert.doesNotMatch(log, /Wrote /);
});

test("update --from-git still plans a fast-forward pull", async () => {
  const root = tempRepo();
  mkdirSync(join(root, ".git"));
  writeFileSync(join(root, "apps", "server", ".env"), "PORT=3000\n");
  const lines = [];
  const result = await deploy({
    argv: ["update", "--yes", "--dry-run", "--from-git", "--skip-install", "--skip-build", "--skip-migrate"],
    repoRoot: root,
    env: { ...process.env, CI: "1" },
    log: (line) => lines.push(String(line)),
  });
  assert.equal(result.pull, true);
  assert.equal(result.release, null);
  assert.match(lines.join("\n"), /\$ git pull --ff-only/);
});

test("interactive dry-run uses prompt answers", async () => {
  const root = tempRepo();
  const answers = ["8080", "n", "n", "", "y", "1", "1", "n"];
  let i = 0;
  const result = await deploy({
    argv: ["install", "--dry-run", "--skip-install", "--skip-build", "--skip-migrate"],
    repoRoot: root,
    env: { ...process.env, CI: "" },
    interactive: true,
    releases: [publishedRelease()],
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
  assert.equal(result.release.tag, "v0.1.0");
  assert.equal(i, answers.length);
});

test("dirty worktree blocks pull, and a new HEAD re-execs once", () => {
  assert.equal(dirtyWorktreeMessage("?? scripts/notes.txt\n"), null);
  assert.match(dirtyWorktreeMessage(" M scripts/deploy-server.js\n"), /--no-release/);
  assert.match(dirtyWorktreeMessage(" M scripts/deploy-server.js\n", "--no-pull"), /--no-pull/);
  assert.equal(shouldReexec("aaa", "bbb", undefined), true);
  assert.equal(shouldReexec("aaa", "aaa", undefined), false);
  assert.equal(shouldReexec("aaa", "bbb", "bbb"), false);
  assert.deepEqual(reexecArgs(["update", "--yes"]), ["update", "--yes", "--no-pull"]);
  assert.deepEqual(reexecArgs(["update", "--no-pull"]), ["update", "--no-pull"]);
  assert.deepEqual(reexecArgs(["update", "--yes"], "release"), ["update", "--yes", "--no-release"]);
});

test("matching lockfiles skip install", () => {
  const { writeFileSync } = require("node:fs");
  const root = tempRepo();
  assert.equal(dependenciesReady(root), false);
  const lock = join(root, "pnpm-lock.yaml");
  const installed = join(root, "node_modules", ".pnpm", "lock.yaml");
  writeFileSync(lock, "lockfileVersion: 9.0\n");
  mkdirSync(join(root, "node_modules", ".pnpm"), { recursive: true });
  writeFileSync(installed, "lockfileVersion: 9.0\n");
  assert.equal(dependenciesReady(root), true);
  writeFileSync(installed, "different\n");
  assert.equal(dependenciesReady(root), false);
});

test("port listeners and restart choice", () => {
  assert.deepEqual(parseSsPids('LISTEN 0 128 127.0.0.1:3000 users:(("node",pid=42,fd=20))'), [42]);
  assert.equal(
    isOrdoServer({ pid: 42, cwd: "/opt/ordo/apps/server", cmdline: "node dist/main.js" }, "/opt/ordo/apps/server"),
    true,
  );
  assert.equal(
    isOrdoServer({ pid: 7, cwd: "/other", cmdline: "node dist/main.js" }, "/opt/ordo/apps/server"),
    false,
  );
  assert.equal(chooseStart({ wasRunning: true, start: null }), "detached");
  assert.equal(chooseStart({ wasRunning: true, start: false }), "none");
  assert.equal(chooseStart({ wasRunning: false, start: true }), "foreground");
  assert.equal(healthUrl({ listenHost: "127.0.0.1", port: 3000 }), "http://127.0.0.1:3000/api/server/info");
  assert.equal(isOrdoInfo({ version: "0.1.0", registrationEnabled: false }), true);
  assert.equal(isOrdoInfo({ ok: true }), false);
});

test("update dry-run plans to restart a running server without stopping it yet", async () => {
  const root = tempRepo();
  mkdirSync(join(root, ".git"));
  writeFileSync(join(root, "apps", "server", ".env"), "PORT=3000\n");
  const lines = [];
  const result = await deploy({
    argv: ["update", "--yes", "--dry-run", "--skip-install", "--skip-build", "--skip-migrate", "--no-pull"],
    repoRoot: root,
    env: { ...process.env, CI: "1" },
    listener: { kind: "ordo", pid: 42 },
    log: (line) => lines.push(String(line)),
  });
  const log = lines.join("\n");
  assert.equal(result.launch, "detached");
  assert.match(log, /pid 42/);
  assert.match(log, /background/);
  assert.doesNotMatch(log, /Stopping ordo/);
});

test("a foreign process on the port aborts before install", async () => {
  const root = tempRepo();
  await assert.rejects(
    () =>
      deploy({
        argv: ["install", "--yes", "--dry-run", "--start", "--no-pull"],
        repoRoot: root,
        env: { ...process.env, CI: "1" },
        listener: { kind: "other", pid: 9, command: "python -m http.server" },
        log: () => {},
      }),
    /python -m http.server/,
  );
});

test("guided setup keeps the usual choices, validates, and confirms first", async () => {
  const seen = [];
  const pick = async (spec) => {
    seen.push(`${spec.title}\n${spec.detail}`);
    return spec.options[spec.selected].value;
  };
  const ask = async (question) => {
    seen.push(question);
    return "";
  };
  const { DEFAULTS } = require("./deploy-server.js");
  const logged = [];
  const settings = await promptGuidedSettings(ask, DEFAULTS, pick, (l) => logged.push(String(l)));
  assert.equal(settings.port, 3000);
  assert.equal(settings.registration, false);
  assert.equal(settings.emailVerification, false);
  assert.equal(settings.smtpUrl, "");
  assert.equal(settings.smtpRequired, false);
  assert.equal(settings.listenHost, "127.0.0.1");
  assert.equal(settings.trustProxy, 0);
  assert.match(seen.join("\n"), /The first sign-up becomes the owner either way/);
  assert.match(seen.join("\n"), /Port \[3000\]/);
  const wizardLog = logged.join("\n");
  assert.match(wizardLog, /Step 1 of 5/);
  assert.match(wizardLog, /Step 5 of 5/);
  assert.match(wizardLog, /Ready to install/);
  assert.match(seen.join("\n"), /Install with these settings\?/);
  const summary = formatSetupSummary(settings, "/home/ubuntu/ordo");
  assert.match(summary, /Only the first account/);
  assert.match(summary, /http:\/\/127\.0\.0\.1:3000/);
  assert.match(summary, /Codes in the server log/);
  assert.match(summary, /Compiling the server can take a few minutes/);
});

test("guided setup re-asks a bad SMTP URL and confirms codes by email only", async () => {
  const answers = ["", "not a url", "smtp://user:pass@mail.example.com:587", "Ordo <no-reply@example.com>"];
  let asked = 0;
  const ask = async () => answers[asked++ % answers.length];
  const pick = async (spec) => spec.options[spec.selected].value;
  const lines = [];
  const settings = await promptGuidedSettings(ask, { ...DEFAULTS }, pick, (l) => lines.push(String(l)));
  assert.equal(settings.smtpUrl, "smtp://user:pass@mail.example.com:587");
  assert.equal(settings.smtpFrom, "Ordo <no-reply@example.com>");
  assert.equal(settings.smtpRequired, true);
  assert.match(lines.join("\n"), /not a URL/);
  assert.match(formatSetupSummary(settings), /SMTP, email only/);
});

test("guided setup can be replayed or cancelled from the summary", async () => {
  let confirms = 0;
  const pick = async (spec) => {
    if (spec.title === "Install with these settings?") {
      confirms += 1;
      return confirms >= 2 ? "install" : "again";
    }
    return spec.options[spec.selected].value;
  };
  const ask = async () => "";
  const lines = [];
  const settings = await promptGuidedSettings(ask, { ...DEFAULTS }, pick, (l) => lines.push(String(l)));
  assert.equal(settings.port, 3000);
  assert.equal(confirms, 2);
  assert.match(lines.join("\n"), /Starting over/);

  await assert.rejects(
    () =>
      promptGuidedSettings(
        ask,
        { ...DEFAULTS },
        async (spec) =>
          spec.title === "Install with these settings?" ? "cancel" : spec.options[spec.selected].value,
        () => {},
      ),
    (error) => error.code === "CANCELLED" && /Nothing was installed/.test(error.message),
  );
});

test("guided setup suggests the next port when the default is taken", async () => {
  const ask = async (question) => {
    if (/^Port /.test(question)) {
      assert.match(question, /\[3001\]/, "should suggest 3001");
    }
    return "";
  };
  const pick = async (spec) => spec.options[spec.selected].value;
  const lines = [];
  const settings = await promptGuidedSettings(
    ask,
    { ...DEFAULTS },
    pick,
    (l) => lines.push(String(l)),
    { portInUse: () => ({ kind: "other", pid: 1, command: "python http.server" }) },
  );
  assert.equal(settings.port, 3001);
  assert.match(lines.join("\n"), /already used by another program/);
});

test("the banner and next-steps panel document what setup does", () => {
  const banner = formatSetupBanner(false);
  assert.match(banner, /ordo · self-hosted server/);
  assert.match(banner, /writes a complete, documented apps\/server\/\.env/);
  assert.match(banner, /generates the session and library-encryption secrets/);
  const panel = formatNextSteps({
    settings: { ...DEFAULTS },
    dbPath: "apps/server/prisma/ordo.db",
    envPath: "apps/server/.env",
    launch: "none",
  });
  assert.match(panel, /Setup finished/);
  assert.match(panel, /NODE_ENV=production pnpm start/);
  assert.match(panel, /api\/server\/info/);
  assert.match(panel, /Use your own server/);
  assert.match(panel, /deploy-server update/);
  assert.match(panel, /deploy-server uninstall/);
  assert.match(panel, /SERVER-SETUP\.md/);
});

test("installProcess matches this server and not another cwd", () => {
  const server = "/opt/ordo/apps/server";
  assert.equal(installProcess({ cwd: server, cmdline: "node dist/main.js" }, server), true);
  assert.equal(installProcess({ cwd: server, cmdline: "/usr/bin/pnpm start" }, server), true);
  assert.equal(installProcess({ cwd: "/tmp/other", cmdline: "pnpm start" }, server), false);
  assert.equal(installProcess({ cwd: server, cmdline: "vim notes.txt" }, server), false);
  assert.equal(installProcess(null, server), false);
});

test("uninstall --yes removes the folder and leaves an outside database", async () => {
  const root = tempRepo();
  const outside = join(tmpdir(), `ordo-db-${process.pid}-${Date.now()}.db`);
  mkdirSync(join(root, "apps", "server", "prisma"), { recursive: true });
  writeFileSync(join(root, "apps", "server", "prisma", "ordo.db"), "local");
  writeFileSync(join(root, "apps", "server", ".env"), `DATABASE_URL=file:${outside}\n`);
  writeFileSync(outside, "kept");
  const lines = [];
  const result = await deploy({
    argv: ["uninstall", "--yes"],
    repoRoot: root,
    env: { ...process.env, CI: "1", HOME: tmpdir() },
    stopInstall: () => lines.push("stop"),
    log: (line) => lines.push(String(line)),
  });
  assert.equal(result.command, "uninstall");
  assert.equal(result.removed, true);
  assert.equal(existsSync(root), false);
  assert.equal(existsSync(outside), true);
  assert.match(lines.join("\n"), new RegExp(`Left the database at ${outside}`));
  assert.equal(lines[0], "stop");
  rmSync(outside, { force: true });
});

test("uninstall asks before deleting and refuses a git checkout", async () => {
  const root = tempRepo();
  writeFileSync(join(root, "apps", "server", ".env"), "PORT=3000\n");
  const cancelled = await deploy({
    argv: ["uninstall"],
    repoRoot: root,
    interactive: true,
    env: { ...process.env, CI: "", HOME: tmpdir() },
    ask: async () => "n",
    log: () => {},
  });
  assert.equal(cancelled.cancelled, true);
  assert.equal(existsSync(root), true);

  await assert.rejects(
    () =>
      deploy({
        argv: ["uninstall"],
        repoRoot: root,
        env: { ...process.env, CI: "1", HOME: tmpdir() },
        log: () => {},
      }),
    /--yes/,
  );
  assert.equal(existsSync(root), true);

  const lines = [];
  const dry = await deploy({
    argv: ["uninstall", "--yes", "--dry-run"],
    repoRoot: root,
    env: { ...process.env, CI: "1", HOME: tmpdir() },
    log: (line) => lines.push(String(line)),
  });
  assert.equal(dry.dryRun, true);
  assert.equal(existsSync(root), true);
  assert.match(lines.join("\n"), /Would stop ordo and remove/);

  mkdirSync(join(root, ".git"));
  await assert.rejects(
    () =>
      deploy({
        argv: ["uninstall", "--yes"],
        repoRoot: root,
        env: { ...process.env, CI: "1", HOME: tmpdir() },
        log: () => {},
      }),
    /git checkout/,
  );
  assert.equal(existsSync(root), true);

  await assert.rejects(
    () =>
      deploy({
        argv: ["uninstall", "--yes"],
        repoRoot: root,
        env: { ...process.env, CI: "1", HOME: root },
        log: () => {},
      }),
    /Refusing to remove/,
  );
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
  assert.match(result.stdout, /--release/);
  assert.match(result.stdout, /--from-git/);
  assert.equal(HELP.includes("migrate deploy"), true);
  assert.equal(HELP.includes("upgrade"), true);
});
