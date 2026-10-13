const { withAndroidManifest } = require('expo/config-plugins');

// Channels (baked into the APK; EAS Update publishes to the same name):
//   stable / preview — fixed app identities, never switched in-app
// Development binaries disable expo-updates and have no subscription.
// The runtime reads the channel from `expo-channel-name` in the request-headers
// map (meta-data UPDATES_CONFIGURATION_REQUEST_HEADERS_KEY). A request without
// it is rejected by EAS ("channel-name: Required"). EAS Build injects this
// header; this plugin does the equivalent for raw local Gradle builds.
const REQUEST_HEADERS_META = 'expo.modules.updates.UPDATES_CONFIGURATION_REQUEST_HEADERS_KEY';

const withUpdatesChannel = (config) =>
  withAndroidManifest(config, (c) => {
    const application = c.modResults.manifest.application[0];
    application['meta-data'] ||= [];
    if (config.updates?.enabled === false) {
      application['meta-data'] = application['meta-data'].filter(
        (m) => m.$?.['android:name'] !== REQUEST_HEADERS_META
      );
      return c;
    }
    const headers = application['meta-data'].find(
      (m) => m.$ && m.$['android:name'] === REQUEST_HEADERS_META
    );
    const channel = config.updates?.requestHeaders?.['expo-channel-name'];
    if (!channel) throw new Error('An explicit Expo updates channel is required');
    // Preserve EAS signing/filter headers instead of replacing the whole map.
    const value = JSON.stringify({
      ...(headers?.$?.['android:value'] ? JSON.parse(headers.$['android:value']) : {}),
      ...config.updates?.requestHeaders,
      'expo-channel-name': channel,
    });
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
