#!/usr/bin/env node
/**
 * Pick a GitHub Release and install that tree.
 *
 * The deploy script uses this so a server update tracks a published release
 * (tag + ordo-server archive) instead of whatever branch happens to be checked out.
 */
"use strict";

const { spawnSync } = require("node:child_process");
const { createHash } = require("node:crypto");
const {
  copyFileSync,
  createWriteStream,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} = require("node:fs");
const { tmpdir } = require("node:os");
const { dirname, join } = require("node:path");
const { Readable } = require("node:stream");
const { pipeline } = require("node:stream/promises");

const DEFAULT_REPO = "axoletlabs/ordo";
const TAG_RE = /^v\d+\.\d+\.\d+(?:-(?:alpha|beta|rc)(?:\.\d+)?)?$/;

function normalizeRepo(raw) {
  const repo = String(raw ?? DEFAULT_REPO).trim();
  if (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(repo)) {
    throw new Error(`--repo expects owner/name, got ${JSON.stringify(raw)}`);
  }
  return repo;
}

function normalizeReleaseSpec(raw, { pre = false } = {}) {
  const text = String(raw ?? "").trim();
  if (!text || text.toLowerCase() === "latest") return { kind: "latest", pre: Boolean(pre) };
  if (text.toLowerCase() === "latest-pre") return { kind: "latest", pre: true };
  const tag = text.startsWith("v") ? text : `v${text}`;
  if (!TAG_RE.test(tag)) {
    throw new Error(
      `--release expects latest or vX.Y.Z (optional -alpha, -beta, or -rc), got ${JSON.stringify(raw)}`,
    );
  }
  return { kind: "tag", tag, pre: Boolean(pre) };
}

function byNewest(releases) {
  return [...releases].sort((a, b) => {
    const at = Date.parse(a.published_at ?? a.created_at ?? 0);
    const bt = Date.parse(b.published_at ?? b.created_at ?? 0);
    return bt - at;
  });
}

function visibleReleases(releases, { pre = false } = {}) {
  const list = (releases ?? []).filter((release) => release && !release.draft);
  const newest = byNewest(list);
  if (pre) return newest;
  return newest.filter((release) => !release.prerelease);
}

function selectRelease(releases, spec) {
  if (spec.kind === "tag") {
    const found = (releases ?? []).find((release) => release.tag_name === spec.tag && !release.draft);
    if (!found) throw new Error(`Release ${spec.tag} was not found.`);
    return found;
  }
  const pool = visibleReleases(releases, { pre: spec.pre });
  if (pool.length === 0) {
    throw new Error(
      spec.pre
        ? "No GitHub releases were found. Publish a vX.Y.Z release, or pass --from-git to update the current branch."
        : "No stable GitHub releases were found. Pass --pre to include pre-releases, or --from-git to update the current branch.",
    );
  }
  return pool[0];
}

function serverAssetName(tag) {
  return `ordo-server-${String(tag).startsWith("v") ? tag : `v${tag}`}.tar.gz`;
}

function pickServerAsset(release) {
  const assets = release?.assets ?? [];
  const tarball = assets.find((asset) => /^ordo-server-v.+\.tar\.gz$/.test(asset?.name ?? ""));
  if (!tarball?.browser_download_url) return null;
  const checksum = assets.find((asset) => asset?.name === `${tarball.name}.sha256`) ?? null;
  return { tarball, checksum };
}

function formatReleaseMenu(releases, { installedTag, pre = false } = {}) {
  const shown = visibleReleases(releases, { pre });
  const hidden = (releases ?? []).filter((release) => release && !release.draft && release.prerelease).length;
  const lines = shown.map((release, index) => {
    const date = String(release.published_at ?? "").slice(0, 10);
    const channel = release.prerelease ? "pre-release" : "stable";
    const marks = [];
    if (index === 0) marks.push(pre ? "newest" : "latest");
    if (installedTag && release.tag_name === installedTag) marks.push("installed");
    const mark = marks.length ? `  ${marks.join(", ")}` : "";
    return `  ${String(index + 1).padStart(2)}) ${release.tag_name.padEnd(18)} ${channel.padEnd(12)} ${date}${mark}`;
  });
  if (!pre && hidden > 0) {
    lines.push(
      `  ${hidden} pre-release${hidden === 1 ? "" : "s"} hidden. Re-run with --pre to include them.`,
    );
  }
  return lines.join("\n");
}

function chooseListedRelease(releases, raw, { pre = false } = {}) {
  const text = String(raw ?? "").trim();
  if (!text || /^latest$/i.test(text)) return selectRelease(releases, { kind: "latest", pre });
  if (/^\d+$/.test(text)) {
    const shown = visibleReleases(releases, { pre });
    const hit = shown[Number(text) - 1];
    if (!hit) throw new Error(`There is no release numbered ${text}.`);
    return hit;
  }
  const spec = normalizeReleaseSpec(text, { pre: true });
  const found = (releases ?? []).find((release) => !release.draft && release.tag_name === spec.tag);
  if (!found) {
    const error = new Error(`Release ${spec.tag} is not in the recent list.`);
    error.fetchTag = spec.tag;
    throw error;
  }
  return found;
}

function releaseApplyMode(release, { hasGit, sourceArchive = false, requireAsset = false } = {}) {
  const asset = sourceArchive ? null : pickServerAsset(release);
  if (requireAsset && !asset) {
    throw new Error(
      `Release ${release.tag_name} has no ${serverAssetName(release.tag_name)}. ` +
        "Publish the release so CI can attach it, or pass --source-archive.",
    );
  }
  if (asset) return "asset";
  if (hasGit) return "git-tag";
  if (release.tarball_url) return "source";
  throw new Error(`Release ${release.tag_name} has no archive to install.`);
}

function planLines({ release, mode, installed }) {
  const lines = [];
  const from = installed?.tag && installed.tag !== release.tag_name ? `${installed.tag} → ` : "";
  const same = installed?.tag === release.tag_name ? " (reinstall)" : "";
  const channel = release.prerelease ? "pre-release" : "stable";
  lines.push(`Release: ${from}${release.tag_name}${same} (${channel}).`);
  if (mode === "asset") {
    lines.push(`Archive: ${pickServerAsset(release).tarball.name}`);
    lines.push("Will install that archive, not the tip of the current branch.");
  } else if (mode === "git-tag") {
    lines.push(
      `${release.tag_name} has no ordo-server archive. Will check out that tag, not the current branch.`,
    );
  } else if (mode === "source") {
    lines.push(
      `${release.tag_name} has no ordo-server archive. Will use the GitHub source archive for that tag.`,
    );
  }
  lines.push("Keeps apps/server/.env, secrets, SQLite, backups, and avatars.");
  return lines;
}

function readInstalledRelease(repoRoot) {
  const path = join(repoRoot, "apps", "server", "release.json");
  if (!existsSync(path)) return null;
  try {
    const parsed = JSON.parse(readFileSync(path, "utf8"));
    if (!parsed || typeof parsed.tag !== "string" || !parsed.tag) return null;
    return parsed;
  } catch {
    return null;
  }
}

function releaseManifest(release, { commit = null, asset = null } = {}) {
  return {
    version: String(release.tag_name).replace(/^v/, ""),
    tag: release.tag_name,
    commit,
    asset,
  };
}

function toRel(prefix, name) {
  const rel = prefix ? `${prefix}/${name}` : name;
  return rel.replaceAll("\\", "/");
}

function isLocalTree(rel) {
  const parts = String(rel).replaceAll("\\", "/").split("/");
  return parts.includes("node_modules") || parts.includes(".git") || parts.includes(".turbo");
}

/** User data that a release tree must never overwrite or delete. */
function isPreserved(rel) {
  const path = String(rel).replaceAll("\\", "/");
  if (path === "apps/server/.env" || path.startsWith("apps/server/.env.")) return true;
  if (path === "apps/server/.ordo-secret" || path === "apps/server/.ordo-library-key") return true;
  if (path === "apps/server/.ordo.pid" || path === "apps/server/ordo.log") return true;
  const prisma = "apps/server/prisma/";
  if (!path.startsWith(prisma)) return false;
  const rest = path.slice(prisma.length);
  if (rest === "schema.prisma") return false;
  if (rest === "migrations" || rest.startsWith("migrations/")) return false;
  return true;
}

function listFiles(root, prefix = "") {
  if (!existsSync(root)) return [];
  const out = [];
  for (const entry of readdirSync(root, { withFileTypes: true })) {
    const rel = toRel(prefix, entry.name);
    if (isLocalTree(rel)) continue;
    const abs = join(root, entry.name);
    if (entry.isDirectory()) out.push(...listFiles(abs, rel));
    else if (entry.isFile()) out.push(rel);
  }
  return out;
}

function syncReleaseTree(destRoot, archiveRoot, { tracked = [], dryRun = false, log } = {}) {
  const files = listFiles(archiveRoot);
  const have = new Set(files);
  let copied = 0;
  let kept = 0;
  for (const rel of files) {
    if (isPreserved(rel)) {
      kept += 1;
      continue;
    }
    const from = join(archiveRoot, rel);
    const to = join(destRoot, rel);
    if (!dryRun) {
      mkdirSync(dirname(to), { recursive: true });
      copyFileSync(from, to);
    }
    copied += 1;
  }
  const removed = [];
  for (const rel of tracked) {
    const path = String(rel).replaceAll("\\", "/");
    if (!path || have.has(path) || isPreserved(path) || isLocalTree(path)) continue;
    const abs = join(destRoot, path);
    if (!existsSync(abs)) continue;
    removed.push(path);
    if (!dryRun) rmSync(abs, { force: true });
  }
  log?.(`Applied ${copied} files from the release${removed.length ? `, removed ${removed.length} stale files` : ""}.`);
  return { copied, kept, removed };
}

function writeReleaseManifest(repoRoot, manifest, { dryRun = false, log } = {}) {
  const path = join(repoRoot, "apps", "server", "release.json");
  log?.(`Recording ${manifest.tag} in apps/server/release.json`);
  if (!dryRun) {
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, `${JSON.stringify(manifest, null, 2)}\n`, { encoding: "utf8" });
  }
  return path;
}

function githubToken(env = process.env) {
  const token = env.GITHUB_TOKEN || env.GH_TOKEN || "";
  return token.trim();
}

function githubHeaders(token, { download = false } = {}) {
  const headers = {
    "User-Agent": "ordo-deploy",
    Accept: download ? "application/octet-stream" : "application/vnd.github+json",
  };
  if (!download) headers["X-GitHub-Api-Version"] = "2022-11-28";
  if (token && !download) headers.Authorization = `Bearer ${token}`;
  return headers;
}

async function githubJson(url, { fetchImpl, token }) {
  let response;
  try {
    response = await fetchImpl(url, { headers: githubHeaders(token) });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`Could not reach GitHub (${message}).`);
  }
  if (response.status === 404) return null;
  if (response.status === 403 || response.status === 429) {
    throw new Error(
      `GitHub API ${response.status} for ${url}. Set GITHUB_TOKEN if you are being rate-limited.`,
    );
  }
  if (!response.ok) {
    const detail = typeof response.text === "function" ? await response.text().catch(() => "") : "";
    throw new Error(`GitHub API ${response.status} for ${url}${detail ? `: ${detail.slice(0, 180)}` : ""}`);
  }
  return response.json();
}

async function listReleases(repo, options) {
  const page = await githubJson(`https://api.github.com/repos/${repo}/releases?per_page=30`, options);
  return Array.isArray(page) ? page : [];
}

async function releaseByTag(repo, tag, options) {
  const release = await githubJson(
    `https://api.github.com/repos/${repo}/releases/tags/${encodeURIComponent(tag)}`,
    options,
  );
  if (!release || release.draft) throw new Error(`Release ${tag} was not found on ${repo}.`);
  return release;
}

async function latestStable(repo, options) {
  const release = await githubJson(`https://api.github.com/repos/${repo}/releases/latest`, options);
  if (!release || release.draft) {
    throw new Error(
      `No stable release was found on ${repo}. Publish a vX.Y.Z GitHub Release, pass --pre to include pre-releases, or pass --from-git to update the current branch.`,
    );
  }
  return release;
}

async function resolveReleaseChoice(spec, { repo, releases, fetchImpl, token }) {
  if (Array.isArray(releases)) return selectRelease(releases, spec);
  const options = { fetchImpl, token };
  if (spec.kind === "tag") return releaseByTag(repo, spec.tag, options);
  if (!spec.pre) return latestStable(repo, options);
  return selectRelease(await listReleases(repo, options), spec);
}

function parseChecksum(text) {
  const hash = String(text ?? "")
    .trim()
    .split(/\s+/)[0]
    ?.toLowerCase();
  if (!hash || !/^[a-f0-9]{64}$/.test(hash)) {
    throw new Error("The release checksum is not a sha256 hash.");
  }
  return hash;
}

function sha256File(path) {
  return createHash("sha256").update(readFileSync(path)).digest("hex");
}

function git(repoRoot, args, { inherit = false } = {}) {
  return spawnSync("git", args, {
    cwd: repoRoot,
    encoding: "utf8",
    stdio: inherit ? "inherit" : ["ignore", "pipe", "pipe"],
    env: { ...process.env, GIT_TERMINAL_PROMPT: "0" },
  });
}

function releaseRemote(repo, remote) {
  if (remote) return remote;
  return `https://github.com/${repo}.git`;
}

function fetchTagSha(repoRoot, remote, tag, log) {
  log?.(`$ git fetch ${remote} tag ${tag}`);
  const fetched = git(repoRoot, ["fetch", remote, `refs/tags/${tag}:refs/tags/${tag}`], { inherit: true });
  if (fetched.status !== 0) {
    throw new Error(
      `Could not fetch ${tag}. Check network access to the repository, or pass --no-release to build the copy already on disk.`,
    );
  }
  const parsed = git(repoRoot, ["rev-parse", `${tag}^{commit}`]);
  if (parsed.status !== 0) throw new Error(`Fetched ${tag} but could not resolve its commit.`);
  return String(parsed.stdout ?? "").trim();
}

function checkoutReleaseTag(repoRoot, remote, tag, log) {
  const sha = fetchTagSha(repoRoot, remote, tag, log);
  log?.(`$ git checkout --detach ${tag}`);
  const checkout = git(repoRoot, ["checkout", "--detach", tag], { inherit: true });
  if (checkout.status !== 0) {
    throw new Error(`Could not check out ${tag}. Commit or stash local changes, or pass --no-release.`);
  }
  return sha;
}

function resetGitToSha(repoRoot, sha, log) {
  log?.(`$ git reset --mixed ${sha}`);
  const reset = git(repoRoot, ["reset", "--mixed", sha], { inherit: true });
  if (reset.status !== 0) {
    throw new Error(`Installed the release files, but git reset to ${sha} failed.`);
  }
}

function trackedFiles(repoRoot) {
  const result = git(repoRoot, ["ls-files", "-z"]);
  if (result.status !== 0) return [];
  return String(result.stdout ?? "")
    .split("\0")
    .filter(Boolean);
}

function findTreeRoot(extractDir) {
  const entries = readdirSync(extractDir, { withFileTypes: true }).filter(
    (entry) => entry.name !== "." && entry.name !== ".." && entry.name !== "pax_global_header",
  );
  if (entries.length === 1 && entries[0].isDirectory()) return join(extractDir, entries[0].name);
  return extractDir;
}

function extractTarball(archivePath, destDir) {
  mkdirSync(destDir, { recursive: true });
  const result = spawnSync("tar", ["-xzf", archivePath, "-C", destDir], { stdio: "inherit" });
  if (result.status !== 0) throw new Error("Could not extract the release archive.");
}

async function downloadToFile(url, dest, { fetchImpl, token }) {
  let response;
  try {
    response = await fetchImpl(url, { headers: githubHeaders(token, { download: true }), redirect: "follow" });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`Could not download ${url} (${message}).`);
  }
  if (!response.ok) throw new Error(`Download failed (${response.status}) for ${url}`);
  if (!response.body) throw new Error(`Download returned an empty body for ${url}`);
  await pipeline(Readable.fromWeb(response.body), createWriteStream(dest));
}

async function remoteCommitSha(repo, tag, { fetchImpl, token }) {
  if (!fetchImpl) return null;
  try {
    const commit = await githubJson(
      `https://api.github.com/repos/${repo}/commits/${encodeURIComponent(tag)}`,
      { fetchImpl, token },
    );
    return typeof commit?.sha === "string" ? commit.sha : null;
  } catch {
    return null;
  }
}

async function applySelectedRelease({
  repoRoot,
  release,
  repo = DEFAULT_REPO,
  remote,
  fetchImpl,
  token = "",
  sourceArchive = false,
  requireAsset = false,
  dryRun = false,
  log = () => {},
} = {}) {
  const hasGit = existsSync(join(repoRoot, ".git"));
  const mode = releaseApplyMode(release, { hasGit, sourceArchive, requireAsset });
  const asset = mode === "asset" ? pickServerAsset(release) : null;
  const gitRemote = releaseRemote(repo, remote);
  if (dryRun) {
    return { mode, tag: release.tag_name, asset: asset?.tarball?.name ?? null, dryRun: true };
  }

  if (mode === "git-tag") {
    const sha = checkoutReleaseTag(repoRoot, gitRemote, release.tag_name, log);
    writeReleaseManifest(repoRoot, releaseManifest(release, { commit: sha, asset: null }), { log });
    return { mode, tag: release.tag_name, asset: null, commit: sha };
  }

  const url = asset ? asset.tarball.browser_download_url : release.tarball_url;
  if (!url) throw new Error(`Release ${release.tag_name} has no archive to install.`);
  const tmp = mkdtempSync(join(tmpdir(), "ordo-release-"));
  try {
    let commit = null;
    if (hasGit) commit = fetchTagSha(repoRoot, gitRemote, release.tag_name, log);
    const archivePath = join(tmp, asset?.tarball?.name ?? "source.tar.gz");
    log(`Downloading ${release.tag_name}${asset ? ` (${asset.tarball.name})` : ""}`);
    await downloadToFile(url, archivePath, { fetchImpl, token });
    if (asset?.checksum?.browser_download_url) {
      const sumPath = join(tmp, asset.checksum.name);
      await downloadToFile(asset.checksum.browser_download_url, sumPath, { fetchImpl, token });
      const expected = parseChecksum(readFileSync(sumPath, "utf8"));
      const actual = sha256File(archivePath);
      if (actual !== expected) {
        throw new Error(
          `Checksum mismatch for ${asset.tarball.name}. Expected ${expected}, got ${actual}. The release was not installed.`,
        );
      }
      log("Checksum matches.");
    } else if (asset) {
      log("This server archive has no checksum file. Continuing without verifying it.");
    }
    const extractDir = join(tmp, "extract");
    extractTarball(archivePath, extractDir);
    const tree = findTreeRoot(extractDir);
    const tracked = hasGit ? trackedFiles(repoRoot) : [];
    syncReleaseTree(repoRoot, tree, { tracked, log });
    if (!commit) commit = await remoteCommitSha(repo, release.tag_name, { fetchImpl, token });
    if (hasGit && commit) resetGitToSha(repoRoot, commit, log);
    const assetName = asset?.tarball?.name ?? null;
    writeReleaseManifest(repoRoot, releaseManifest(release, { commit, asset: assetName }), { log });
    return { mode, tag: release.tag_name, asset: assetName, commit };
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
}

module.exports = {
  DEFAULT_REPO,
  normalizeRepo,
  normalizeReleaseSpec,
  visibleReleases,
  selectRelease,
  serverAssetName,
  pickServerAsset,
  formatReleaseMenu,
  chooseListedRelease,
  releaseApplyMode,
  planLines,
  readInstalledRelease,
  releaseManifest,
  isPreserved,
  listFiles,
  syncReleaseTree,
  writeReleaseManifest,
  githubToken,
  listReleases,
  releaseByTag,
  latestStable,
  resolveReleaseChoice,
  parseChecksum,
  sha256File,
  fetchTagSha,
  checkoutReleaseTag,
  applySelectedRelease,
};
