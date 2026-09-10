const {
  withAppBuildGradle,
  withDangerousMod,
  withGradleProperties,
  withAndroidManifest,
  withAndroidStyles,
  withAndroidColors,
  withAndroidColorsNight,
  AndroidConfig,
} = require('expo/config-plugins');
const fs = require('node:fs/promises');
const path = require('node:path');

const { assignStylesValue, getAppThemeGroup } = AndroidConfig.Styles;
const { assignColorValue } = AndroidConfig.Colors;

const SCROLLBAR_THUMB_XML = `<?xml version="1.0" encoding="utf-8"?>
<shape xmlns:android="http://schemas.android.com/apk/res/android" android:shape="rectangle">
    <solid android:color="@color/scrollbar_thumb" />
    <corners android:radius="8dp" />
    <size android:width="2dp" />
</shape>
`;

const SCROLLBAR_TRACK_XML = `<?xml version="1.0" encoding="utf-8"?>
<shape xmlns:android="http://schemas.android.com/apk/res/android" android:shape="rectangle">
    <solid android:color="@color/scrollbar_track" />
</shape>
`;

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

// Fabric codegen emits `$event` / `$payload` in EventEmitters.cpp. Each
// autolinked module compiles those files with `-Wpedantic`, which re-enables
// `-Wdollar-in-identifier-extension` after Gradle cppFlags. Flags must be
// added on those targets *after* React Native creates them.
const APP_JNI_CMAKE_PATH = 'src/main/jni/CMakeLists.txt';

const APP_JNI_CMAKE = `cmake_minimum_required(VERSION 3.13)
project(appmodules)
include(\${REACT_ANDROID_DIR}/cmake-utils/ReactNative-application.cmake)

set(ORDO_CXX_WARNING_FLAGS
  -Wno-dollar-in-identifier-extension
  -Wno-error=dollar-in-identifier-extension
)
if(TARGET common_flags)
  target_compile_options(common_flags INTERFACE \${ORDO_CXX_WARNING_FLAGS})
endif()
if(DEFINED AUTOLINKED_LIBRARIES)
  foreach(autolinked_library \${AUTOLINKED_LIBRARIES})
    if(TARGET \${autolinked_library})
      target_compile_options(\${autolinked_library} PRIVATE \${ORDO_CXX_WARNING_FLAGS})
    endif()
  endforeach()
endif()
if(DEFINED APP_CODEGEN_TARGET)
  foreach(codegen_target \${APP_CODEGEN_TARGET})
    if(TARGET \${codegen_target})
      target_compile_options(\${codegen_target} PRIVATE \${ORDO_CXX_WARNING_FLAGS})
    endif()
  endforeach()
endif()
`;

const CMAKE_EXTERNAL_BUILD = [
  '    externalNativeBuild {',
  '        cmake {',
  `            path "${APP_JNI_CMAKE_PATH}"`,
  '        }',
  '    }',
  '',
].join('\n');

function applyCmakePath(code) {
  if (code.includes(APP_JNI_CMAKE_PATH)) return code;
  if (!/android\s*\{/.test(code)) return code;
  return code.replace(/android\s*\{/, `android {\n${CMAKE_EXTERNAL_BUILD}`);
}

/**
 * Room for a universal APK (offset 0) plus the four ABI splits (1-4).
 * CI passes the raw workflow run number; Gradle multiplies by this stride
 * so a later build always outranks every ABI from an earlier one.
 */
const VERSION_CODE_ABI_STRIDE = 10;
const VERSION_CODE_ABI_OFFSETS = {
  'armeabi-v7a': 1,
  'arm64-v8a': 2,
  x86: 3,
  x86_64: 4,
};

const ABI_VERSION_BLOCK_MARKER = 'ordoAbiVersionOffsets';

function versionCodeForAbi(base, abi) {
  const offset = abi == null ? 0 : (VERSION_CODE_ABI_OFFSETS[abi] ?? 0);
  return base * VERSION_CODE_ABI_STRIDE + offset;
}

function groovyAbiOffsetMap() {
  return `[${Object.entries(VERSION_CODE_ABI_OFFSETS)
    .map(([abi, offset]) => `'${abi}': ${offset}`)
    .join(', ')}]`;
}

const ABI_VERSION_BLOCK = [
  'androidComponents {',
  '    onVariants(selector().all()) { variant ->',
  `        def ${ABI_VERSION_BLOCK_MARKER} = ${groovyAbiOffsetMap()}`,
  '        variant.outputs.each { output ->',
  "            def abi = output.filters.find { it.filterType.name() == 'ABI' }?.identifier",
  `            def offset = abi == null ? 0 : (${ABI_VERSION_BLOCK_MARKER}.get(abi) ?: 0)`,
  `            def base = ((rootProject.findProperty('android.versionCode') ?: '1') as int) * ${VERSION_CODE_ABI_STRIDE}`,
  '            output.versionCode.set(base + offset)',
  '        }',
  '    }',
  '}',
].join('\n');

function applyVersionCode(code) {
  if (!/\bversionCode\s+\(\(\(rootProject\.findProperty\('android\.versionCode'\)/.test(code)) {
    code = code.replace(
      /(\bversionCode\s+)\d+/,
      `$1(((rootProject.findProperty('android.versionCode') ?: '1') as int) * ${VERSION_CODE_ABI_STRIDE})`
    );
  }
  if (!code.includes(ABI_VERSION_BLOCK_MARKER)) {
    code = `${code.replace(/\s*$/, '')}\n\n${ABI_VERSION_BLOCK}\n`;
  }
  return code;
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
 *     can pass the workflow run number. Gradle multiplies by 10 and adds a
 *     per-ABI offset (0-4) so split APKs stay ordered without four unused
 *     digits of headroom.
 *   - a `splits { abi { ... } }` block gated on `-Pandroid.buildAbiSplits=true`
 *     emits one APK per ABI plus a universal APK during release builds. Dev
 *     builds instead pass `-PreactNativeArchitectures=arm64-v8a` and skip
 *     splits for a single fast APK.
 *   - Hermes is told to ignore undefined-variable / direct-eval warnings.
 *     RN, Reanimated, and whatwg-fetch refer to polyfilled globals (`Promise`,
 *     `setTimeout`, `Headers`, …) and worklet `eval()`, which hermesc otherwise
 *     dumps into the Gradle log during `:app:createBundleReleaseJsAndAssets`.
 *   - a jni CMakeLists.txt silences Fabric codegen's `$event` clang warnings
 *     on autolinked modules (safe-area, screens, svg).
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
      const jniDir = path.join(
        c.modRequest.platformProjectRoot,
        'app',
        'src',
        'main',
        'jni'
      );
      await fs.mkdir(jniDir, { recursive: true });
      await fs.writeFile(path.join(jniDir, 'CMakeLists.txt'), APP_JNI_CMAKE);

      const drawableDir = path.join(
        c.modRequest.platformProjectRoot,
        'app',
        'src',
        'main',
        'res',
        'drawable'
      );
      await fs.mkdir(drawableDir, { recursive: true });
      await fs.writeFile(path.join(drawableDir, 'scrollbar_thumb.xml'), SCROLLBAR_THUMB_XML);
      await fs.writeFile(path.join(drawableDir, 'scrollbar_track.xml'), SCROLLBAR_TRACK_XML);

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

  config = withAndroidColors(config, (c) => {
    c.modResults = assignColorValue(c.modResults, {
      name: 'scrollbar_thumb',
      value: '#4215140F',
    });
    c.modResults = assignColorValue(c.modResults, {
      name: 'scrollbar_track',
      value: '#00000000',
    });
    return c;
  });

  config = withAndroidColorsNight(config, (c) => {
    c.modResults = assignColorValue(c.modResults, {
      name: 'scrollbar_thumb',
      value: '#61E0E0E0',
    });
    c.modResults = assignColorValue(c.modResults, {
      name: 'scrollbar_track',
      value: '#00000000',
    });
    return c;
  });

  // Keep the activity behind React matched to the splash, including the
  // values-night override generated by expo-splash-screen.
  config = withAndroidStyles(config, (c) => {
    const parent = getAppThemeGroup();
    const items = [
      ['android:windowBackground', '@color/splashscreen_background'],
      ['android:scrollbarThumbVertical', '@drawable/scrollbar_thumb'],
      ['android:scrollbarThumbHorizontal', '@drawable/scrollbar_thumb'],
      ['android:scrollbarTrackVertical', '@drawable/scrollbar_track'],
      ['android:scrollbarTrackHorizontal', '@drawable/scrollbar_track'],
      ['android:fadeScrollbars', 'true'],
    ];
    for (const [name, value] of items) {
      c.modResults = assignStylesValue(c.modResults, {
        add: true,
        parent,
        name,
        value,
      });
    }
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
    // Multiply by VERSION_CODE_ABI_STRIDE so ABI offsets cannot invert builds.
    code = applyVersionCode(code);

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
    code = applyCmakePath(code);

    c.modResults.contents = code;
    return c;
  });

  return config;
};

module.exports = withAndroidBuild;
module.exports.APP_JNI_CMAKE = APP_JNI_CMAKE;
module.exports.ABI_VERSION_BLOCK_MARKER = ABI_VERSION_BLOCK_MARKER;
module.exports.VERSION_CODE_ABI_OFFSETS = VERSION_CODE_ABI_OFFSETS;
module.exports.VERSION_CODE_ABI_STRIDE = VERSION_CODE_ABI_STRIDE;
module.exports.applyCmakePath = applyCmakePath;
module.exports.applyVersionCode = applyVersionCode;
module.exports.versionCodeForAbi = versionCodeForAbi;
