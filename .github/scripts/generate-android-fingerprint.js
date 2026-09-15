#!/usr/bin/env node
/**
 * Thin wrapper around @expo/fingerprint.
 *
 * The package CLI never calls process.exit() after printing JSON. When a
 * native module is added, autolinking / ExpoConfigLoader children can keep
 * the event loop alive and freeze GitHub's detect job. This script writes
 * the same JSON and then exits.
 */
"use strict";

const platformIdx = process.argv.indexOf("--platform");
const platform = platformIdx >= 0 ? process.argv[platformIdx + 1] : "android";
if (!["ios", "android"].includes(platform)) {
  console.error(`Invalid platform: ${platform}`);
  process.exit(1);
}

const projectRoot = process.cwd();
const { createFingerprintAsync } = require(
  require.resolve("@expo/fingerprint", { paths: [projectRoot] }),
);
const { fileHookTransform } = require("./masked-view-fingerprint-hook.js");

createFingerprintAsync(projectRoot, {
  silent: true,
  platforms: [platform],
  // Same hook as fingerprint.config.js so an old APK worktree (no config
  // yet) still hashes the Gradle-mutated masked-view manifest.
  fileHookTransform,
})
  .then((result) => {
    process.stdout.write(`${JSON.stringify(result)}\n`);
    process.exit(0);
  })
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
