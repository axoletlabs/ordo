const assert = require('node:assert/strict');
const { test } = require('node:test');
const {
  APP_JNI_CMAKE,
  applyCmakePath,
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
