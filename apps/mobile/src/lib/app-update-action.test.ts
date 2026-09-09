import assert from "node:assert/strict";
import { test } from "node:test";
import {
  listAppUpdatePhases,
  resolveAppUpdateAction,
  type AppUpdateActionInput,
} from "./app-update-action.ts";
import type { NativeRelease } from "../store/native-update.ts";

function native(publishedAt: string): NativeRelease {
  return {
    version: "0.2.0",
    tagName: "v0.2.0",
    name: "ordo v0.2.0",
    body: "",
    prerelease: false,
    publishedAt,
    pageUrl: "https://github.com/axoletlabs/ordo/releases",
    apkUrl: "https://example.com/ordo.apk",
    apkSize: 1,
  };
}

function input(partial: Partial<AppUpdateActionInput> = {}): AppUpdateActionInput {
  return {
    otaStatus: "idle",
    otaAvailableAt: null,
    otaPendingAt: null,
    nativeStatus: "idle",
    nativeRelease: null,
    nativeDownloaded: false,
    ...partial,
  };
}

test("idle OTA and native resolve to Check", () => {
  const resolved = resolveAppUpdateAction(input());
  assert.equal(resolved.action, "check");
  assert.equal(resolved.kind, null);
  assert.deepEqual(resolved.phases, []);
});

test("an OTA and a native APK stay visible together", () => {
  const phases = listAppUpdatePhases(
    input({
      otaStatus: "ready",
      otaPendingAt: new Date("2026-09-10T12:00:00Z"),
      nativeStatus: "available",
      nativeRelease: native("2026-09-01T00:00:00Z"),
    }),
  );
  assert.deepEqual(phases, [
    { kind: "native", action: "download" },
    { kind: "ota", action: "restart" },
  ]);
});

test("a newer OTA does not hide an older native APK", () => {
  const phases = listAppUpdatePhases(
    input({
      otaStatus: "available",
      otaAvailableAt: new Date("2026-09-10T12:00:00Z"),
      nativeStatus: "available",
      nativeRelease: native("2026-01-01T00:00:00Z"),
    }),
  );
  assert.equal(phases.some((phase) => phase.kind === "native"), true);
  assert.equal(phases.some((phase) => phase.kind === "ota"), true);
});

test("a downloaded APK is Install, not Restart", () => {
  const resolved = resolveAppUpdateAction(
    input({
      nativeStatus: "downloaded",
      nativeRelease: native("2026-09-01T00:00:00Z"),
      nativeDownloaded: true,
    }),
  );
  assert.deepEqual(resolved.phases, [{ kind: "native", action: "install" }]);
  assert.equal(resolved.action, "install");
});

test("an in-flight native download stays Download", () => {
  const resolved = resolveAppUpdateAction(
    input({
      otaStatus: "ready",
      nativeStatus: "downloading",
      nativeRelease: native("2026-09-01T00:00:00Z"),
      nativeDownloaded: false,
    }),
  );
  assert.deepEqual(resolved.phases[0], { kind: "native", action: "download" });
  assert.equal(resolved.downloading, true);
});

test("native error with a known release is still offered", () => {
  const phases = listAppUpdatePhases(
    input({
      nativeStatus: "error",
      nativeRelease: native("2026-09-01T00:00:00Z"),
      nativeDownloaded: false,
    }),
  );
  assert.deepEqual(phases, [{ kind: "native", action: "download" }]);
});
