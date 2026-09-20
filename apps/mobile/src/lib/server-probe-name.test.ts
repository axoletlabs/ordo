import assert from "node:assert/strict";
import { test } from "node:test";
import { APP_NAME } from "@ordo/shared";
import { instanceNameOf } from "./instance-name.ts";

test("prefers the instance name from the server", () => {
  assert.equal(instanceNameOf({ name: "datalix" }, "http://100.88.242.13:3000"), "datalix");
});

test("does not repeat the address when the name is the URL host", () => {
  assert.equal(
    instanceNameOf({ name: "100.88.242.13:3000" }, "http://100.88.242.13:3000"),
    APP_NAME,
  );
});

test("falls back to the app name when the server omits a name", () => {
  assert.equal(instanceNameOf(undefined, "http://100.88.242.13:3000"), APP_NAME);
  assert.equal(instanceNameOf({ name: "ordo" }, "http://localhost:3000"), "ordo");
});
