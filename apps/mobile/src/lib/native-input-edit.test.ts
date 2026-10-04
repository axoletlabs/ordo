import assert from "node:assert/strict";
import { test } from "node:test";
import { nativeInputEdit } from "./native-input-edit.ts";

test("controlled echoes of native keystrokes do not touch the caret", () => {
  assert.equal(nativeInputEdit("https://example.test", "https://example.test", true), "none");
});
test("clipboard and clear actions replace a focused native field without remounting", () => {
  assert.equal(nativeInputEdit("https://pasted.test", "typed", true), "replace");
  assert.equal(nativeInputEdit("", "typed", true), "replace");
});
test("external edits to blurred fields reset their uncontrolled launch value", () => {
  assert.equal(nativeInputEdit("new draft", "old draft", false), "remount");
});
