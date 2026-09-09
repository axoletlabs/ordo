const assert = require('node:assert/strict');
const { test } = require('node:test');
const {
  highRefreshRateKotlin,
  patchMainActivity,
} = require('./with-high-refresh-rate.js');

const KOTLIN_ACTIVITY = `package com.axolet.ordo

import android.os.Build
import android.os.Bundle

import com.facebook.react.ReactActivity

class MainActivity : ReactActivity() {
  override fun onCreate(savedInstanceState: Bundle?) {
    setTheme(R.style.AppTheme);
    super.onCreate(null)
  }

  override fun getMainComponentName(): String = "main"
}
`;

const JAVA_ACTIVITY = `package com.axolet.ordo;

import android.os.Bundle;
import com.facebook.react.ReactActivity;

public class MainActivity extends ReactActivity {
  @Override
  protected void onCreate(Bundle savedInstanceState) {
    setTheme(R.style.AppTheme);
    super.onCreate(null);
  }
}
`;

test("asks Kotlin MainActivity to match the display refresh rate", () => {
  const patched = patchMainActivity(KOTLIN_ACTIVITY, 'kt');
  assert.match(patched, /HighRefreshRate\.apply\(this\)/);
  assert.match(patched, /override fun onResume\(\)/);
  assert.match(patched, /override fun onAttachedToWindow\(\)/);
  assert.equal(
    patched.split('HighRefreshRate.apply(this)').length - 1,
    3
  );
});

test("is idempotent across prebuild reruns", () => {
  const once = patchMainActivity(KOTLIN_ACTIVITY, 'kt');
  const twice = patchMainActivity(once, 'kt');
  assert.equal(twice, once);
});

test("patches Java MainActivity the same way", () => {
  const patched = patchMainActivity(JAVA_ACTIVITY, 'java');
  assert.match(patched, /HighRefreshRate\.apply\(this\);/);
  assert.match(patched, /public void onResume\(\)/);
  assert.match(patched, /public void onAttachedToWindow\(\)/);
});

test("writes a helper that requests the peak same-resolution mode", () => {
  const source = highRefreshRateKotlin('com.axolet.ordo');
  assert.match(source, /package com\.axolet\.ordo/);
  assert.match(source, /preferredRefreshRate/);
  assert.match(source, /preferredDisplayModeId/);
  assert.match(source, /physicalWidth == current\.physicalWidth/);
  assert.doesNotMatch(source, /window\.setFrameRate/);
});
