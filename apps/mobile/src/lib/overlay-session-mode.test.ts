import assert from "node:assert/strict";
import { test } from "node:test";
import { overlaySessionMode } from "./overlay-session-mode.ts";

test("keeps delete while the overlay stays open", () => {
  const next = overlaySessionMode(true, true, "delete", "menu");
  assert.equal(next.mode, "delete");
  assert.equal(next.wasVisible, true);
});

test("clears leftover delete when the overlay closes", () => {
  const next = overlaySessionMode(false, true, "delete", "menu");
  assert.equal(next.mode, "menu");
  assert.equal(next.wasVisible, false);
});

test("does not reopen in delete after a close/open cycle", () => {
  const closed = overlaySessionMode(false, true, "delete", "menu");
  const opened = overlaySessionMode(true, closed.wasVisible, closed.mode, "menu");
  assert.equal(opened.mode, "menu");
});

test("stays idle across a normal close/open", () => {
  const closed = overlaySessionMode(false, true, "menu", "menu");
  const opened = overlaySessionMode(true, closed.wasVisible, closed.mode, "menu");
  assert.equal(opened.mode, "menu");
});

test("keeps edit while the overlay stays open", () => {
  const next = overlaySessionMode(true, true, "edit", "menu");
  assert.equal(next.mode, "edit");
});

test("clears leftover edit when the overlay reopens", () => {
  const closed = overlaySessionMode(false, true, "edit", "menu");
  const opened = overlaySessionMode(true, closed.wasVisible, closed.mode, "menu");
  assert.equal(opened.mode, "menu");
});
