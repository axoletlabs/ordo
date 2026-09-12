const {
  withAppBuildGradle,
  withDangerousMod,
  withGradleProperties,
  withAndroidManifest,
  withAndroidStyles,
  withAndroidColors,
  withAndroidColorsNight,
  withMainActivity,
  AndroidConfig,
} = require('expo/config-plugins');
const { mergeContents } = require('@expo/config-plugins/build/utils/generateCode');
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

const LIGHT_SYSTEM_BARS_BOOL = 'ordo_light_system_bars';

const LIGHT_SYSTEM_BARS_BOOL_XML = `<?xml version="1.0" encoding="utf-8"?>
<resources>
    <bool name="${LIGHT_SYSTEM_BARS_BOOL}">true</bool>
</resources>
`;

const DARK_SYSTEM_BARS_BOOL_XML = `<?xml version="1.0" encoding="utf-8"?>
<resources>
    <bool name="${LIGHT_SYSTEM_BARS_BOOL}">false</bool>
</resources>
`;

const SHARE_RECEIVER_ACTIVITY = '.ShareReceiverActivity';
const QUICK_SHARE_RECEIVER_ACTIVITY = '.QuickShareReceiverActivity';
const SHARE_RECEIVER_ACTIVITIES = [SHARE_RECEIVER_ACTIVITY, QUICK_SHARE_RECEIVER_ACTIVITY];
const QUICK_SHARE_ENABLED_FILE = 'ordo-quick-share-enabled';
const QUICK_SHARE_FLAG_FILE = 'ordo-quick-share';
const QUICK_SHARE_LABEL = 'Quick Bookmark';
const QUICK_SHARE_SHORTCUT_ID = 'ordo_quick_bookmark';
const SHORTCUTS_META = 'android.app.shortcuts';

function quickShareCategory(packageName) {
  return `${packageName}.QUICK_BOOKMARK`;
}

function shortcutsXml(packageName) {
  return `<?xml version="1.0" encoding="utf-8"?>
<shortcuts xmlns:android="http://schemas.android.com/apk/res/android">
    <share-target android:targetClass="${packageName}.QuickShareReceiverActivity">
        <data android:mimeType="text/plain" />
        <category android:name="${quickShareCategory(packageName)}" />
    </share-target>
</shortcuts>
`;
}

function sendIntentFilter() {
  return {
    action: [{ $: { 'android:name': 'android.intent.action.SEND' } }],
    data: [{ $: { 'android:mimeType': 'text/plain' } }],
    category: [{ $: { 'android:name': 'android.intent.category.DEFAULT' } }],
  };
}

function shareReceiverActivity(name, extras = {}) {
  return {
    $: {
      'android:name': name,
      'android:theme': '@android:style/Theme.Translucent.NoTitleBar',
      'android:exported': 'true',
      'android:noHistory': 'true',
      'android:excludeFromRecents': 'true',
      ...extras,
    },
    'intent-filter': [sendIntentFilter()],
  };
}

function shareIntakeKotlin(packageName) {
  const category = quickShareCategory(packageName);
  return `package ${packageName}

import android.app.Activity
import android.content.ComponentName
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.content.pm.ShortcutInfo
import android.content.pm.ShortcutManager
import android.graphics.drawable.Icon
import android.os.Build
import android.os.FileObserver
import android.os.Handler
import android.os.Looper
import java.io.File

internal object ShareIntake {
  const val ENABLED_FILE = "${QUICK_SHARE_ENABLED_FILE}"
  const val FLAG_FILE = "${QUICK_SHARE_FLAG_FILE}"
  const val SHORTCUT_ID = "${QUICK_SHARE_SHORTCUT_ID}"
  const val CATEGORY = "${category}"
  const val LABEL = "${QUICK_SHARE_LABEL}"

  private val main = Handler(Looper.getMainLooper())
  private var filesWatcher: FileObserver? = null
  private var cacheWatcher: FileObserver? = null

  @JvmStatic
  fun forwardToMain(activity: Activity, quick: Boolean) {
    if (quick) markQuick(activity)
    val intent = activity.intent
    val mainIntent = Intent(activity, MainActivity::class.java).apply {
      action = intent.action
      setDataAndType(intent.data, intent.type)
      clipData = intent.clipData
      intent.extras?.let { putExtras(it) }
      addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
      addFlags(Intent.FLAG_ACTIVITY_CLEAR_TOP)
      addFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP)
      addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
    }
    activity.startActivity(mainIntent)
    activity.finish()
  }

  @JvmStatic
  fun markQuick(context: Context) {
    File(context.cacheDir, FLAG_FILE).writeText("1")
  }

  @JvmStatic
  fun watchAndSync(context: Context) {
    watch(context)
    syncQuickTarget(context)
  }

  @JvmStatic
  fun syncQuickTarget(context: Context) {
    val enabled = enabledFileExists(context)
    try {
      val component = ComponentName(context, QuickShareReceiverActivity::class.java)
      context.packageManager.setComponentEnabledSetting(
        component,
        if (enabled) PackageManager.COMPONENT_ENABLED_STATE_ENABLED
        else PackageManager.COMPONENT_ENABLED_STATE_DISABLED,
        PackageManager.DONT_KILL_APP
      )
    } catch (_: Exception) {
    }
    syncQuickShortcut(context, enabled)
  }

  private fun enabledFileExists(context: Context): Boolean {
    return File(context.filesDir, ENABLED_FILE).exists() ||
      File(context.cacheDir, ENABLED_FILE).exists()
  }

  private fun watch(context: Context) {
    val app = context.applicationContext
    if (filesWatcher != null) return
    filesWatcher = observe(app.filesDir, app)
    cacheWatcher = observe(app.cacheDir, app)
  }

  private fun observe(dir: File, app: Context): FileObserver {
    val mask = FileObserver.CREATE or FileObserver.DELETE or FileObserver.MOVED_FROM or
      FileObserver.MOVED_TO or FileObserver.CLOSE_WRITE
    @Suppress("DEPRECATION")
    val observer = object : FileObserver(dir.absolutePath, mask) {
      override fun onEvent(event: Int, path: String?) {
        if (path == ENABLED_FILE) main.post { syncQuickTarget(app) }
      }
    }
    observer.startWatching()
    return observer
  }

  private fun syncQuickShortcut(context: Context, enabled: Boolean) {
    if (Build.VERSION.SDK_INT < Build.VERSION_CODES.N_MR1) return
    try {
      val sm = context.getSystemService(ShortcutManager::class.java) ?: return
      if (!enabled) {
        sm.removeDynamicShortcuts(listOf(SHORTCUT_ID))
        return
      }
      val iconRes = context.applicationInfo.icon
      val icon = Icon.createWithResource(
        context,
        if (iconRes != 0) iconRes else android.R.drawable.ic_menu_save
      )
      val builder = ShortcutInfo.Builder(context, SHORTCUT_ID)
        .setShortLabel(LABEL)
        .setLongLabel(LABEL)
        .setIcon(icon)
        .setCategories(setOf(CATEGORY))
        .setActivity(ComponentName(context, MainActivity::class.java))
        .setRank(0)
        .setIntent(Intent(context, MainActivity::class.java).setAction(Intent.ACTION_VIEW))
      if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
        builder.setLongLived(true)
      }
      sm.addDynamicShortcuts(listOf(builder.build()))
    } catch (_: Exception) {
    }
  }
}
`;
}

function shareReceiverKotlin(packageName) {
  return `package ${packageName}

import android.app.Activity
import android.os.Bundle

class ShareReceiverActivity : Activity() {
  override fun onCreate(savedInstanceState: Bundle?) {
    super.onCreate(savedInstanceState)
    ShareIntake.forwardToMain(this, false)
  }
}
`;
}

function quickShareReceiverKotlin(packageName) {
  return `package ${packageName}

import android.app.Activity
import android.os.Bundle

class QuickShareReceiverActivity : Activity() {
  override fun onCreate(savedInstanceState: Bundle?) {
    super.onCreate(savedInstanceState)
    ShareIntake.forwardToMain(this, true)
  }
}
`;
}

function shareTargetSyncCall(isJava) {
  return isJava ? 'ShareIntake.watchAndSync(this);' : 'ShareIntake.watchAndSync(this)';
}

function shareTargetPauseMethod(isJava) {
  if (isJava) {
    return [
      '  @Override',
      '  public void onPause() {',
      '    super.onPause();',
      '    ShareIntake.watchAndSync(this);',
      '  }',
    ].join('\n');
  }
  return [
    '  override fun onPause() {',
    '    super.onPause()',
    '    ShareIntake.watchAndSync(this)',
    '  }',
  ].join('\n');
}

function patchMainActivityForShareTargets(contents, language) {
  const isJava = language === 'java';
  let next = mergeContents({
    src: contents,
    tag: 'ordo-share-targets-create',
    comment: '    //',
    offset: 1,
    anchor: /super\.onCreate\(null\)/,
    newSrc: `    ${shareTargetSyncCall(isJava)}`,
  }).contents;
  next = mergeContents({
    src: next,
    tag: 'ordo-share-targets-pause',
    comment: '  //',
    offset: 1,
    anchor: /class MainActivity/,
    newSrc: shareTargetPauseMethod(isJava),
  }).contents;
  return next;
}

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

/** Night-aware window chrome so JS reloads do not restore a light status bar. */
const APP_WINDOW_CHROME_ITEMS = [
  ['android:statusBarColor', '@android:color/transparent'],
  ['android:navigationBarColor', '@color/splashscreen_background'],
  ['android:windowDrawsSystemBarBackgrounds', 'true'],
  ['android:windowLightStatusBar', `@bool/${LIGHT_SYSTEM_BARS_BOOL}`],
];

const APP_WINDOW_CHROME_API27_ITEMS = [
  ['android:windowLightNavigationBar', `@bool/${LIGHT_SYSTEM_BARS_BOOL}`],
];

const APP_WINDOW_CHROME_API29_ITEMS = [
  ['android:enforceStatusBarContrast', 'false'],
  ['android:enforceNavigationBarContrast', 'false'],
];

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
      mainActivity['meta-data'] = (mainActivity['meta-data'] ?? []).filter(
        (item) => item.$?.['android:name'] !== SHORTCUTS_META
      );
      mainActivity['meta-data'].push({
        $: {
          'android:name': SHORTCUTS_META,
          'android:resource': '@xml/shortcuts',
        },
      });

      app.activity = (app.activity ?? []).filter(
        (activity) => !SHARE_RECEIVER_ACTIVITIES.includes(activity.$?.['android:name'])
      );
      app.activity.push(shareReceiverActivity(SHARE_RECEIVER_ACTIVITY));
      app.activity.push(
        shareReceiverActivity(QUICK_SHARE_RECEIVER_ACTIVITY, {
          'android:label': QUICK_SHARE_LABEL,
          'android:enabled': 'false',
        })
      );
    }
    return c;
  });

  // Receive shares outside React, then forward them into Ordo's own task. Some
  // sender apps otherwise embed MainActivity in their task and create a second
  // Expo Router tree despite launchMode="singleTask".
  // QuickShareReceiverActivity stays disabled until Settings writes the
  // sidecar file. Android 11+ stacks every SEND activity from one package
  // into a single tile, so "Show alongside Save" also publishes a sharing
  // shortcut labeled Quick Bookmark.
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

      const resDir = path.join(
        c.modRequest.platformProjectRoot,
        'app',
        'src',
        'main',
        'res'
      );
      const valuesDir = path.join(resDir, 'values');
      const valuesNightDir = path.join(resDir, 'values-night');
      await fs.mkdir(valuesDir, { recursive: true });
      await fs.mkdir(valuesNightDir, { recursive: true });
      await fs.writeFile(path.join(valuesDir, 'bools.xml'), LIGHT_SYSTEM_BARS_BOOL_XML);
      await fs.writeFile(path.join(valuesNightDir, 'bools.xml'), DARK_SYSTEM_BARS_BOOL_XML);

      await fs.writeFile(path.join(sourceDir, 'ShareIntake.kt'), shareIntakeKotlin(packageName));
      await fs.writeFile(
        path.join(sourceDir, 'ShareReceiverActivity.kt'),
        shareReceiverKotlin(packageName)
      );
      await fs.writeFile(
        path.join(sourceDir, 'QuickShareReceiverActivity.kt'),
        quickShareReceiverKotlin(packageName)
      );
      const xmlDir = path.join(
        c.modRequest.platformProjectRoot,
        'app',
        'src',
        'main',
        'res',
        'xml'
      );
      await fs.mkdir(xmlDir, { recursive: true });
      await fs.writeFile(path.join(xmlDir, 'shortcuts.xml'), shortcutsXml(packageName));
      return c;
    },
  ]);

  config = withMainActivity(config, (c) => {
    c.modResults.contents = patchMainActivityForShareTargets(
      c.modResults.contents,
      c.modResults.language
    );
    return c;
  });

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
  // values-night override generated by expo-splash-screen. System bars use
  // the same night-aware color so an OTA JS reload cannot flash the light
  // splash into the status-bar inset.
  config = withAndroidStyles(config, (c) => {
    const parent = getAppThemeGroup();
    const items = [
      ['android:windowBackground', '@color/splashscreen_background'],
      ['android:scrollbarThumbVertical', '@drawable/scrollbar_thumb'],
      ['android:scrollbarThumbHorizontal', '@drawable/scrollbar_thumb'],
      ['android:scrollbarTrackVertical', '@drawable/scrollbar_track'],
      ['android:scrollbarTrackHorizontal', '@drawable/scrollbar_track'],
      ['android:fadeScrollbars', 'true'],
      ...APP_WINDOW_CHROME_ITEMS,
    ];
    for (const [name, value] of items) {
      c.modResults = assignStylesValue(c.modResults, {
        add: true,
        parent,
        name,
        value,
      });
    }
    for (const [name, value] of APP_WINDOW_CHROME_API27_ITEMS) {
      c.modResults = assignStylesValue(c.modResults, {
        add: true,
        parent,
        name,
        value,
        targetApi: '27',
      });
    }
    for (const [name, value] of APP_WINDOW_CHROME_API29_ITEMS) {
      c.modResults = assignStylesValue(c.modResults, {
        add: true,
        parent,
        name,
        value,
        targetApi: '29',
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
module.exports.APP_WINDOW_CHROME_ITEMS = APP_WINDOW_CHROME_ITEMS;
module.exports.APP_WINDOW_CHROME_API27_ITEMS = APP_WINDOW_CHROME_API27_ITEMS;
module.exports.APP_WINDOW_CHROME_API29_ITEMS = APP_WINDOW_CHROME_API29_ITEMS;
module.exports.LIGHT_SYSTEM_BARS_BOOL = LIGHT_SYSTEM_BARS_BOOL;
module.exports.QUICK_SHARE_ENABLED_FILE = QUICK_SHARE_ENABLED_FILE;
module.exports.QUICK_SHARE_FLAG_FILE = QUICK_SHARE_FLAG_FILE;
module.exports.QUICK_SHARE_LABEL = QUICK_SHARE_LABEL;
module.exports.QUICK_SHARE_SHORTCUT_ID = QUICK_SHARE_SHORTCUT_ID;
module.exports.quickShareCategory = quickShareCategory;
module.exports.shortcutsXml = shortcutsXml;
module.exports.shareIntakeKotlin = shareIntakeKotlin;
module.exports.shareReceiverKotlin = shareReceiverKotlin;
module.exports.quickShareReceiverKotlin = quickShareReceiverKotlin;
module.exports.patchMainActivityForShareTargets = patchMainActivityForShareTargets;
