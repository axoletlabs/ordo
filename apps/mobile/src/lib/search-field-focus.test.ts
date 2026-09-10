import assert from "node:assert/strict";
import { afterEach, test } from "node:test";
import {
  registerSearchFieldFocus,
  requestSearchFieldFocus,
} from "./search-field-focus.ts";

afterEach(() => {
  const stop = registerSearchFieldFocus(() => {});
  stop();
});

test("a request before register is delivered when the field mounts", () => {
  let calls = 0;
  requestSearchFieldFocus();
  const stop = registerSearchFieldFocus(() => {
    calls += 1;
  });
  assert.equal(calls, 1);
  stop();
});

test("request calls the registered field immediately", () => {
  let calls = 0;
  const stop = registerSearchFieldFocus(() => {
    calls += 1;
  });
  requestSearchFieldFocus();
  stop();
  assert.equal(calls, 1);
});

test("unregistering an older field does not clear a newer one", () => {
  let current = "";
  const stopOld = registerSearchFieldFocus(() => {
    current = "old";
  });
  const stopNew = registerSearchFieldFocus(() => {
    current = "new";
  });
  stopOld();
  requestSearchFieldFocus();
  stopNew();
  assert.equal(current, "new");
});

test("unregistering the active field stops later requests", () => {
  let calls = 0;
  const stop = registerSearchFieldFocus(() => {
    calls += 1;
  });
  stop();
  requestSearchFieldFocus();
  assert.equal(calls, 0);
});
