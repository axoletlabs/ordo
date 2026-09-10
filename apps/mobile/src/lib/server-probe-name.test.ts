import assert from "node:assert/strict";
import { test } from "node:test";
import { instanceNameOf } from "./instance-name.ts";

test("prefers the instance name from the server", () => {
  assert.equal(
    instanceNameOf({ name: "datalix", hostname: "datalix" }, "http://100.88.242.13:3000"),
    "datalix",
  );
});

test("falls back to hostname when the name is the URL host", () => {
  assert.equal(
    instanceNameOf(
      { name: "100.88.242.13:3000", hostname: "datalix" },
      "http://100.88.242.13:3000",
    ),
    "datalix",
  );
});

test("does not repeat the address when the server omits a name", () => {
  assert.equal(instanceNameOf(undefined, "http://100.88.242.13:3000"), "Server");
  assert.equal(instanceNameOf({ name: "ordo" }, "http://localhost:3000"), "ordo");
});
