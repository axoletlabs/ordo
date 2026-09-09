import assert from "node:assert/strict";
import { test } from "node:test";
import {
  ACCESS_REFRESH_LEAD_MS,
  accessExpiresAtFromNow,
  isDefiniteRefreshRejection,
  nextProactiveRefreshDelayMs,
  shouldClearSessionForError,
  shouldRefreshAccessToken,
  shouldRetryRequestWithRefresh,
} from "./auth-session-policy.ts";

test("stamps expiry from expiresIn relative to now", () => {
  assert.equal(accessExpiresAtFromNow(15 * 60, 1_000), 1_000 + 15 * 60 * 1000);
});

test("unknown or elapsed access expiry should refresh now", () => {
  assert.equal(shouldRefreshAccessToken(null, 5_000), true);
  assert.equal(shouldRefreshAccessToken(undefined, 5_000), true);
  assert.equal(shouldRefreshAccessToken(4_000, 5_000), true);
  assert.equal(shouldRefreshAccessToken(5_000 + ACCESS_REFRESH_LEAD_MS, 5_000), true);
});

test("access tokens with more than a minute left wait", () => {
  assert.equal(shouldRefreshAccessToken(5_000 + ACCESS_REFRESH_LEAD_MS + 1, 5_000), false);
});

test("proactive delay is remaining time minus the lead, never negative", () => {
  assert.equal(nextProactiveRefreshDelayMs(5_000 + 10 * 60_000, 5_000), 9 * 60_000);
  assert.equal(nextProactiveRefreshDelayMs(5_000, 5_000), 0);
  assert.equal(nextProactiveRefreshDelayMs(1_000, 5_000), 0);
});

test("expired and unknown 401s refresh once; session_revoked does not", () => {
  assert.equal(
    shouldRetryRequestWithRefresh({ status: 401, code: "token_expired" }, { auth: true, retried: false }),
    true,
  );
  assert.equal(
    shouldRetryRequestWithRefresh({ status: 401, code: "unauthorized" }, { auth: true, retried: false }),
    true,
  );
  assert.equal(
    shouldRetryRequestWithRefresh({ status: 401, code: "session_revoked" }, { auth: true, retried: false }),
    false,
  );
  assert.equal(
    shouldRetryRequestWithRefresh({ status: 401, code: "unauthorized" }, { auth: true, retried: true }),
    false,
  );
  assert.equal(
    shouldRetryRequestWithRefresh({ status: 401, code: "unauthorized" }, { auth: false, retried: false }),
    false,
  );
});

test("only our 401 auth codes reject a refresh; proxy/network failures do not", () => {
  assert.equal(isDefiniteRefreshRejection({ status: 401, code: "session_revoked" }), true);
  assert.equal(isDefiniteRefreshRejection({ status: 401, code: "unauthorized" }), true);
  assert.equal(isDefiniteRefreshRejection({ status: 401, code: "token_expired" }), true);
  assert.equal(isDefiniteRefreshRejection({ status: 401, code: "unknown_error" }), false);
  assert.equal(isDefiniteRefreshRejection({ status: 0, code: "network_error" }), false);
  assert.equal(isDefiniteRefreshRejection({ status: 502, code: "unknown_error" }), false);
});

test("stale session_revoked after rotation does not clear the new tokens", () => {
  assert.equal(
    shouldClearSessionForError(
      { status: 401, code: "session_revoked" },
      { sentAccessToken: "old", currentAccessToken: "new" },
    ),
    false,
  );
  assert.equal(
    shouldClearSessionForError(
      { status: 401, code: "session_revoked" },
      { sentAccessToken: "current", currentAccessToken: "current" },
    ),
    true,
  );
  assert.equal(
    shouldClearSessionForError(
      { status: 401, code: "unauthorized" },
      { sentAccessToken: "current", currentAccessToken: "current" },
    ),
    false,
  );
});
