import assert from "node:assert/strict";
import { test } from "node:test";
import { systemChromeForPalette } from "./system-chrome.ts";

test("dark chrome keeps a dark status bar so reload cannot restore the light splash", () => {
  assert.deepEqual(systemChromeForPalette({ mode: "dark", background: "#1A1A16" }), {
    backgroundColor: "#1A1A16",
    barStyle: "light-content",
    translucent: true,
  });
});

test("light chrome matches the parchment splash", () => {
  assert.deepEqual(systemChromeForPalette({ mode: "light", background: "#EFE7D2" }), {
    backgroundColor: "#EFE7D2",
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
