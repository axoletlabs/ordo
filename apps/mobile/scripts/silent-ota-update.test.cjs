/** Run: node --test apps/mobile/scripts/silent-ota-update.test.cjs */
const assert = require("node:assert/strict");
const { readFileSync, readdirSync, existsSync } = require("node:fs");
const { resolve } = require("node:path");
const { test } = require("node:test");
const ts = require("typescript");
const React = require("react");
const { renderToStaticMarkup } = require("react-dom/server");

function load(path, requireModule = require) {
  const { outputText } = ts.transpileModule(readFileSync(resolve(__dirname, "../src", path), "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.React, esModuleInterop: true },
  });
  const module = { exports: {} };
  new Function("require", "module", "exports", outputText)(requireModule, module, module.exports);
  return module.exports;
}
const { createAutomaticOtaUpdater } = load("lib/automatic-ota-update.ts");
const flush = async () => { for (let i = 0; i < 20; i++) await Promise.resolve(); };
const deferred = () => {
  let resolve, reject;
  const promise = new Promise((a, b) => { resolve = a; reject = b; });
  return { promise, resolve, reject };
};
function setup(overrides = {}) {
  const calls = [];
  const updater = createAutomaticOtaUpdater({
    enabled: true,
    check: async () => { calls.push("check"); return true; },
    download: async () => { calls.push("download"); return true; },
    ...overrides,
  });
  return { updater, calls };
}

test("launch checks and downloads without any reload or UI API", async () => {
  const { updater, calls } = setup();
  updater.start();
  await flush();
  assert.deepEqual(calls, ["check", "download"]);
  assert.deepEqual(Object.keys(updater), ["start", "refresh"]);
});

test("disabled builds never check or download", async () => {
  const { updater, calls } = setup({ enabled: false });
  updater.start();
  updater.refresh();
  await flush();
  assert.deepEqual(calls, []);
});

test("up-to-date launch never downloads", async () => {
  const { updater, calls } = setup({ check: async () => false });
  updater.start();
  await flush();
  assert.deepEqual(calls, []);
});

test("Strict Mode and remounts share the complete check/download chain", async () => {
  const download = deferred();
  const { updater, calls } = setup({ download: async () => { calls.push("download"); await download.promise; return true; } });
  updater.start();
  updater.start();
  updater.refresh();
  await flush();
  updater.refresh();
  await flush();
  assert.deepEqual(calls, ["check", "download"]);
  download.resolve();
  await flush();
  assert.deepEqual(calls, ["check", "download"]);
});

test("a hanging network request has no launch gate, timers, or progress subscribers", async () => {
  const check = deferred();
  const { updater, calls } = setup({ check: () => check.promise });
  assert.equal(updater.start(), undefined);
  assert.equal(updater.refresh(), undefined);
  assert.equal(updater.getSnapshot, undefined);
  assert.equal(updater.subscribe, undefined);
  await flush();
  assert.deepEqual(calls, []);
  check.resolve(true);
  await flush();
  assert.deepEqual(calls, ["download"]);
});

for (const action of ["check", "download"]) {
  test(`${action} errors stay silent and retry after one minute`, async (t) => {
    t.mock.timers.enable({ apis: ["Date"] });
    let attempts = 0;
    const { updater } = setup({ [action]: async () => { attempts++; throw new Error("Offline"); } });
    updater.start();
    await flush();
    updater.refresh();
    await flush();
    assert.equal(attempts, 1);
    t.mock.timers.tick(60_000);
    updater.refresh();
    await flush();
    assert.equal(attempts, 2);
  });
}

test("foreground and connectivity events are throttled for an hour", async (t) => {
  t.mock.timers.enable({ apis: ["Date"] });
  const { updater, calls } = setup();
  updater.start();
  await flush();
  updater.refresh();
  await flush();
  assert.deepEqual(calls, ["check", "download"]);
  t.mock.timers.tick(60 * 60 * 1000);
  updater.refresh();
  await flush();
  assert.deepEqual(calls, ["check", "download", "check", "download"]);
});

test("rollback directives download silently even when isNew/isAvailable are false", async () => {
  const { singleFlight } = load("lib/single-flight.ts");
  const actions = load("lib/ota-update-actions.ts", (name) => {
    if (name === "./single-flight") return { singleFlight };
    if (name === "./app-variant") return { APP_VARIANT: "stable", APP_IDENTITY: { channel: "production" } };
    if (name === "expo-updates") return {
      isEnabled: true, channel: "production",
      checkForUpdateAsync: async () => ({ isAvailable: false, isRollBackToEmbedded: true }),
      fetchUpdateAsync: async () => ({ isNew: false, isRollBackToEmbedded: true }),
    };
    throw new Error(name);
  });
  assert.equal(actions.otaUpdatesEnabled, true);
  assert.equal(await actions.checkOta(), true);
  assert.equal(await actions.downloadOta(), true);
});

test("development, disabled updates and mismatched channels stay disabled", () => {
  const { singleFlight } = load("lib/single-flight.ts");
  for (const [variant, enabled, channel] of [["development", true, "production"], ["stable", false, "production"], ["stable", true, "preview"], ["stable", true, null]]) {
    const actions = load("lib/ota-update-actions.ts", (name) => {
      if (name === "./single-flight") return { singleFlight };
      if (name === "./app-variant") return { APP_VARIANT: variant, APP_IDENTITY: { channel: "production" } };
      if (name === "expo-updates") return { isEnabled: enabled, channel };
      throw new Error(name);
    });
    assert.equal(actions.otaUpdatesEnabled, false);
  }
});

function nativeUpdate(native) {
  const { resolveAppUpdateAction } = load("lib/app-update-action.ts");
  const { useAppUpdate } = load("hooks/use-app-update.ts", (name) => {
    if (name === "react") return { useCallback: (fn) => fn, useEffect: () => {} };
    if (name === "react-native") return {};
    if (name === "../store/native-update") return { useNativeUpdateStore: () => native };
    if (name === "../lib/app-update-action") return { resolveAppUpdateAction };
    throw new Error(`User-facing update flow must not read OTA: ${name}`);
  });
  return useAppUpdate();
}

test("user-facing Check queries only full app releases, never OTA", async () => {
  const calls = [];
  const update = nativeUpdate({ status: "idle", check: async (force) => { calls.push(force); return null; } });
  assert.equal(await update.check(), false);
  assert.deepEqual(calls, [true]);
  assert.equal(update.checking, false);
  assert.equal(update.downloading, false);
  assert.deepEqual(update.phases, []);
});

test("full app release download/install actions remain available", () => {
  const release = { version: "1.0.0", publishedAt: "2026-10-18" };
  for (const [status, downloadedUri, action] of [["available", null, "download"], ["downloaded", "file:///update.apk", "install"]]) {
    const update = nativeUpdate({ status, release, downloadedUri });
    assert.deepEqual(update.phases, [{ kind: "native", action }]);
  }
});

test("About renders no OTA status, progress, error, or restart control", () => {
  const update = nativeUpdate({ status: "idle" });
  const { OtaUpdateCard } = load("components/ui/OtaUpdater.tsx", (name) => {
    if (name === "react") return React;
    if (name === "react-native") return { StyleSheet: { create: (styles) => styles } };
    if (name === "./Button") return { Button: ({ label }) => React.createElement("button", null, label) };
    if (name === "./SettingRow") return { SettingRow: ({ label, right }) => React.createElement("section", null, label, right) };
    if (name === "./toast-store") return {};
    if (name === "../../hooks/use-app-update") return { useAppUpdate: () => update };
    if (name === "../../store/update-restart") return { useUpdateRestartStore: () => false };
    throw new Error(`About must not render OTA components: ${name}`);
  });
  assert.equal(renderToStaticMarkup(React.createElement(OtaUpdateCard)), "<section>App updates<button>Check</button></section>");
});

test("silent OTA cannot import reload, splash, toast, haptic, or progress UI", () => {
  for (const file of ["lib/automatic-ota-update.ts", "hooks/use-automatic-ota-update.ts"]) {
    const source = readFileSync(resolve(__dirname, "../src", file), "utf8");
    assert.doesNotMatch(source, /reloadAsync|restartForUpdate|restartRuntime|SplashScreen|LaunchSplash|toast|haptics|LinearProgress/);
  }
  const root = readFileSync(resolve(__dirname, "../app/_layout.tsx"), "utf8");
  assert.match(root, /useAutomaticOtaUpdate\(\);/);
  assert.doesNotMatch(root, /otaLaunch|OtaLaunchProgress/);
});

function walkSources(dir) {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = resolve(dir, entry.name);
    return entry.isDirectory() ? walkSources(path) : /\.(ts|tsx)$/.test(entry.name) ? [path] : [];
  });
}

test("the removed combined checker and per-update restart action stay removed", () => {
  // Silent OTA applies on the next cold launch; a restart-for-update action or
  // an OTA+native combined check path must not quietly come back.
  assert.equal(existsSync(resolve(__dirname, "../src/lib/app-update-check.ts")), false);
  for (const path of walkSources(resolve(__dirname, "../src"))) {
    const source = readFileSync(path, "utf8");
    assert.doesNotMatch(source, /checkAppUpdateSources|app-update-check|restartForUpdate/, path);
  }
  const restart = readFileSync(resolve(__dirname, "../src/store/update-restart.ts"), "utf8");
  // Runtime reload survives for server switches and error recovery only.
  assert.match(restart, /export (async )?function restartRuntime/);
  assert.match(restart, /export (async )?function reloadRuntime/);
});
