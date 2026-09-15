/**
 * Bluesky's UITextView is iOS-only native code (Android falls back to RN Text).
 * Skip Android autolinking so the missing Gradle project cannot break the APK.
 */
module.exports = {
  dependencies: {
    "@bsky.app/react-native-uitextview": {
      platforms: {
        android: null,
      },
    },
  },
};
