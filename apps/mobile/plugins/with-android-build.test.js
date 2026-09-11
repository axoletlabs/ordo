const assert = require('node:assert/strict');
const { test } = require('node:test');
const {
  ABI_VERSION_BLOCK_MARKER,
  APP_JNI_CMAKE,
  APP_WINDOW_CHROME_API27_ITEMS,
  APP_WINDOW_CHROME_API29_ITEMS,
  APP_WINDOW_CHROME_ITEMS,
  LIGHT_SYSTEM_BARS_BOOL,
  VERSION_CODE_ABI_STRIDE,
  applyCmakePath,
  applyVersionCode,
  versionCodeForAbi,
} = require('./with-android-build.js');

test("points the app CMake at a jni CMakeLists that can override autolinked flags", () => {
  const gradle = [
    'android {',
    '    defaultConfig {',
    '        applicationId "com.axolet.ordo"',
    '    }',
    '}',
  ].join('\n');
  const patched = applyCmakePath(gradle);
  assert.match(patched, /path "src\/main\/jni\/CMakeLists\.txt"/);
  assert.equal(applyCmakePath(patched), patched);
});

test("suppresses dollar-in-identifier on autolinked codegen targets", () => {
  assert.match(APP_JNI_CMAKE, /ReactNative-application\.cmake/);
  assert.match(APP_JNI_CMAKE, /Wno-dollar-in-identifier-extension/);
  assert.match(APP_JNI_CMAKE, /AUTOLINKED_LIBRARIES/);
  assert.match(APP_JNI_CMAKE, /target_compile_options\(\$\{autolinked_library\} PRIVATE/);
});

test("normalises versionCode to run number * 10 plus a one-digit ABI offset", () => {
  assert.equal(VERSION_CODE_ABI_STRIDE, 10);
  assert.equal(versionCodeForAbi(353, null), 3530);
  assert.equal(versionCodeForAbi(353, 'arm64-v8a'), 3532);
  assert.equal(versionCodeForAbi(353, 'x86_64'), 3534);
  assert.ok(versionCodeForAbi(6, null) > versionCodeForAbi(5, 'x86_64'));
});

test("keeps system bars transparent or splash-colored so reloads cannot flash light chrome", () => {
  assert.equal(LIGHT_SYSTEM_BARS_BOOL, 'ordo_light_system_bars');
  assert.deepEqual(APP_WINDOW_CHROME_ITEMS, [
    ['android:statusBarColor', '@android:color/transparent'],
    ['android:navigationBarColor', '@color/splashscreen_background'],
    ['android:windowDrawsSystemBarBackgrounds', 'true'],
    ['android:windowLightStatusBar', `@bool/${LIGHT_SYSTEM_BARS_BOOL}`],
  ]);
  assert.deepEqual(APP_WINDOW_CHROME_API27_ITEMS, [
    ['android:windowLightNavigationBar', `@bool/${LIGHT_SYSTEM_BARS_BOOL}`],
  ]);
  assert.deepEqual(APP_WINDOW_CHROME_API29_ITEMS, [
    ['android:enforceStatusBarContrast', 'false'],
    ['android:enforceNavigationBarContrast', 'false'],
  ]);
});

test("wires CI versionCode through a * 10 default and per-output ABI offsets", () => {
  const gradle = [
    'android {',
    '    defaultConfig {',
    '        versionCode 1',
    '        versionName "0.1.0"',
    '    }',
    '}',
  ].join('\n');
  const patched = applyVersionCode(gradle);
  assert.match(
    patched,
    /versionCode \(\(\(rootProject\.findProperty\('android\.versionCode'\) \?: '1'\) as int\) \* 10\)/,
  );
  assert.match(patched, new RegExp(ABI_VERSION_BLOCK_MARKER));
  assert.match(patched, /output\.filters\.find \{ it\.filterType\.name\(\) == 'ABI' \}/);
  assert.match(patched, /output\.versionCode\.set\(base \+ offset\)/);
  assert.equal(applyVersionCode(patched), patched);
});
