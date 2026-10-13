import assert from "node:assert/strict";
import { test } from "node:test";
import { systemChromeForPalette } from "./system-chrome.ts";

test("dark chrome keeps a dark status bar so reload cannot restore the light splash", () => {
  assert.deepEqual(systemChromeForPalette({ mode: "dark", background: "#0E1513" }), {
    backgroundColor: "#0E1513",
    barStyle: "light-content",
    translucent: true,
  });
});

test("light chrome matches the generated Material launch surface", () => {
  assert.deepEqual(systemChromeForPalette({ mode: "light", background: "#F4FBF8" }), {
    backgroundColor: "#F4FBF8",
    barStyle: "dark-content",
    translucent: true,
  });
});

test("AMOLED chrome follows the pure-black surface", () => {
  assert.deepEqual(systemChromeForPalette({ mode: "dark", background: "#000000" }), {
    backgroundColor: "#000000",
    barStyle: "light-content",
    translucent: true,
  });
});
