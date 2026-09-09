const {
  withAppBuildGradle,
  withDangerousMod,
  withGradleProperties,
  withAndroidManifest,
  withAndroidStyles,
  AndroidConfig,
} = require('expo/config-plugins');
const fs = require('node:fs/promises');
const path = require('node:path');

const { assignStylesValue, getAppThemeGroup } = AndroidConfig.Styles;

const SHARE_RECEIVER_ACTIVITY = '.ShareReceiverActivity';

// Keep the default -O / source-map flags; only suppress the two hermesc
// categories that RN's own bundle cannot satisfy at compile time.
const HERMES_FLAGS_LINE =
  '    hermesFlags = ["-O", "-output-source-map", "-Wno-undefined-variable", "-Wno-direct-eval"]';

function applyHermesFlags(code) {
  if (code.includes('-Wno-undefined-variable')) return code;

  if (/^[ \t]*\/\/[ \t]*hermesFlags\s*=/m.test(code)) {
    return code.replace(
      /^[ \t]*\/\/[ \t]*hermesFlags\s*=\s*\[[^\]]*\]/m,
      HERMES_FLAGS_LINE
    );
  }
  if (/^[ \t]*hermesFlags\s*=/m.test(code)) {
    return code.replace(/^[ \t]*hermesFlags\s*=\s*\[[^\]]*\]/m, HERMES_FLAGS_LINE);
  }
  return code.replace(/react\s*\{/, `react {\n${HERMES_FLAGS_LINE}`);
}

// Fabric codegen emits `$event` / `$payload` in EventEmitters.cpp. Clang
// warns on those (`-Wdollar-in-identifier-extension`) for every autolinked
// module (safe-area, screens, svg, …) and GitHub annotates the whole CMake
// step as errors even though ninja succeeds.
const CMAKE_DOLLAR_FLAGS = [
  '        externalNativeBuild {',
  '            cmake {',
  '                cppFlags "-Wno-dollar-in-identifier-extension"',
  '            }',
  '        }',
].join('\n');

function applyCmakeCppFlags(code) {
  if (code.includes('-Wno-dollar-in-identifier-extension')) return code;
  if (!/defaultConfig\s*\{/.test(code)) return code;
  return code.replace(
    /defaultConfig\s*\{/,
    `defaultConfig {\n${CMAKE_DOLLAR_FLAGS}`
  );
}

function isSendFilter(filter) {
  return filter.action?.some(
    (action) =>
      action.$?.['android:name'] === 'android.intent.action.SEND' ||
      action.$?.['android:name'] === 'android.intent.action.SEND_MULTIPLE'
  );
}

/**
 * Gradle performance + per-ABI split tuning that survives `expo prebuild`.
 *
 * gradle.properties:
 *   - bigger heap + metaspace, parallel build cache, daemon on, PNG
 *     crunching off (needless on modern Android and costs real time).
 *
 * app/build.gradle:
 *   - `versionCode` is read from `-Pandroid.versionCode` (default 1) so CI
 *     can pass `run_number * 10000`; with ABI splits enabled the per-ABI
 *     versionCode offsets can never invert ordering between builds.
 *   - a `splits { abi { ... } }` block gated on `-Pandroid.buildAbiSplits=true`
 *     emits one APK per ABI plus a universal APK during release builds. Dev
 *     builds instead pass `-PreactNativeArchitectures=arm64-v8a` and skip
 *     splits for a single fast APK.
 *   - Hermes is told to ignore undefined-variable / direct-eval warnings.
 *     RN, Reanimated, and whatwg-fetch refer to polyfilled globals (`Promise`,
 *     `setTimeout`, `Headers`, …) and worklet `eval()`, which hermesc otherwise
 *     dumps into the Gradle log during `:app:createBundleReleaseJsAndAssets`.
 */
const withAndroidBuild = (config) => {
  // ── AndroidManifest.xml ────────────────────────────────────────────────
  // Force usesCleartextTraffic=true. Expo SDK 52's prebuild-config silently
  // drops the `android.usesCleartextTraffic` field from app.config.js, so without
  // this OkHttp refuses to open HTTP connections on Android 9+ (API 28+) —
  // the socket factory throws before connect(), the request never reaches the
  // network, and the fetch hangs indefinitely with zero packets on the wire.
  config = withAndroidManifest(config, (c) => {
    const app = c.modResults.manifest.application?.[0];
    if (app) {
      if (!app.$) app.$ = {};
      app.$['android:usesCleartextTraffic'] = 'true';

      const mainActivity = AndroidConfig.Manifest.getMainActivityOrThrow(c.modResults);
      mainActivity.$['android:launchMode'] = 'singleTask';
      mainActivity['intent-filter'] = mainActivity['intent-filter']?.filter(
        (filter) => !isSendFilter(filter)
      );

      app.activity = (app.activity ?? []).filter(
        (activity) => activity.$?.['android:name'] !== SHARE_RECEIVER_ACTIVITY
      );
      app.activity.push({
        $: {
          'android:name': SHARE_RECEIVER_ACTIVITY,
          'android:theme': '@android:style/Theme.Translucent.NoTitleBar',
          'android:exported': 'true',
          'android:noHistory': 'true',
          'android:excludeFromRecents': 'true',
        },
        'intent-filter': [
          {
            action: [{ $: { 'android:name': 'android.intent.action.SEND' } }],
            data: [{ $: { 'android:mimeType': 'text/plain' } }],
            category: [{ $: { 'android:name': 'android.intent.category.DEFAULT' } }],
          },
        ],
      });
    }
    return c;
  });

  // Receive shares outside React, then forward them into Ordo's own task. Some
  // sender apps otherwise embed MainActivity in their task and create a second
  // Expo Router tree despite launchMode="singleTask".
  config = withDangerousMod(config, [
    'android',
    async (c) => {
      const packageName = c.android?.package;
      if (!packageName) throw new Error('Android package name is required');

      const sourceDir = path.join(
        c.modRequest.platformProjectRoot,
        'app',
        'src',
        'main',
        'java',
        ...packageName.split('.')
      );
      await fs.mkdir(sourceDir, { recursive: true });
      await fs.writeFile(
        path.join(sourceDir, 'ShareReceiverActivity.kt'),
        `package ${packageName}

import android.app.Activity
import android.content.Intent
import android.os.Bundle

class ShareReceiverActivity : Activity() {
  override fun onCreate(savedInstanceState: Bundle?) {
    super.onCreate(savedInstanceState)

    val mainIntent = Intent(this, MainActivity::class.java).apply {
      action = intent.action
      setDataAndType(intent.data, intent.type)
      clipData = intent.clipData
      intent.extras?.let { putExtras(it) }
      addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
      addFlags(Intent.FLAG_ACTIVITY_CLEAR_TOP)
      addFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP)
      addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
    }

    startActivity(mainIntent)
    finish()
  }
}
`
      );
      return c;
    },
  ]);

  // Keep the activity behind React matched to the splash, including the
  // values-night override generated by expo-splash-screen.
  config = withAndroidStyles(config, (c) => {
    c.modResults = assignStylesValue(c.modResults, {
      add: true,
      parent: getAppThemeGroup(),
      name: 'android:windowBackground',
      value: '@color/splashscreen_background',
    });
    return c;
  });

  // ── gradle.properties ──────────────────────────────────────────────────
  config = withGradleProperties(config, (c) => {
    const props = c.modResults;
    const set = (key, value) => {
      const existing = props.find(
        (p) => p.type === 'property' && p.key === key
      );
      if (existing) {
        existing.value = value;
      } else {
        props.push({ type: 'property', key, value });
      }
    };

    set('org.gradle.jvmargs', '-Xmx4g -XX:MaxMetaspaceSize=1g');
    set('org.gradle.parallel', 'true');
    set('org.gradle.caching', 'true');
    set('org.gradle.daemon', 'true');
    set('android.enablePngCrunchInReleaseBuilds', 'false');

    return c;
  });

  // ── app/build.gradle ───────────────────────────────────────────────────
  config = withAppBuildGradle(config, (c) => {
    let code = c.modResults.contents;

    // Allow CI to pass -Pandroid.versionCode=<n>; default to 1. Wrapped in a
    // parenthesized `as int` cast so Groovy parses it as a single versionCode(int)
    // argument — the bare `... ).toInteger()` form was parsed as
    // `versionCode(arg).toInteger()` and threw IllegalArgumentException: Value is null.
    code = code.replace(
      /(\bversionCode\s+)\d+/,
      `$1((rootProject.findProperty('android.versionCode') ?: '1') as int)`
    );

    // Inject ABI splits inside the android { } block. Disabled unless
    // -Pandroid.buildAbiSplits=true is passed (release builds only).
    const SPLITS = [
      '    splits {',
      '        abi {',
      '            reset()',
      "            enable (findProperty('android.buildAbiSplits')?.toBoolean() ?: false)",
      '            universalApk true',
      "            include 'armeabi-v7a', 'arm64-v8a', 'x86', 'x86_64'",
      '        }',
      '    }',
      '',
    ].join('\n');

    if (!code.includes('android.buildAbiSplits')) {
      code = code.replace(/android\s*\{/, `android {\n${SPLITS}`);
    }

    code = applyHermesFlags(code);
    code = applyCmakeCppFlags(code);

    c.modResults.contents = code;
    return c;
  });

  return config;
};

module.exports = withAndroidBuild;
