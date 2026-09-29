#!/usr/bin/env node
"use strict";
// Run on the builder, in an isolated checkout: generates android/ and bundles
// Android JS. It never publishes an OTA or uploads a release.
const assert = require("node:assert/strict");
const { spawnSync } = require("node:child_process");
const { readFileSync, writeFileSync, rmSync } = require("node:fs");
const { resolve } = require("node:path");
const { AndroidConfig } = require("expo/config-plugins");
const root = resolve(__dirname, "..");
const mobile = resolve(root, "apps/mobile");

function run(command, args, env, json = false) {
  const result = spawnSync(command, args, { cwd: mobile, encoding: "utf8", maxBuffer: 20 * 1024 * 1024,
    timeout: 240_000,
    env: { ...process.env, CI: "1", ...env } });
  assert.equal(result.status, 0, `${command} ${args.join(" ")}\n${result.stderr}\n${result.stdout}`);
  return json ? JSON.parse(result.stdout) : result.stdout;
}
function fingerprint(env) {
  return run("node", [resolve(root, ".github/scripts/generate-android-fingerprint.js"), "--platform", "android"], env, true);
}

async function main() {
  const channels = ["development", "production", "early-access", "development-t3code-2Fmaterial-2Dthree-2Dredesign"];
  const hashes = [];
  for (const channel of channels) {
    const env = { EXPO_UPDATES_CHANNEL: channel, ORDO_BUILD_BRANCH: "main" };
    run("node", [resolve(root, "node_modules/expo/bin/cli"), "prebuild", "--clean", "--platform", "android", "--no-install"], env);
    const manifest = await AndroidConfig.Manifest.readAndroidManifestAsync(resolve(mobile, "android/app/src/main/AndroidManifest.xml"));
    const metadata = manifest.manifest.application[0]["meta-data"];
    const headers = metadata.find((item) => item.$["android:name"] === "expo.modules.updates.UPDATES_CONFIGURATION_REQUEST_HEADERS_KEY");
    assert.equal(JSON.parse(headers.$["android:value"])["expo-channel-name"], channel);
    assert.ok(metadata.some((item) => item.$["android:name"] === "expo.modules.updates.ENABLED" && item.$["android:value"] === "true"));
    const fp = fingerprint(env);
    assert.match(fp.hash, /^[a-f0-9]{40}$/);
    assert.equal(fingerprint(env).hash, fp.hash, "fingerprint must be deterministic");
    hashes.push(fp.hash);
    const config = run("node", [resolve(root, "node_modules/expo/bin/cli"), "config", "--type", "public", "--json"], {
      ...env, ORDO_OTA_RUNTIME_VERSION: fp.hash,
    }, true);
    assert.equal(config.runtimeVersion, fp.hash, "OTA runtime pin must survive Expo config resolution");
    assert.equal(config.updates.requestHeaders["expo-channel-name"], channel);
    console.log(`Verified native channel ${channel}, runtime ${fp.hash}`);
  }
  assert.equal(new Set(hashes).size, channels.length, "channel changes must mint an isolated native runtime");
  const env = { EXPO_UPDATES_CHANNEL: channels[3], ORDO_BUILD_BRANCH: "main" };
  const baseline = fingerprint(env).hash;
  const packagePath = resolve(mobile, "package.json");
  const original = readFileSync(packagePath, "utf8");
  const jsPath = resolve(mobile, "src/lib/__release-runtime-smoke__.ts");
  try {
    const pkg = JSON.parse(original);
    pkg.scripts["audit-only"] = "node --test new-test.ts";
    writeFileSync(packagePath, JSON.stringify(pkg, null, 2) + "\n");
    writeFileSync(jsPath, "export const auditOnly = 1;\n");
    assert.equal(fingerprint(env).hash, baseline, "JS and test-script edits must stay OTA-compatible");
  } finally {
    writeFileSync(packagePath, original);
    rmSync(jsPath, { force: true });
  }
  const pluginPath = resolve(mobile, "plugins/with-updates-channel.js");
  const plugin = readFileSync(pluginPath, "utf8");
  try {
    writeFileSync(pluginPath, plugin + "\n// native plugin audit mutation\n");
    assert.notEqual(fingerprint(env).hash, baseline, "native plugin edits must require an APK");
  } finally { writeFileSync(pluginPath, plugin); }
  const bytecodeArgs = process.argv.includes("--no-bytecode") ? ["--no-bytecode"] : [];
  run("node", [resolve(root, "node_modules/expo/bin/cli"), "export", "--platform", "android", "--output-dir", ".expo/release-audit-export", ...bytecodeArgs], env);
  console.log(`Verified Android ${bytecodeArgs.length ? "JS" : "Hermes"} export, shared release policy bundling, JS/native fingerprint routing, and all four channel manifests.`);
}
main().catch((error) => { console.error(error); process.exitCode = 1; });
