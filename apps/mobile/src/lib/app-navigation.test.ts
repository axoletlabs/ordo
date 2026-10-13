import assert from "node:assert/strict";
import { test } from "node:test";
import { appDestination, createNavigationFlight } from "./app-navigation.ts";
import { runPressAction } from "./press-action.ts";

test("authenticated URLs map to existing stack identities without a routing queue", () => {
  assert.deepEqual(appDestination("/settings"), { name: "settings/index", params: {} });
  assert.deepEqual(appDestination("/settings/appearance"), { name: "settings/appearance", params: {} });
  assert.deepEqual(appDestination("/folder/hello%20world"), { name: "folder/[id]", params: { id: "hello world" } });
  assert.deepEqual(appDestination("/reader/article?view=browser"), { name: "reader/[id]", params: { id: "article", view: "browser" } });
  assert.deepEqual(appDestination({ pathname: "/reader/[id]", params: { id: "article", view: "browser" } }), { name: "reader/[id]", params: { id: "article", view: "browser" } });
  assert.equal(appDestination("/(auth)/login"), null);
  assert.equal(appDestination("/folder/broken%"), null);
});

test("navigation and haptics form one accepted action, not two independent handlers", () => {
  const flight = createNavigationFlight();
  let pushes = 0;
  let pulses = 0;
  const open = () => runPressAction(() => {
    if (!flight.begin("library", true)) return false;
    pushes++;
    return true;
  }, () => pulses++);
  assert.equal(open(), true);
  for (let i = 0; i < 20; i++) assert.equal(open(), false);
  assert.equal(pushes, 1);
  assert.equal(pulses, 1);
  flight.release("library");
  assert.equal(open(), true);
  assert.equal(pulses, 2);
  assert.throws(() => runPressAction(() => { throw new Error("Dispatch failed"); }, () => pulses++));
  assert.equal(pulses, 2);
});
test("first tap starts immediately; repeat taps and unfocused screens cannot dispatch", () => {
  const flight = createNavigationFlight();
  assert.equal(flight.begin("library", true), true);
  assert.equal(flight.begin("library", true), false);
  assert.equal(flight.begin("library", false), false);
  assert.equal(flight.begin("settings", true), true);
  flight.release("library");
  assert.equal(flight.begin("settings", true), false);
  flight.release("settings");
  assert.equal(flight.begin("settings", true), true);
});
