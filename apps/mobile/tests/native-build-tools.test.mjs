import assert from 'node:assert/strict';
import test from 'node:test';
import expoPlist from '@expo/plist';
const plist = expoPlist.default;

// Exercise Expo's public API against the workspace's security-pinned xmldom.
// iOS prebuild reads and writes these values in Info.plist and entitlements.
test('Expo plist round-trips native configuration with the pinned XML parser', () => {
  const nativeConfig = {
    CFBundleIdentifier: 'com.example.ordo',
    CFBundleDisplayName: 'Ordo & browser',
    UIBackgroundModes: ['fetch', 'remote-notification'],
    CADisableMinimumFrameDurationOnPhone: true,
    NSAppTransportSecurity: { NSAllowsLocalNetworking: true, NSAllowsArbitraryLoads: false },
    buildNumber: 42,
  };
  assert.deepEqual(JSON.parse(JSON.stringify(plist.parse(plist.build(nativeConfig)))), nativeConfig);
});
