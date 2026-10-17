const { test } = require("node:test");
const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const { resolve } = require("node:path");
const ts = require("typescript");

test("web password-lock removal never calls unsupported native secure-store methods", async () => {
  let nativeCalls = 0;
  const native = new Proxy({}, { get: () => () => { nativeCalls++; throw new Error("Native API unavailable"); } });
  const source = readFileSync(resolve(__dirname, "../src/lib/device-folder-lock.ts"), "utf8");
  const { outputText } = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } });
  const module = { exports: {} };
  new Function("require", "module", "exports", outputText)((name) => name === "react-native" ? { Platform: { OS: "web" } } : native, module, module.exports);
  const api = module.exports;
  assert.equal(await api.isDeviceLockAvailable(), false);
  assert.equal(await api.getDeviceLockCredential("folder"), null);
  await api.deleteDeviceLockCredential("folder");
  await assert.rejects(api.createDeviceLockCredential("folder"), /require the Android or iOS app/);
  assert.equal(nativeCalls, 0);
});
