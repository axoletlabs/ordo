import assert from "node:assert/strict";
import { test } from "node:test";
import { shouldPing, telemetryPlatform } from "./telemetry-policy.ts";

test("pings when never seen, after a day, or if the clock jumped back", () => {
  const now = 1_700_000_000_000;
  const day = 24 * 60 * 60 * 1000;
  assert.equal(shouldPing(null, now), true);
  assert.equal(shouldPing(now - day, now), true);
  assert.equal(shouldPing(now - day + 1, now), false);
  assert.equal(shouldPing(now + day, now), true);
});

test("maps platform without inventing a device identity", () => {
  assert.equal(telemetryPlatform("android"), "android");
  assert.equal(telemetryPlatform("ios"), "ios");
  assert.equal(telemetryPlatform("web"), "web");
  assert.equal(telemetryPlatform("macos"), "other");
});
