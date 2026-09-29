import assert from "node:assert/strict";
import { test } from "node:test";
import { resolveOtaStatus, type OtaStateInput } from "./ota-update-state.ts";

const idle: OtaStateInput = {
  enabled: true, isChecking: false, isDownloading: false,
  isUpdateAvailable: false, isUpdatePending: false,
  runningId: "running", availableId: null, pendingId: null,
  availableAt: null, pendingAt: null, hasError: false, hasChecked: false,
};
test("OTA state follows disabled, checking and downloading truth", () => {
  assert.equal(resolveOtaStatus(idle), "idle");
  assert.equal(resolveOtaStatus({ ...idle, hasChecked: true }), "up-to-date");
  assert.equal(resolveOtaStatus({ ...idle, hasError: true }), "error");
  assert.equal(resolveOtaStatus({ ...idle, enabled: false, isDownloading: true }), "disabled");
  assert.equal(resolveOtaStatus({ ...idle, isChecking: true, isUpdatePending: true }), "checking");
  assert.equal(resolveOtaStatus({ ...idle, isChecking: true, isDownloading: true }), "downloading");
});
test("does not download an advertised older update over a newer pending bundle", () => {
  const pending = { ...idle, isUpdateAvailable: true, isUpdatePending: true,
    availableId: "old", pendingId: "new", availableAt: new Date(1000), pendingAt: new Date(2000) };
  assert.equal(resolveOtaStatus(pending), "ready");
  assert.equal(resolveOtaStatus({ ...pending, availableAt: new Date(3000) }), "available");
  assert.equal(resolveOtaStatus({ ...pending, availableId: "new" }), "ready");
});
test("handles rollback directives and ignores the already-running update", () => {
  assert.equal(resolveOtaStatus({ ...idle, isUpdateAvailable: true }), "available");
  assert.equal(resolveOtaStatus({ ...idle, isUpdatePending: true }), "ready");
  assert.equal(resolveOtaStatus({ ...idle, isUpdateAvailable: true, availableId: "running", hasChecked: true }), "up-to-date");
});
