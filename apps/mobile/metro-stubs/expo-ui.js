// Stand-in for @expo/ui (see metro.config.js). expo-router loads its Android
// toolbar/header-item code at startup, which imports Jetpack Compose views
// from @expo/ui and calls requireNativeModule("ExpoUI") on load. ordo renders
// none of those (no Stack.Toolbar, no native tabs), so every export here is
// inert: components render nothing and modifier factories return null. This
// keeps the ExpoUI native module (and Jetpack Compose) out of the APK.
function inert() {
  return null;
}
module.exports = new Proxy(
  {},
  {
    get(_target, key) {
      if (key === "__esModule") return true;
      // Never look like a promise or iterable to callers probing the module.
      if (typeof key === "symbol" || key === "then") return undefined;
      return inert;
    },
  },
);
