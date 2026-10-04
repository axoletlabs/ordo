import assert from "node:assert/strict";
import { test } from "node:test";
import { exitSearchAfterKeyboardHide, handleSearchBack } from "./search-back.ts";

test("first Back exits search; subsequent Back resumes normal navigation", () => {
  let active = true;
  let exits = 0;
  const exit = () => { active = false; exits++; };
  assert.equal(handleSearchBack(active, exit), true);
  assert.equal(handleSearchBack(active, exit), false);
  assert.equal(exits, 1);
});

test("IME-consumed Back exits search even if Android already blurred the input", () => {
  assert.equal(exitSearchAfterKeyboardHide(true, false), true);
  assert.equal(exitSearchAfterKeyboardHide(false, false), false);
});

test("opening filters must not end search when they dismiss the keyboard", () => {
  assert.equal(exitSearchAfterKeyboardHide(true, true), false);
});
