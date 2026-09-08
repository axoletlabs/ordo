const { withAndroidManifest } = require('expo/config-plugins');

const CHANNEL = process.env.EXPO_UPDATES_CHANNEL || 'production';

// Stable X.Y.Z APKs use `production`. Early-access tags (alpha / beta / RC)
// use `development`. EAS Update publishes to the same name.
// The runtime reads the channel from `expo-channel-name` in the request-headers
// map (meta-data UPDATES_CONFIGURATION_REQUEST_HEADERS_KEY). A request without
// it is rejected by EAS ("channel-name: Required"). EAS Build injects this
// header; this plugin does the equivalent for raw local Gradle builds.
const REQUEST_HEADERS_META = 'expo.modules.updates.UPDATES_CONFIGURATION_REQUEST_HEADERS_KEY';

const withUpdatesChannel = (config) =>
  withAndroidManifest(config, (c) => {
    const application = c.modResults.manifest.application[0];
    application['meta-data'] ||= [];
    const headers = application['meta-data'].find(
      (m) => m.$ && m.$['android:name'] === REQUEST_HEADERS_META
    );
    const value = JSON.stringify({ 'expo-channel-name': CHANNEL });
    if (headers) {
      headers.$['android:value'] = value;
    } else {
      application['meta-data'].push({
        $: { 'android:name': REQUEST_HEADERS_META, 'android:value': value },
      });
    }
    return c;
  });

module.exports = withUpdatesChannel;
