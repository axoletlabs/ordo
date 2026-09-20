import assert from "node:assert/strict";
import { test } from "node:test";
import {
  existingOrNewInstallId,
  needsTelemetryRegistration,
  shouldPing,
  telemetryEnabled,
  telemetryPlatform,
} from "./telemetry-policy.ts";

test("pings only outside development builds", () => {
  assert.equal(telemetryEnabled(true), false);
  assert.equal(telemetryEnabled(false), true);
});

test("re-registers an existing install when telemetry changes", () => {
  assert.equal(needsTelemetryRegistration(undefined, 1), true);
  assert.equal(needsTelemetryRegistration(1, 1), false);
  assert.equal(needsTelemetryRegistration(1, 2), true);
});

test("pings when never seen, after a day, or if the clock jumped back", () => {
  const now = 1_700_000_000_000;
  const day = 24 * 60 * 60 * 1000;
  assert.equal(shouldPing(null, now), true);
  assert.equal(shouldPing(now - day, now), true);
  assert.equal(shouldPing(now - day + 1, now), false);
  assert.equal(shouldPing(now + day, now), true);
});

test("keeps a native app as the app even if the UA looks like a phone browser", () => {
  const androidChrome =
    "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 Chrome/128.0.0.0 Mobile Safari/537.36";
  assert.equal(telemetryPlatform("android", { userAgent: androidChrome }), "android");
  assert.equal(telemetryPlatform("ios"), "ios");
  assert.equal(telemetryPlatform("macos"), "other");
});

test("splits browsers so a phone site visit is not an Android install", () => {
  assert.equal(telemetryPlatform("web"), "web");
  assert.equal(
    telemetryPlatform("web", {
      userAgent:
        "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 Chrome/128.0.0.0 Mobile Safari/537.36",
    }),
    "web-android",
  );
  assert.equal(
    telemetryPlatform("web", {
      userAgent:
        "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 Version/17.0 Mobile/15E148 Safari/604.1",
    }),
    "web-ios",
  );
  assert.equal(
    telemetryPlatform("web", {
      userAgent:
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/128.0.0.0 Safari/537.36",
    }),
    "web-desktop",
  );
  assert.equal(
    telemetryPlatform("web", {
      userAgent:
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15",
      maxTouchPoints: 5,
    }),
    "web-ios",
  );
  assert.equal(
    telemetryPlatform("web", {
      userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Electron/28.0.0",
    }),
    "desktop",
  );
});

test("reuses a saved install id and mints only when missing", () => {
  const kept = "11111111-1111-4111-8111-111111111111";
  assert.equal(existingOrNewInstallId(kept, () => "nope"), kept);
  assert.equal(existingOrNewInstallId("not-a-uuid", () => kept), kept);
  assert.equal(existingOrNewInstallId(null, () => kept), kept);
});
