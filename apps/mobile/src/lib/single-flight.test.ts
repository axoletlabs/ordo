import assert from "node:assert/strict";
import { test } from "node:test";
import { singleFlight } from "./single-flight.ts";

test("overlapping callers share one operation and can run again after success", async () => {
  let calls = 0;
  const run = singleFlight(async () => ++calls);
  const a = run();
  const b = run();
  assert.equal(a, b);
  assert.equal(await b, 1);
  assert.equal(await run(), 2);
});

test("a failed or synchronously throwing operation always allows retry", async () => {
  let calls = 0;
  const run = singleFlight(async () => {
    if (++calls === 1) throw new Error("offline");
    return "ready";
  });
  await assert.rejects(run(), /offline/);
  assert.equal(await run(), "ready");
  const throwing = singleFlight(() => { throw new Error("module unavailable"); });
  await assert.rejects(throwing(), /module unavailable/);
  await assert.rejects(throwing(), /module unavailable/);
});
