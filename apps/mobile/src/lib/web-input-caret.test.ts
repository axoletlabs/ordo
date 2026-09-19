import assert from "node:assert/strict";
import { test } from "node:test";
import { caretAfterKey, shouldCorrectWebCaret } from "./web-input-caret.ts";

test("Backspace in the middle moves the caret one character left", () => {
  assert.equal(caretAfterKey(3, 3, "Backspace"), 2);
});

test("Backspace at the end moves the caret to the new end", () => {
  assert.equal(caretAfterKey(5, 5, "Backspace"), 4);
});

test("Backspace at the start stays put", () => {
  assert.equal(caretAfterKey(0, 0, "Backspace"), 0);
});

test("Backspace over a range lands at the range start", () => {
  assert.equal(caretAfterKey(2, 5, "Backspace"), 2);
  assert.equal(caretAfterKey(5, 2, "Backspace"), 2);
});

test("Delete keeps the caret where the range started", () => {
  assert.equal(caretAfterKey(3, 3, "Delete"), 3);
  assert.equal(caretAfterKey(2, 5, "Delete"), 2);
});

test("other keys are left to the browser", () => {
  assert.equal(caretAfterKey(3, 3, "a"), null);
  assert.equal(caretAfterKey(3, 3, "ArrowLeft"), null);
});

test("modifier and IME backspaces are not rewritten", () => {
  assert.equal(shouldCorrectWebCaret({ key: "Backspace" }), true);
  assert.equal(shouldCorrectWebCaret({ key: "Delete" }), true);
  assert.equal(shouldCorrectWebCaret({ key: "Backspace", ctrlKey: true }), false);
  assert.equal(shouldCorrectWebCaret({ key: "Backspace", metaKey: true }), false);
  assert.equal(shouldCorrectWebCaret({ key: "Backspace", altKey: true }), false);
  assert.equal(shouldCorrectWebCaret({ key: "Backspace", isComposing: true }), false);
  assert.equal(shouldCorrectWebCaret({ key: "Backspace", keyCode: 229 }), false);
  assert.equal(shouldCorrectWebCaret({ key: "a" }), false);
});
