import assert from "node:assert/strict";
import { test } from "node:test";
import { checkAppUpdateSources } from "./app-update-check.ts";

test("a disabled OTA source cannot hide an Android check failure", async () => {
  await assert.rejects(checkAppUpdateSources(async () => false, async () => { throw new Error("offline"); }), /offline/);
});

test("a successful native source cannot hide an OTA failure", async () => {
  await assert.rejects(checkAppUpdateSources(async () => { throw new Error("OTA failed"); }, async () => null), /OTA failed/);
});

test("updates from either source are actionable; only two negative checks are up to date", async () => {
  assert.equal(await checkAppUpdateSources(async () => true, async () => null), true);
  assert.equal(await checkAppUpdateSources(async () => false, async () => ({ version: "0.2.0" })), true);
  assert.equal(await checkAppUpdateSources(async () => false, async () => null), false);
});

test("both checks finish before reporting a partial error, including synchronous failures", async () => {
  let nativeFinished = false;
  await assert.rejects(checkAppUpdateSources(() => { throw new Error("missing module"); }, async () => {
    await Promise.resolve();
    nativeFinished = true;
    return null;
  }), /missing module/);
  assert.equal(nativeFinished, true);
});
