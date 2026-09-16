import assert from "node:assert/strict";
import { test } from "node:test";
import {
  isServerUnreachable,
  reportServerUnreachable,
  subscribeServerUnreachable,
} from "./server-availability.ts";

test("subscribers run once per report and can unsubscribe", () => {
  const seen: number[] = [];
  const stop = subscribeServerUnreachable(() => seen.push(1));
  reportServerUnreachable();
  stop();
  reportServerUnreachable();
  assert.deepEqual(seen, [1]);
});

test("timeouts and dropped connections are unreachable", () => {
  assert.equal(isServerUnreachable({ status: 0, code: "request_timeout" }), true);
  assert.equal(
    isServerUnreachable({
      status: 0,
      code: "network_error",
      message: "Couldn't reach the server. Check your connection.",
    }),
    true,
  );
});

test("cancels and HTTP errors are not treated as a down host", () => {
  assert.equal(
    isServerUnreachable({ status: 0, code: "network_error", message: "The request was cancelled." }),
    false,
  );
  assert.equal(isServerUnreachable({ status: 500, code: "internal_error" }), false);
  assert.equal(isServerUnreachable(new Error("offline")), false);
});
