/** Run: node --test apps/mobile/scripts/automatic-ota-update.test.cjs */
const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const { resolve } = require("node:path");
const { test } = require("node:test");
const ts = require("typescript");

function load(name, requireModule = require) {
  const { outputText } = ts.transpileModule(readFileSync(resolve(__dirname, `../src/lib/${name}.ts`), "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  });
  const module = { exports: {} };
  new Function("require", "module", "exports", outputText)(requireModule, module, module.exports);
  return module.exports;
}
const { createAutomaticOtaUpdater, OTA_CHECK_BUDGET_MS, OTA_DOWNLOAD_BUDGET_MS } = load("automatic-ota-update");
const flush = async () => { for (let i = 0; i < 20; i++) await Promise.resolve(); };
const deferred = () => {
  let resolve, reject;
  const promise = new Promise((a, b) => { resolve = a; reject = b; });
  return { promise, resolve, reject };
};
function setup(overrides = {}) {
  const calls = [];
  const updater = createAutomaticOtaUpdater({
    enabled: true, alreadyRestarted: false, isPending: () => false, canApply: () => true,
    check: async () => { calls.push("check"); return true; },
    download: async () => { calls.push("download"); return true; },
    restart: async () => { calls.push("restart"); },
    ...overrides,
  });
  return { updater, calls };
}

test("startup checks, downloads and applies without any user action", async () => {
  const { updater, calls } = setup();
  const phases = [updater.getSnapshot()];
  updater.subscribe(() => phases.push(updater.getSnapshot()));
  updater.start();
  await flush();
  assert.deepEqual(calls, ["check", "download", "restart"]);
  assert.deepEqual(phases, ["checking", "downloading", "applying", null]);
});

test("cached pending update applies immediately, even without network", async () => {
  const { updater, calls } = setup({ isPending: () => true });
  updater.start();
  await flush();
  assert.deepEqual(calls, ["restart"]);
});

test("up-to-date startup does not download or restart", async () => {
  const { updater, calls } = setup({ check: async () => false });
  updater.start();
  await flush();
  assert.deepEqual(calls, []);
  assert.equal(updater.getSnapshot(), null);
});

for (const option of [{ enabled: false }, { alreadyRestarted: true }]) {
  test(`${JSON.stringify(option)} skips the launch gate and prevents reload loops`, async () => {
    const { updater, calls } = setup(option);
    assert.equal(updater.getSnapshot(), null);
    updater.start();
    updater.refresh();
    await flush();
    assert.deepEqual(calls, []);
  });
}

test("a false fetch result never restarts", async () => {
  const { updater, calls } = setup({ download: async () => false });
  updater.start();
  await flush();
  assert.deepEqual(calls, ["check"]);
  assert.equal(updater.getSnapshot(), null);
});

for (const action of ["check", "download", "restart"]) {
  test(`${action} failure opens the current app without throwing`, async () => {
    const { updater } = setup({ [action]: async () => { throw new Error("Offline"); } });
    updater.start();
    await flush();
    assert.equal(updater.getSnapshot(), null);
  });
}

test("slow check releases at 2500ms; late results download but never restart", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout", "Date"] });
  const check = deferred();
  const { updater, calls } = setup({ check: () => check.promise });
  updater.start();
  await flush();
  t.mock.timers.tick(OTA_CHECK_BUDGET_MS - 1);
  assert.equal(updater.getSnapshot(), "checking");
  t.mock.timers.tick(1);
  assert.equal(updater.getSnapshot(), null);
  check.resolve(true);
  await flush();
  assert.deepEqual(calls, ["download"]);
  assert.equal(updater.getSnapshot(), null);
});

test("slow download releases at 15000ms and is cached for next launch", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout", "Date"] });
  const download = deferred();
  const { updater, calls } = setup({ download: () => download.promise });
  updater.start();
  await flush();
  assert.equal(updater.getSnapshot(), "downloading");
  t.mock.timers.tick(OTA_DOWNLOAD_BUDGET_MS);
  assert.equal(updater.getSnapshot(), null);
  download.resolve(true);
  await flush();
  assert.deepEqual(calls, ["check"]);
});

test("backgrounding while downloading permanently closes the auto-reload window", async () => {
  const download = deferred();
  const { updater, calls } = setup({ download: () => download.promise });
  updater.start();
  await flush();
  updater.release();
  download.resolve(true);
  await flush();
  assert.deepEqual(calls, ["check"]);
  assert.equal(updater.getSnapshot(), null);
});

test("share intake or native install defers applying safely", async () => {
  const { updater, calls } = setup({ canApply: () => false });
  updater.start();
  await flush();
  assert.deepEqual(calls, ["check", "download"]);
  assert.equal(updater.getSnapshot(), null);
});

test("Strict Mode, remount consumers and foreground events share one startup chain", async () => {
  const { updater, calls } = setup();
  updater.start();
  updater.start();
  updater.refresh();
  updater.refresh();
  await flush();
  assert.deepEqual(calls, ["check", "download", "restart"]);
});

test("foreground checks are throttled, download silently, and never reload", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout", "Date"] });
  const { updater, calls } = setup();
  updater.start();
  await flush();
  updater.refresh();
  await flush();
  assert.equal(calls.length, 3);
  t.mock.timers.tick(60 * 60 * 1000);
  updater.refresh();
  await flush();
  assert.deepEqual(calls, ["check", "download", "restart", "check", "download"]);
  assert.equal(updater.getSnapshot(), null);
});

test("foreground still checks for newer bundles when an older update is cached", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout", "Date"] });
  const { updater, calls } = setup({ isPending: () => true });
  updater.start();
  await flush();
  t.mock.timers.tick(60 * 60 * 1000);
  updater.refresh();
  await flush();
  assert.deepEqual(calls, ["restart", "check", "download"]);
});

test("offline retry backs off for one minute instead of spamming checks", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout", "Date"] });
  let checks = 0;
  const { updater } = setup({ check: async () => { checks++; throw new Error("Offline"); } });
  updater.start();
  await flush();
  updater.refresh();
  await flush();
  assert.equal(checks, 1);
  t.mock.timers.tick(60_000);
  updater.refresh();
  await flush();
  assert.equal(checks, 2);
});

test("native rollback directives are actionable even when isNew/isAvailable are false", async () => {
  const { singleFlight } = load("single-flight");
  const actions = load("ota-update-actions", (name) => {
    if (name === "./single-flight") return { singleFlight };
    if (name === "./app-variant") return { APP_VARIANT: "production", APP_IDENTITY: { channel: "production" } };
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
  const { singleFlight } = load("single-flight");
  for (const [variant, enabled, channel] of [["development", true, "production"], ["production", false, "production"], ["production", true, "preview"], ["production", true, null]]) {
    const actions = load("ota-update-actions", (name) => {
      if (name === "./single-flight") return { singleFlight };
      if (name === "./app-variant") return { APP_VARIANT: variant, APP_IDENTITY: { channel: "production" } };
      if (name === "expo-updates") return { isEnabled: enabled, channel };
      throw new Error(name);
    });
    assert.equal(actions.otaUpdatesEnabled, false);
  }
});

test("shared wavy bar has cubic wave segments and a visible amplitude", () => {
  const { wavyProgressPath } = load("material-progress");
  const path = wavyProgressPath(0, 320 * 0.62, 320, 0, 3, 40);
  assert.ok(path.startsWith("M2,"));
  assert.ok((path.match(/ C/g) ?? []).length >= 16);
  assert.ok(!path.includes("NaN"));
  assert.equal(wavyProgressPath(0, 0, 320, 0, 3, 40), "");
});
