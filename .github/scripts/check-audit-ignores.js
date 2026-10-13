#!/usr/bin/env node
"use strict";
/**
 * Fail when an ignored advisory no longer deserves ignoring: a patched
 * release is now published, or the ignore's expiry date has passed.
 * Ignores that can never expire quietly rot; this runs daily in CI.
 */
const { spawnSync } = require("node:child_process");
const { readFileSync } = require("node:fs");
const { join } = resolveRoot();

function resolveRoot() {
  const path = require("node:path");
  const root = path.resolve(__dirname, "..", "..");
  return { join: path.join, root };
}

function parseIgnores(yaml) {
  const ignores = [];
  let inBlock = false;
  let comment = [];
  for (const line of yaml.split("\n")) {
    if (/^\S/.test(line)) inBlock = false;
    const trimmed = line.trim();
    if (trimmed.startsWith("#")) {
      comment.push(trimmed.replace(/^#\s?/, ""));
      continue;
    }
    const id = trimmed.match(/^-\s*(GHSA-[a-z0-9-]+)$/);
    if (inBlock && id) {
      ignores.push({ id: id[1], comment: comment.join("\n") });
      comment = [];
      continue;
    }
    if (/^ignoreGhsas:\s*$/.test(trimmed)) inBlock = true;
    if (trimmed && !trimmed.startsWith("#")) comment = [];
  }
  return ignores;
}

function fetchAdvisory(id) {
  const result = spawnSync("gh", ["api", `advisories/${id}`], { encoding: "utf8" });
  if (result.status === 0) return JSON.parse(result.stdout || "null");
  const err = `${result.stderr ?? ""}${result.stdout ?? ""}`;
  if (/Not Found|\b404\b/.test(err)) return null;
  // Fail closed: a rate limit or auth failure must not look like "no patches".
  throw new Error(`gh api advisories/${id} failed: ${err.trim().split("\n").pop() ?? result.status}`);
}

function advisoryPatches(id, { advisory } = {}) {
  const payload = advisory ?? fetchAdvisory(id);
  if (!payload) return [];
  return (payload.vulnerabilities ?? [])
    .filter((entry) => entry.first_patched_version)
    .map((entry) => ({ package: entry.package?.name, version: entry.first_patched_version }));
}

function publishedOnNpm(name, version) {
  const result = spawnSync("npm", ["view", `${name}@${version}`, "version"], { encoding: "utf8" });
  if (result.status === 0) return result.stdout.trim() === version;
  const err = `${result.stderr ?? ""}${result.stdout ?? ""}`;
  if (/E404|No match found|not in the registry/i.test(err)) return false;
  // Fail closed: an unreachable registry must not look like "not published".
  throw new Error(`npm view ${name}@${version} failed: ${err.trim().split("\n").pop() ?? result.status}`);
}

function check(ignores, today, deps) {
  const failures = [];
  for (const { id, comment } of ignores) {
    const expiry = comment.match(/expires:\s*(\d{4}-\d{2}-\d{2})/);
    if (!expiry) {
      failures.push(`${id}: every ignore needs an "expires: YYYY-MM-DD" line in its comment.`);
      continue;
    }
    if (today > expiry[1]) {
      failures.push(`${id}: ignore expired on ${expiry[1]}. Renew it with a fresh expiry and rationale, or remove it.`);
    }
    for (const patch of advisoryPatches(id, deps)) {
      if (deps ? deps.isPublished(patch.package, patch.version) : publishedOnNpm(patch.package, patch.version)) {
        failures.push(`${id}: ${patch.package}@${patch.version} is published. Remove the ignore and take the update.`);
      }
    }
  }
  return failures;
}

function main() {
  try {
    const yaml = readFileSync(join(__dirname, "..", "..", "pnpm-workspace.yaml"), "utf8");
    const ignores = parseIgnores(yaml);
    if (ignores.length === 0) {
      console.log("No ignored advisories.");
      return 0;
    }
    const today = new Date().toISOString().slice(0, 10);
    const failures = check(ignores, today);
    for (const { id, comment } of ignores) {
      console.log(`${id}: ${comment.split("\n").find((line) => line.includes("expires:")) ?? "no expiry"}`);
    }
    if (failures.length > 0) {
      for (const failure of failures) console.error(`::error::${failure}`);
      return 1;
    }
    console.log(`All ${ignores.length} ignored advisory/advisories are current.`);
    return 0;
  } catch (err) {
    console.error(`::error::audit-ignore check could not run: ${err.message}`);
    return 1;
  }
}

module.exports = { parseIgnores, check, advisoryPatches, publishedOnNpm };

if (require.main === module) process.exit(main());
