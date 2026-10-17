/** Run with: node --test apps/mobile/scripts/credential-autofill.test.cjs */
const assert = require("node:assert/strict");
const { readFileSync, readdirSync } = require("node:fs");
const { resolve } = require("node:path");
const { test } = require("node:test");
const ts = require("typescript");

// These policies have type-only native imports: exercise the actual TypeScript
// without loading React Native's platform runtime or adding a test dependency.
function loadPolicy(name) {
  const filename = resolve(__dirname, "../src/lib", `${name}.ts`);
  const { outputText } = ts.transpileModule(readFileSync(filename, "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  });
  const mod = { exports: {} };
  new Function("module", "exports", outputText)(mod, mod.exports);
  return mod.exports;
}

const { passwordAutofillProps, usernameAutofillProps, localPasswordAutofillProps, lockedSecretDisplay } = loadPolicy("password-autofill");
const { isSensitiveInput, privateKeyboardType } = loadPolicy("input-privacy");
const { otpAutofillProps } = loadPolicy("otp-autofill");
const { editOtp, normalizeOtp } = loadPolicy("otp-edit");

test("account identifier is a username on native and web", () => {
  assert.deepEqual(usernameAutofillProps(), { autoComplete: "username", textContentType: "username", importantForAutofill: "yes" });
});

for (const [role, contentType] of [["current-password", "password"], ["new-password", "newPassword"]]) {
  test(`${role} uses standard, matching autofill hints`, () => {
    assert.deepEqual(passwordAutofillProps(role), { sensitive: true, autoComplete: role, textContentType: contentType, importantForAutofill: "yes" });
  });
  test(`${role} leaves the autofill graph while obscured`, () => {
    const props = passwordAutofillProps(role, true);
    assert.deepEqual(props, { autoComplete: "off", textContentType: "none", importantForAutofill: "no", editable: false });
    assert.equal(isSensitiveInput(props), false);
  });
}

test("locked usernames cannot be rewritten by an OTP or another account", () => {
  assert.equal(usernameAutofillProps(true).editable, false);
  assert.equal(usernameAutofillProps(true).autoComplete, "off");
});

test("obscured secrets never reach the underlying field, even when revealed", () => {
  for (const reveal of [false, true]) {
    assert.deepEqual(lockedSecretDisplay("private-password", true, reveal), { value: "•".repeat(16), secureTextEntry: false });
    assert.deepEqual(lockedSecretDisplay("", true, reveal), { value: "", secureTextEntry: false });
  }
  assert.deepEqual(lockedSecretDisplay("secret", false, false), { value: "secret", secureTextEntry: true });
  assert.deepEqual(lockedSecretDisplay("secret", false, true), { value: "secret", secureTextEntry: false });
});

test("folder passwords cannot offer or replace saved account credentials", () => {
  assert.equal(localPasswordAutofillProps.autoComplete, "off");
  assert.equal(localPasswordAutofillProps.textContentType, "none");
  assert.equal(localPasswordAutofillProps.importantForAutofill, "no");
  assert.equal(isSensitiveInput({ ...localPasswordAutofillProps, secureTextEntry: false }), true);
});

test("password identity survives reveal regardless of which hint identifies it", () => {
  for (const hint of [
    { sensitive: true }, { secureTextEntry: true },
    { autoComplete: "current-password" }, { autoComplete: "new-password" },
    { textContentType: "password" }, { textContentType: "newPassword" },
  ]) assert.equal(isSensitiveInput(hint), true);
  for (const hint of [{}, { autoComplete: "off" }, { autoComplete: "username" }, { textContentType: "emailAddress" }]) {
    assert.equal(isSensitiveInput(hint), false);
  }
});

test("Android revealed passwords use the password keyboard, not plain text", () => {
  assert.equal(privateKeyboardType("android", true, false, undefined), "visible-password");
  assert.equal(privateKeyboardType("android", true, true, undefined), undefined);
  assert.equal(privateKeyboardType("android", false, false, "email-address"), "email-address");
  assert.equal(privateKeyboardType("ios", true, false, undefined), undefined);
  assert.equal(privateKeyboardType("web", true, false, undefined), undefined);
  assert.equal(privateKeyboardType("ios", false, false, "url"), "url");
  assert.equal(privateKeyboardType("web", false, false, "url"), "default");
});

test("each OTP focus position exposes exactly one code-autofill target", () => {
  for (let active = 0; active < 6; active++) {
    const props = Array.from({ length: 6 }, (_, i) => otpAutofillProps("otp", "numeric", i === active, false));
    assert.equal(props.filter((cell) => cell.autoComplete === "one-time-code").length, 1);
    assert.equal(props.filter((cell) => cell.textContentType === "oneTimeCode").length, 1);
    assert.equal(props.filter((cell) => cell.importantForAutofill === "yes").length, 1);
  }
});

test("busy or hidden OTP fields do not request autofill", () => {
  const props = otpAutofillProps("otp", "numeric", true, true);
  assert.equal(props.autoComplete, "off");
  assert.equal(props.textContentType, "none");
  assert.equal(props.importantForAutofill, "no");
});

test("PIN and backup cells are native secure fields, never SMS targets", () => {
  for (const [purpose, kind] of [["pin", "numeric"], ["otp", "backup"]]) {
    for (const active of [true, false]) {
      const props = otpAutofillProps(purpose, kind, active, false);
      assert.equal(props.secureTextEntry, true);
      assert.equal(props.autoComplete, "off");
      assert.equal(props.textContentType, "none");
      assert.equal(props.importantForAutofill, "no");
    }
  }
  assert.equal(otpAutofillProps("otp", "numeric", true, false).secureTextEntry, false);
});

test("full OTP autofill replaces the code from any focused cell", () => {
  for (let index = 0; index < 6; index++) {
    assert.deepEqual(editOtp("123456", "987 654", index, "numeric", 6), { value: "987654", index: 5 });
  }
});

test("PIN, recovery-code paste, replacement and deletion still work", () => {
  assert.equal(normalizeOtp("ABCD-EF12", "backup", 8), "abcdef12");
  assert.deepEqual(editOtp("12", "3", 2, "numeric", 4), { value: "123", index: 3 });
  assert.deepEqual(editOtp("1234", "9", 1, "numeric", 4), { value: "1934", index: 2 });
  assert.deepEqual(editOtp("1234", "", 1, "numeric", 4), { value: "134", index: 1 });
  assert.deepEqual(editOtp("abcd1234", "FFFF-9999", 4, "backup", 8), { value: "ffff9999", index: 7 });
});

test("every account/folder password field declares an explicit autofill policy and identity", () => {
  const root = resolve(__dirname, "..");
  let passwordFields = 0;
  for (const directory of ["app", "src/components"]) {
    for (const entry of readdirSync(resolve(root, directory), { recursive: true })) {
      if (!entry.endsWith(".tsx")) continue;
      const path = resolve(root, directory, entry);
      const source = ts.createSourceFile(path, readFileSync(path, "utf8"), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
      function visit(node) {
        if (ts.isJsxSelfClosingElement(node) || ts.isJsxOpeningElement(node)) {
          const tag = node.tagName.getText(source);
          const attributes = node.attributes.properties;
          if (["Input", "AuthInput"].includes(tag) && attributes.some((attr) => ts.isJsxAttribute(attr) && attr.name.getText(source) === "secureTextEntry")) {
            passwordFields++;
            assert.ok(attributes.some((attr) => ts.isJsxSpreadAttribute(attr) && /passwordAutofillProps|localPasswordAutofillProps/.test(attr.getText(source))), `Missing password policy: ${path}`);
            assert.ok(attributes.some((attr) => ts.isJsxAttribute(attr) && attr.name.getText(source) === "nativeID"), `Missing stable field identity: ${path}`);
          }
        }
        ts.forEachChild(node, visit);
      }
      visit(source);
    }
  }
  assert.ok(passwordFields >= 15, "The audit must cover every existing password field");
});
