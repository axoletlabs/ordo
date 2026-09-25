const assert = require("node:assert/strict");
const { spawnSync } = require("node:child_process");
const { createHash } = require("node:crypto");
const { createReadStream, mkdirSync, readFileSync, writeFileSync } = require("node:fs");
const { tmpdir } = require("node:os");
const { join } = require("node:path");
const { Readable } = require("node:stream");
const { test } = require("node:test");
const {
  normalizeReleaseSpec,
  selectRelease,
  pickServerAsset,
  formatReleaseMenu,
  chooseListedRelease,
  releaseApplyMode,
  planLines,
  isPreserved,
  syncReleaseTree,
  parseChecksum,
  readInstalledRelease,
  applySelectedRelease,
} = require("./server-release.js");

function tempDir() {
  const root = join(tmpdir(), `ordo-release-${process.pid}-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  mkdirSync(root, { recursive: true });
  return root;
}

function write(path, body) {
  mkdirSync(join(path, ".."), { recursive: true });
  writeFileSync(path, body);
}

function release(tag, extra = {}) {
  return {
    tag_name: tag,
    draft: false,
    prerelease: false,
    published_at: "2026-09-01T00:00:00Z",
    tarball_url: `https://example.test/${tag}.tar.gz`,
    assets: [],
    ...extra,
  };
}

function git(cwd, args) {
  const result = spawnSync("git", ["-c", "user.email=ordo-test@example.com", "-c", "user.name=ordo-test", ...args], {
    cwd,
    encoding: "utf8",
  });
  assert.equal(result.status, 0, result.stderr || result.stdout);
  return (result.stdout ?? "").trim();
}

test("normalizeReleaseSpec accepts latest and tags", () => {
  assert.deepEqual(normalizeReleaseSpec(""), { kind: "latest", pre: false });
  assert.deepEqual(normalizeReleaseSpec("latest", { pre: true }), { kind: "latest", pre: true });
  assert.deepEqual(normalizeReleaseSpec("latest-pre"), { kind: "latest", pre: true });
  assert.deepEqual(normalizeReleaseSpec("0.1.0"), { kind: "tag", tag: "v0.1.0", pre: false });
  assert.deepEqual(normalizeReleaseSpec("v0.2.0-beta.1"), {
    kind: "tag",
    tag: "v0.2.0-beta.1",
    pre: false,
  });
  assert.throws(() => normalizeReleaseSpec("main"), /--release/);
});

test("selectRelease prefers the newest stable release", () => {
  const catalog = [
    release("v0.2.0-beta.1", { prerelease: true, published_at: "2026-09-20T00:00:00Z" }),
    release("v0.1.1", { published_at: "2026-09-02T00:00:00Z" }),
    release("v0.1.0", { published_at: "2026-08-01T00:00:00Z" }),
    release("v0.0.9", { draft: true, published_at: "2026-09-21T00:00:00Z" }),
  ];
  assert.equal(selectRelease(catalog, { kind: "latest", pre: false }).tag_name, "v0.1.1");
  assert.equal(selectRelease(catalog, { kind: "latest", pre: true }).tag_name, "v0.2.0-beta.1");
  assert.equal(selectRelease(catalog, { kind: "tag", tag: "v0.1.0" }).tag_name, "v0.1.0");
  assert.throws(() => selectRelease(catalog, { kind: "tag", tag: "v9.9.9" }), /not found/);
  assert.throws(
    () => selectRelease([catalog[0]], { kind: "latest", pre: false }),
    /--pre/,
  );
});

test("the menu numbers stable releases and can select one", () => {
  const catalog = [
    release("v0.2.0-rc.1", { prerelease: true, published_at: "2026-09-03T00:00:00Z" }),
    release("v0.1.0", { published_at: "2026-09-01T00:00:00Z" }),
  ];
  const menu = formatReleaseMenu(catalog, { installedTag: "v0.1.0" });
  assert.match(menu, /1\)\s+v0\.1\.0/);
  assert.match(menu, /installed/);
  assert.match(menu, /1 pre-release hidden/);
  assert.equal(chooseListedRelease(catalog, "", {}).tag_name, "v0.1.0");
  assert.equal(chooseListedRelease(catalog, "1", {}).tag_name, "v0.1.0");
  assert.equal(chooseListedRelease(catalog, "v0.2.0-rc.1", {}).tag_name, "v0.2.0-rc.1");
  assert.throws(() => chooseListedRelease(catalog, "v9.9.9", {}), (error) => {
    assert.equal(error.fetchTag, "v9.9.9");
    return true;
  });
  assert.equal(chooseListedRelease(catalog, "1", { pre: true }).tag_name, "v0.2.0-rc.1");
});

test("an official archive is preferred over checking out the tag", () => {
  const asset = release("v0.1.0", {
    assets: [
      { name: "ordo-server-v0.1.0.tar.gz", browser_download_url: "https://example.test/a.tar.gz" },
      { name: "ordo-server-v0.1.0.tar.gz.sha256", browser_download_url: "https://example.test/a.sha256" },
      { name: "ordo-v0.1.0.apk", browser_download_url: "https://example.test/app.apk" },
    ],
  });
  assert.equal(pickServerAsset(asset).tarball.name, "ordo-server-v0.1.0.tar.gz");
  assert.equal(releaseApplyMode(asset, { hasGit: true }), "asset");
  assert.equal(releaseApplyMode(release("v0.1.0"), { hasGit: true }), "git-tag");
  assert.equal(releaseApplyMode(release("v0.1.0"), { hasGit: false }), "source");
  assert.throws(() => releaseApplyMode(release("v0.1.0"), { hasGit: true, requireAsset: true }), /ordo-server/);
  const lines = planLines({ release: asset, mode: "asset", installed: { tag: "v0.1.0" } });
  assert.match(lines.join("\n"), /reinstall/);
  assert.match(lines.join("\n"), /not the tip of the current branch/);
});

test("preserved paths are the live database, secrets, and avatars", () => {
  assert.equal(isPreserved("apps/server/.env"), true);
  assert.equal(isPreserved("apps/server/.ordo-secret"), true);
  assert.equal(isPreserved("apps/server/prisma/ordo.db"), true);
  assert.equal(isPreserved("apps/server/prisma/ordo.db.bak-2026"), true);
  assert.equal(isPreserved("apps/server/prisma/ordo-avatars/user.webp"), true);
  assert.equal(isPreserved("apps/server/prisma/schema.prisma"), false);
  assert.equal(isPreserved("apps/server/prisma/migrations/2026/migration.sql"), false);
  assert.equal(isPreserved("apps/server/src/main.js"), false);
});

test("syncReleaseTree replaces source and leaves operator data", () => {
  const dest = tempDir();
  const archive = tempDir();
  write(join(dest, "apps/server/prisma/ordo.db"), "keep-db");
  write(join(dest, "apps/server/prisma/ordo-avatars/user.webp"), "pic");
  write(join(dest, "apps/server/.env"), "PORT=1\n");
  write(join(dest, "apps/server/.ordo-secret"), "secret");
  write(join(dest, "apps/server/src/old.js"), "old");
  write(join(archive, "apps/server/prisma/schema.prisma"), "model Next\n");
  write(join(archive, "apps/server/prisma/migrations/2026/migration.sql"), "select 1;\n");
  write(join(archive, "apps/server/prisma/ordo.db"), "from-archive");
  write(join(archive, "apps/server/.env"), "PORT=9\n");
  write(join(archive, "apps/server/src/main.js"), "new");
  write(join(archive, "README.md"), "hi\n");

  const result = syncReleaseTree(dest, archive, {
    tracked: ["apps/server/src/old.js", "apps/server/src/main.js", "README.md", "apps/server/.env"],
  });

  assert.equal(readFileSync(join(dest, "apps/server/prisma/ordo.db"), "utf8"), "keep-db");
  assert.equal(readFileSync(join(dest, "apps/server/prisma/ordo-avatars/user.webp"), "utf8"), "pic");
  assert.equal(readFileSync(join(dest, "apps/server/.env"), "utf8"), "PORT=1\n");
  assert.equal(readFileSync(join(dest, "apps/server/.ordo-secret"), "utf8"), "secret");
  assert.equal(readFileSync(join(dest, "apps/server/prisma/schema.prisma"), "utf8"), "model Next\n");
  assert.equal(readFileSync(join(dest, "apps/server/src/main.js"), "utf8"), "new");
  assert.equal(readFileSync(join(dest, "README.md"), "utf8"), "hi\n");
  assert.equal(require("node:fs").existsSync(join(dest, "apps/server/src/old.js")), false);
  assert.equal(result.removed.includes("apps/server/src/old.js"), true);
  assert.equal(result.removed.includes("apps/server/.env"), false);
});

test("parseChecksum reads sha256sum output", () => {
  const hash = "abc".padEnd(64, "a");
  assert.equal(parseChecksum(`${hash}  ordo-server-v0.1.0.tar.gz\n`), hash);
  assert.throws(() => parseChecksum("nope"), /sha256/);
});

test("applySelectedRelease installs the archive and keeps the database", async () => {
  const root = tempDir();
  const packed = tempDir();
  const tree = join(packed, "ordo-server");
  write(join(tree, "apps/server/src/main.js"), "from-release\n");
  write(join(tree, "apps/server/prisma/schema.prisma"), "model Shipped\n");
  write(join(root, "apps/server/prisma/ordo.db"), "live\n");
  write(join(root, "apps/server/.env"), "PORT=3000\n");
  const archive = join(packed, "ordo-server-v0.1.0.tar.gz");
  const tar = spawnSync("tar", ["-czf", archive, "-C", packed, "ordo-server"]);
  assert.equal(tar.status, 0, tar.stderr?.toString());
  const bytes = readFileSync(archive);
  const hash = createHash("sha256").update(bytes).digest("hex");
  const published = release("v0.1.0", {
    assets: [
      { name: "ordo-server-v0.1.0.tar.gz", browser_download_url: "https://example.test/server.tar.gz" },
      { name: "ordo-server-v0.1.0.tar.gz.sha256", browser_download_url: "https://example.test/server.sha256" },
    ],
  });

  async function fetchImpl(url) {
    if (url.endsWith(".sha256")) {
      const body = Buffer.from(`${hash}  ordo-server-v0.1.0.tar.gz\n`);
      return { ok: true, status: 200, body: Readable.toWeb(Readable.from(body)), text: async () => body.toString() };
    }
    if (url.endsWith(".tar.gz")) {
      return { ok: true, status: 200, body: Readable.toWeb(createReadStream(archive)) };
    }
    return { ok: false, status: 404, text: async () => "missing", json: async () => ({}) };
  }

  const applied = await applySelectedRelease({
    repoRoot: root,
    release: published,
    repo: "axoletlabs/ordo",
    fetchImpl,
    log: () => {},
  });
  assert.equal(applied.mode, "asset");
  assert.equal(applied.tag, "v0.1.0");
  assert.equal(readFileSync(join(root, "apps/server/src/main.js"), "utf8"), "from-release\n");
  assert.equal(readFileSync(join(root, "apps/server/prisma/ordo.db"), "utf8"), "live\n");
  assert.equal(readFileSync(join(root, "apps/server/.env"), "utf8"), "PORT=3000\n");
  const installed = readInstalledRelease(root);
  assert.equal(installed.tag, "v0.1.0");
  assert.equal(installed.version, "0.1.0");
  assert.equal(installed.asset, "ordo-server-v0.1.0.tar.gz");
});

test("a checksum mismatch does not change the install", async () => {
  const root = tempDir();
  write(join(root, "apps/server/src/main.js"), "original\n");
  const packed = tempDir();
  write(join(packed, "ordo-server/apps/server/src/main.js"), "replaced\n");
  const archive = join(packed, "ordo-server-v0.1.0.tar.gz");
  assert.equal(spawnSync("tar", ["-czf", archive, "-C", packed, "ordo-server"]).status, 0);
  const published = release("v0.1.0", {
    assets: [
      { name: "ordo-server-v0.1.0.tar.gz", browser_download_url: "https://example.test/server.tar.gz" },
      { name: "ordo-server-v0.1.0.tar.gz.sha256", browser_download_url: "https://example.test/server.sha256" },
    ],
  });
  async function fetchImpl(url) {
    if (url.endsWith(".sha256")) {
      const body = Buffer.from(`${"ab".repeat(32)}  ordo-server-v0.1.0.tar.gz\n`);
      return { ok: true, status: 200, body: Readable.toWeb(Readable.from(body)) };
    }
    return { ok: true, status: 200, body: Readable.toWeb(createReadStream(archive)) };
  }
  await assert.rejects(
    () => applySelectedRelease({ repoRoot: root, release: published, fetchImpl, log: () => {} }),
    /Checksum mismatch/,
  );
  assert.equal(readFileSync(join(root, "apps/server/src/main.js"), "utf8"), "original\n");
});

test("without a server archive, checkout the release tag and keep ignored data", async () => {
  const bare = join(tempDir(), "origin.git");
  const seed = tempDir();
  git(seed, ["init", "-b", "main", "--bare", bare]);
  git(seed, ["init", "-b", "main"]);
  write(join(seed, "apps/server/src/main.js"), "v1\n");
  git(seed, ["add", "."]);
  git(seed, ["commit", "-m", "v1"]);
  git(seed, ["tag", "v0.1.0"]);
  git(seed, ["remote", "add", "origin", bare]);
  git(seed, ["push", "origin", "main"]);
  git(seed, ["push", "origin", "v0.1.0"]);
  write(join(seed, "apps/server/src/main.js"), "v2\n");
  git(seed, ["commit", "-am", "v2"]);
  git(seed, ["push", "origin", "main"]);

  const parent = tempDir();
  const install = join(parent, "install");
  git(parent, ["clone", bare, "install"]);
  write(join(install, "apps/server/prisma/ordo.db"), "live\n");
  const lines = [];
  const applied = await applySelectedRelease({
    repoRoot: install,
    release: release("v0.1.0"),
    remote: bare,
    log: (line) => lines.push(line),
  });
  assert.equal(applied.mode, "git-tag");
  assert.equal(readFileSync(join(install, "apps/server/src/main.js"), "utf8"), "v1\n");
  assert.equal(readFileSync(join(install, "apps/server/prisma/ordo.db"), "utf8"), "live\n");
  assert.equal(git(install, ["rev-parse", "HEAD"]), applied.commit);
  assert.equal(readInstalledRelease(install).tag, "v0.1.0");
  assert.match(lines.join("\n"), /checkout --detach v0\.1\.0/);
});
