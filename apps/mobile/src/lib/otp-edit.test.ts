import assert from "node:assert/strict";
import test from "node:test";
import { editOtp, normalizeOtp } from "./otp-edit.ts";

test("normalizes numeric codes and formatted backup codes without losing leading zeroes", () => {
  assert.equal(normalizeOtp("01 23-45\n", "numeric", 6), "012345");
  assert.equal(normalizeOtp("AbCd-EF09", "backup", 8), "abcdef09");
  assert.equal(normalizeOtp("12345678", "numeric", 4), "1234");
});

test("replacing a chosen digit preserves every other digit and advances one cell", () => {
  assert.deepEqual(editOtp("1234", "9", 2, "numeric", 6), { value: "1294", index: 3 });
  assert.deepEqual(editOtp("123456", "9", 2, "numeric", 6), { value: "129456", index: 3 });
  assert.deepEqual(editOtp("123456", "0", 5, "numeric", 6), { value: "123450", index: 5 });
});

test("partial paste overwrites in place; complete paste/autofill replaces from any cell", () => {
  assert.deepEqual(editOtp("12345", "98", 2, "numeric", 6), { value: "12985", index: 4 });
  for (let index = 0; index < 6; index++) {
    assert.deepEqual(editOtp("123456", "09 87-65", index, "numeric", 6), { value: "098765", index: 5 });
  }
  assert.deepEqual(editOtp("abcd1234", "EFGH-5678", 4, "backup", 8), { value: "efgh5678", index: 7 });
});

test("deletion keeps a contiguous code; empty future cells cannot create holes", () => {
  assert.deepEqual(editOtp("12345", "", 2, "numeric", 6), { value: "1245", index: 2 });
  assert.deepEqual(editOtp("12", "9", 5, "numeric", 6), { value: "129", index: 3 });
  assert.deepEqual(editOtp("", "1", 0, "numeric", 6), { value: "1", index: 1 });
});

test("invalid input does not erase a digit or advance; partial paste is bounded", () => {
  assert.deepEqual(editOtp("1234", "x", 2, "numeric", 6), { value: "1234", index: 2 });
  assert.deepEqual(editOtp("123456", "98", 5, "numeric", 6), { value: "123459", index: 5 });
});
