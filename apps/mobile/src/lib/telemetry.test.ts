import assert from "node:assert/strict";
import { test } from "node:test";
import {
  applyTelemetryNote,
  countsAsSignInFailure,
  emptyTelemetryCounters,
  existingOrNewInstallId,
  needsTelemetryRegistration,
  shouldFlushTelemetry,
  shouldPing,
  telemetryDirty,
  telemetryEnabled,
} from "./telemetry-policy.ts";

test("pings only on the production channel outside development", () => {
  assert.equal(telemetryEnabled(true, "production"), false);
  assert.equal(telemetryEnabled(false, "production"), true);
  assert.equal(telemetryEnabled(false, "preview"), false);
  assert.equal(telemetryEnabled(false, "development"), false);
  assert.equal(telemetryEnabled(false, null), false);
  assert.equal(telemetryEnabled(false, ""), false);
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

test("opens bump, later notes never shrink a count", () => {
  const day = emptyTelemetryCounters("2026-09-23");
  const opened = applyTelemetryNote(day, "open");
  assert.equal(opened.opens, 1);
  assert.equal(applyTelemetryNote(opened, "open").opens, 2);
  const counted = applyTelemetryNote(applyTelemetryNote(day, "timeout"), "serverError");
  assert.equal(counted.timeouts, 1);
  assert.equal(counted.serverErrors, 1);
});

test("treats only HTTP 4xx as a sign-in failure", () => {
  assert.equal(countsAsSignInFailure(401), true);
  assert.equal(countsAsSignInFailure(500), false);
  assert.equal(countsAsSignInFailure(0), false);
});

test("a raised counter is dirty and flushes after the gap", () => {
  const now = 1_700_000_000_000;
  const counters = applyTelemetryNote(emptyTelemetryCounters("2026-09-23"), "timeout");
  const ack = emptyTelemetryCounters("2026-09-23");
  assert.equal(telemetryDirty(counters, ack), true);
  assert.equal(
    shouldFlushTelemetry({
      lastPingAt: now - 60_000,
      ackDay: "2026-09-23",
      today: "2026-09-23",
      now,
      dirty: true,
      force: false,
      immediate: false,
    }),
    false,
  );
  assert.equal(
    shouldFlushTelemetry({
      lastPingAt: now - 20 * 60_000,
      ackDay: "2026-09-23",
      today: "2026-09-23",
      now,
      dirty: true,
      force: false,
      immediate: false,
    }),
    true,
  );
});

test("reuses a saved install id and mints only when missing", () => {
  const kept = "11111111-1111-4111-8111-111111111111";
  assert.equal(existingOrNewInstallId(kept, () => "nope"), kept);
  assert.equal(existingOrNewInstallId("not-a-uuid", () => kept), kept);
  assert.equal(existingOrNewInstallId(null, () => kept), kept);
});
