const path = require("node:path");
const { fileHookTransform } = require(
  path.join(__dirname, "../../.github/scripts/masked-view-fingerprint-hook.js"),
);

/** @type {import('expo/fingerprint').Config} */
module.exports = {
  // extra.ordo is a git stamp. package.json scripts list test files.
  // Neither changes native compatibility; hashing them mints a runtime
  // that no APK was built for, so eas update --auto cannot land on devices.
  sourceSkips: ["ExpoConfigExtraSection", "PackageJsonScriptsAll"],
  // masked-view's Gradle eval rewrites its manifest; hash that result so
  // APK embed, detect, and eas update --auto share one runtime ID.
  fileHookTransform,
};
