const assert = require("node:assert/strict");
const { test } = require("node:test");
const { readFileSync } = require("node:fs");
const { resolve } = require("node:path");
const vm = require("node:vm");
const { APP_VARIANTS } = require("./release-policy.js");
const root = resolve(__dirname, "..");

function config({ variant, version = "0.1.0", branch = "main", channel } = {}) {
  const source = readFileSync(resolve(root, "apps/mobile/app.config.js"), "utf8")
    .replace(/const version = "[^"]+"/, `const version = "${version}"`);
  const module = { exports: {} };
  vm.runInNewContext(source, { module, require: (name) => name === "node:child_process"
    ? { execSync: () => Buffer.from("") } : require(resolve(root, "scripts/release-policy.js")),
    process: { env: { ORDO_BUILD_BRANCH: branch, ...(variant ? { ORDO_APP_VARIANT: variant } : {}),
      ...(channel ? { EXPO_UPDATES_CHANNEL: channel } : {}) } } });
  return module.exports;
}

test("Expo config fixes native identities, schemes and OTA enablement for exactly three variants", () => {
  for (const variant of Object.keys(APP_VARIANTS)) {
    const version = variant === "preview" ? "0.2.0-preview.1" : "0.2.0";
    const actual = config({ variant, version });
    const identity = APP_VARIANTS[variant];
    assert.equal(actual.name, identity.name);
    assert.equal(actual.android.package, identity.package);
    assert.equal(actual.ios.bundleIdentifier, identity.package);
    assert.equal(actual.scheme, identity.package);
    assert.equal(actual.updates.enabled, variant !== "development");
    assert.equal(actual.updates.requestHeaders?.["expo-channel-name"] ?? null, identity.channel);
    assert.equal(actual.android.softwareKeyboardLayoutMode, "resize");
    assert.equal(actual.backgroundColor, "#F4FBF8");
    const splash = actual.plugins.find((plugin) => Array.isArray(plugin) && plugin[0] === "expo-splash-screen")[1];
    assert.equal(splash.backgroundColor, "#F4FBF8");
    assert.equal(splash.dark.backgroundColor, "#0E1513");
  }
});

test("local builds infer Development except for matching release branches", () => {
  assert.equal(config().android.package, APP_VARIANTS.development.package);
  assert.equal(config({ branch: "feature/foo" }).android.package, APP_VARIANTS.development.package);
  assert.equal(config({ branch: "release/0.1.0" }).android.package, APP_VARIANTS.stable.package);
  assert.equal(config({ branch: "release/0.2.0", version: "0.2.0-preview.1" }).android.package, APP_VARIANTS.preview.package);
  assert.throws(() => config({ branch: "release/0.2.0" }), /Invalid app variant/);
});

test("config fails closed on unknown variants, wrong suffixes and cross-stream headers", () => {
  assert.throws(() => config({ variant: "production" }), /Invalid app variant/);
  assert.throws(() => config({ variant: "preview" }), /cannot build/);
  assert.throws(() => config({ variant: "stable", version: "0.1.0-preview.1" }), /cannot build/);
  assert.throws(() => config({ variant: "stable", channel: "preview" }), /must match/);
  assert.throws(() => config({ variant: "development", channel: "stable" }), /must match/);
});

test("EAS has exactly three fixed build profiles", () => {
  const profiles = JSON.parse(readFileSync(resolve(root, "apps/mobile/eas.json"), "utf8")).build;
  assert.deepEqual(Object.keys(profiles).sort(), Object.keys(APP_VARIANTS).sort());
  for (const [variant, profile] of Object.entries(profiles)) {
    assert.equal(profile.env.ORDO_APP_VARIANT, variant);
    assert.equal(profile.channel ?? null, APP_VARIANTS[variant].channel);
  }
});

test("manifest plugin removes Development headers and preserves release signing headers", () => {
  const module = { exports: {} };
  const source = readFileSync(resolve(root, "apps/mobile/plugins/with-updates-channel.js"), "utf8");
  vm.runInNewContext(source, { module, require: () => ({ withAndroidManifest: (value, callback) => callback(value) }) });
  const key = "expo.modules.updates.UPDATES_CONFIGURATION_REQUEST_HEADERS_KEY";
  for (const variant of Object.keys(APP_VARIANTS)) {
    const identity = APP_VARIANTS[variant];
    const actual = module.exports({ updates: { enabled: variant !== "development",
      requestHeaders: identity.channel ? { "expo-channel-name": identity.channel } : {} },
      modResults: { manifest: { application: [{ "meta-data": [
        { $: { "android:name": key, "android:value": JSON.stringify({ "expo-channel-name": "old", "expo-expect-signature": "keyid=test" }) } },
        { $: { "android:name": "other", "android:value": "keep" } },
      ] }] } } });
    const metadata = actual.modResults.manifest.application[0]["meta-data"];
    const headers = metadata.find((item) => item.$["android:name"] === key);
    assert.ok(metadata.some((item) => item.$["android:name"] === "other"));
    if (variant === "development") assert.equal(headers, undefined);
    else assert.deepEqual(JSON.parse(headers.$["android:value"]), {
      "expo-channel-name": variant, "expo-expect-signature": "keyid=test",
    });
  }
});
