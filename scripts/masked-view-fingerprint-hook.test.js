const assert = require("node:assert/strict");
const { test } = require("node:test");
const {
  fileHookTransform,
} = require("../.github/scripts/masked-view-fingerprint-hook.js");

const manifestPath =
  "../../node_modules/@react-native-masked-view/masked-view/android/src/main/AndroidManifest.xml";
const original =
  '<manifest package="org.reactnative.maskedview" xmlns:android="http://schemas.android.com/apk/res/android">\n</manifest>\n';
const afterGradle =
  '<manifest  xmlns:android="http://schemas.android.com/apk/res/android">\n</manifest>\n';

test("strips masked-view package= the way Gradle does", () => {
  const source = { type: "file", filePath: manifestPath };
  assert.equal(fileHookTransform(source, original, false), null);
  assert.equal(fileHookTransform(source, null, true), afterGradle);
});

test("is a no-op after Gradle has already stripped package=", () => {
  const source = { type: "file", filePath: manifestPath };
  assert.equal(fileHookTransform(source, afterGradle, false), null);
  assert.equal(fileHookTransform(source, null, true), afterGradle);
});

test("leaves other files unchanged", () => {
  const source = { type: "file", filePath: "android/src/main/AndroidManifest.xml" };
  assert.equal(fileHookTransform(source, original, false), original);
});
