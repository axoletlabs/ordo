import assert from "node:assert/strict";
import { test } from "node:test";
import { lockedSecretDisplay, passwordAutofillProps } from "./password-autofill.ts";

test("unlocked current password stays in the password graph", () => {
  assert.deepEqual(passwordAutofillProps("current-password"), {
    autoComplete: "current-password",
    textContentType: "password",
    importantForAutofill: "yes",
  });
});

test("unlocked new password asks the manager to generate, not fill", () => {
  assert.deepEqual(passwordAutofillProps("new-password"), {
    autoComplete: "new-password",
    textContentType: "newPassword",
    importantForAutofill: "yes",
  });
});

test("locking a field drops it out of Autofill", () => {
  assert.deepEqual(passwordAutofillProps("current-password", true), {
    autoComplete: "off",
    textContentType: "none",
    importantForAutofill: "no",
    editable: false,
  });
  assert.deepEqual(passwordAutofillProps("new-password", true), {
    autoComplete: "off",
    textContentType: "none",
    importantForAutofill: "no",
    editable: false,
  });
});

test("a locked secret is masked without using a password input", () => {
  assert.deepEqual(lockedSecretDisplay("hunter2", true, false), {
    value: "•••••••",
    secureTextEntry: false,
  });
  assert.deepEqual(lockedSecretDisplay("", true, true), {
    value: "",
    secureTextEntry: false,
  });
});

test("an unlocked secret keeps the real value and reveal toggle", () => {
  assert.deepEqual(lockedSecretDisplay("hunter2", false, false), {
    value: "hunter2",
    secureTextEntry: true,
  });
  assert.deepEqual(lockedSecretDisplay("hunter2", false, true), {
    value: "hunter2",
    secureTextEntry: false,
  });
});
