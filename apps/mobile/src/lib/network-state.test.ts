import assert from "node:assert/strict";
import { test } from "node:test";
import { networkStateIsOnline } from "./network-state.ts";

test("a missing device link is offline", () => {
  assert.equal(networkStateIsOnline({ isConnected: false }), false);
});

test("LAN without public internet is still online", () => {
  assert.equal(networkStateIsOnline({ isConnected: true, isInternetReachable: false }), true);
  assert.equal(networkStateIsOnline({ isConnected: true, isInternetReachable: null }), true);
});

test("unknown connectivity stays online so a probe cannot freeze the app", () => {
  assert.equal(networkStateIsOnline({}), true);
  assert.equal(networkStateIsOnline({ isConnected: null, isInternetReachable: false }), true);
});
