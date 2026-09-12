/** @type {import('expo/fingerprint').Config} */
module.exports = {
  // extra.ordo is a git stamp. package.json scripts list test files.
  // Neither changes native compatibility; hashing them mints a runtime
  // that no APK was built for, so eas update --auto cannot land on devices.
  sourceSkips: ["ExpoConfigExtraSection", "PackageJsonScriptsAll"],
};
