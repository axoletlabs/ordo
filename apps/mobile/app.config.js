/**
 * Expo dynamic config.
 *
 * Stamps build-time git metadata into `extra.ordo` so the app can show the
 * exact commit an artifact (OTA bundle or native binary) was produced from.
 * This module is evaluated during config resolution — which happens for both
 * `eas build` (native) and `eas update` (OTA) — so the hash reflects the
 * source of whichever artifact is being produced. In dev (`expo start`) there
 * is no artifact; consumers treat a null hash as "—".
 */
const { execSync } = require("node:child_process");

/** Run a git subcommand, returning "" when git or the repo is unavailable. */
function git(args) {
  try {
    return execSync(`git ${args}`, {
      stdio: ["ignore", "pipe", "ignore"],
      // Fingerprint generate loads this config in a child process. An unbounded
      // `git status` can wait on index.lock and freeze the whole detect job.
      timeout: 8_000,
      env: { ...process.env, GIT_OPTIONAL_LOCKS: "0" },
    }).toString().trim();
  } catch {
    return "";
  }
}

const gitHash = git("rev-parse HEAD");
const gitHashShort = git("rev-parse --short HEAD");
const gitDirty = git("status --porcelain").length > 0;

/** @type {import('expo/config').ExpoConfig} */
module.exports = {
  name: "ordo",
  slug: "ordo",
  version: "0.1.0",
  orientation: "default",
  userInterfaceStyle: "automatic",
  icon: "./assets/icon.png",
  backgroundColor: "#EFE7D2",
  newArchEnabled: true,
  updates: {
    url: "https://u.expo.dev/c044b586-2816-42c7-b564-bef8556e21da",
  },
  runtimeVersion: { policy: "fingerprint" },
  plugins: [
    "expo-asset",
    [
      "expo-local-authentication",
      {
        faceIDPermission: "Allow ordo to use Face ID to unlock protected folders.",
      },
    ],
    [
      "expo-image-picker",
      {
        photosPermission: "Allow ordo to access your photos to set a profile picture.",
        cameraPermission: "Allow ordo to take a photo for your profile picture.",
      },
    ],
    [
      "expo-share-intent",
      {
        disableIOS: true,
        disableAndroid: true,
      },
    ],
    [
      "expo-splash-screen",
      {
        image: "./assets/logo-mark.png",
        imageWidth: 120,
        resizeMode: "contain",
        backgroundColor: "#EFE7D2",
        dark: {
          image: "./assets/logo-mark.png",
          backgroundColor: "#1A1A16",
        },
      },
    ],
    "./plugins/with-updates-channel.js",
    "./plugins/with-android-build.js",
    "./plugins/with-high-refresh-rate.js",
  ],
  extra: {
    eas: {
      projectId: "c044b586-2816-42c7-b564-bef8556e21da",
    },
    ordo: {
      gitHash: gitHash || null,
      gitHashShort: gitHashShort || null,
      gitDirty,
    },
  },
  owner: "imlucki",
  android: {
    package: "com.axolet.ordo",
    permissions: ["android.permission.REQUEST_INSTALL_PACKAGES"],
    usesCleartextTraffic: true,
    adaptiveIcon: {
      foregroundImage: "./assets/adaptive-icon-foreground.png",
      backgroundColor: "#EFE7D2",
    },
  },
  ios: {
    infoPlist: {
      // Third-party apps stay at 60fps on ProMotion iPhones unless this is set.
      // The flag only *allows* the panel rate; 60Hz hardware stays at 60.
      CADisableMinimumFrameDurationOnPhone: true,
      NSAppTransportSecurity: {
        NSAllowsArbitraryLoads: true,
      },
    },
  },
};
