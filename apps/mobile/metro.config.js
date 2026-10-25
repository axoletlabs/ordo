/**
 * Metro config: Expo defaults plus stubs for modules that dependencies
 * require at load time but ordo never executes. Each stub keeps a large
 * asset or code path out of the bundle and the APK; see metro-stubs/.
 */
const path = require("node:path");
const { getDefaultConfig } = require("expo/metro-config");

// Runs for development, native bundles, web exports and OTA updates.
require("./scripts/generate-licenses.cjs").generateLicenses();

const config = getDefaultConfig(__dirname);
const STUBS = path.join(__dirname, "metro-stubs");

function stubFor(moduleName, originModulePath) {
  // zod's `z.locales` barrel: 40+ translated error catalogs (~190 KB). The
  // English catalog is imported on its own by zod and is unaffected.
  if (
    /[\\/]node_modules[\\/]zod[\\/]/.test(originModulePath) &&
    /^\.\.\/locales\/index(\.c?js)?$/.test(moduleName)
  ) {
    return "zod-locales.js";
  }
  // The reader's HTML engine imports two helpers from the whole ramda barrel.
  if (moduleName === "ramda" && /[\\/]@native-html[\\/]render[\\/]/.test(originModulePath)) {
    return "ramda-pick-omit.js";
  }
  // QR codes never pass `logoSVG`, the only user of the css-tree based parser.
  if (moduleName === "react-native-svg/css" && /[\\/]react-native-qrcode-svg[\\/]/.test(originModulePath)) {
    return "svg-css.js";
  }
  // expo-router's Android toolbar code imports Jetpack Compose views and
  // requires the ExpoUI native module at load; ordo renders no toolbars.
  if (moduleName === "@expo/ui" || moduleName.startsWith("@expo/ui/")) {
    return "expo-ui.js";
  }
  // expo-router always loads its native-tabs icon helper, which registers a
  // 966 KB Material Symbols font through expo-symbols. ordo has no native tabs.
  if (moduleName.startsWith("@expo-google-fonts/material-symbols")) {
    return "material-symbols-font.js";
  }
  return null;
}

const upstreamResolveRequest = config.resolver.resolveRequest;
config.resolver.resolveRequest = (context, moduleName, platform) => {
  const stub = stubFor(moduleName, context.originModulePath);
  if (stub) return { type: "sourceFile", filePath: path.join(STUBS, stub) };
  return (upstreamResolveRequest ?? context.resolveRequest)(context, moduleName, platform);
};

module.exports = config;
