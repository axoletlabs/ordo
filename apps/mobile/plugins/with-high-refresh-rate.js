const { withDangerousMod, withMainActivity } = require('expo/config-plugins');
const { mergeContents } = require('@expo/config-plugins/build/utils/generateCode');
const fs = require('node:fs/promises');
const path = require('node:path');

/**
 * Let the UI run at the panel refresh rate (90/120/144Hz) instead of the
 * 60fps cap third-party apps get by default.
 *
 * iOS: `CADisableMinimumFrameDurationOnPhone` in app.config.js Info.plist.
 * Android: request the current display's peak same-resolution mode. The OS
 * still clamps to a user 60Hz lock, battery saver, or thermal throttle.
 */

function highRefreshRateKotlin(packageName) {
  return `package ${packageName}

import android.app.Activity
import android.os.Build
import android.view.Display

internal object HighRefreshRate {
  @JvmStatic
  fun apply(activity: Activity) {
    val window = activity.window ?: return
    val display = currentDisplay(activity) ?: return
    val mode = peakMode(display)
    val targetHz = mode?.refreshRate ?: display.refreshRate
    if (targetHz <= 0f) return

    // Window has no frame-rate setter on compileSdk 35. These LayoutParams
    // are the API that opts the activity into the panel rate.
    val attrs = window.attributes
    attrs.preferredRefreshRate = targetHz
    if (mode != null) {
      attrs.preferredDisplayModeId = mode.modeId
    }
    window.attributes = attrs
  }

  private fun currentDisplay(activity: Activity): Display? {
    return if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
      activity.display
    } else {
      @Suppress("DEPRECATION")
      activity.windowManager.defaultDisplay
    }
  }

  private fun peakMode(display: Display): Display.Mode? {
    if (Build.VERSION.SDK_INT < Build.VERSION_CODES.M) return null
    val current = display.mode
    val sameSize = display.supportedModes.filter { mode ->
      mode.physicalWidth == current.physicalWidth &&
        mode.physicalHeight == current.physicalHeight
    }
    val candidates = sameSize.ifEmpty { display.supportedModes.toList() }
    return candidates.maxByOrNull { it.refreshRate }
  }
}
`;
}

function applyCall(isJava) {
  return isJava ? 'HighRefreshRate.apply(this);' : 'HighRefreshRate.apply(this)';
}

function lifecycleMethods(isJava) {
  if (isJava) {
    return [
      '  @Override',
      '  public void onResume() {',
      '    super.onResume();',
      '    HighRefreshRate.apply(this);',
      '  }',
      '',
      '  @Override',
      '  public void onAttachedToWindow() {',
      '    super.onAttachedToWindow();',
      '    HighRefreshRate.apply(this);',
      '  }',
    ].join('\n');
  }
  return [
    '  override fun onResume() {',
    '    super.onResume()',
    '    HighRefreshRate.apply(this)',
    '  }',
    '',
    '  override fun onAttachedToWindow() {',
    '    super.onAttachedToWindow()',
    '    HighRefreshRate.apply(this)',
    '  }',
  ].join('\n');
}

function patchMainActivity(contents, language) {
  const isJava = language === 'java';
  let next = mergeContents({
    src: contents,
    tag: 'ordo-high-refresh-rate-create',
    comment: '    //',
    offset: 1,
    anchor: /super\.onCreate\(null\)/,
    newSrc: `    ${applyCall(isJava)}`,
  }).contents;
  next = mergeContents({
    src: next,
    tag: 'ordo-high-refresh-rate-lifecycle',
    comment: '  //',
    offset: 1,
    anchor: /class MainActivity/,
    newSrc: lifecycleMethods(isJava),
  }).contents;
  return next;
}

const withHighRefreshRate = (config) => {
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
        path.join(sourceDir, 'HighRefreshRate.kt'),
        highRefreshRateKotlin(packageName)
      );
      return c;
    },
  ]);

  config = withMainActivity(config, (c) => {
    c.modResults.contents = patchMainActivity(
      c.modResults.contents,
      c.modResults.language
    );
    return c;
  });

  return config;
};

module.exports = withHighRefreshRate;
module.exports.patchMainActivity = patchMainActivity;
module.exports.highRefreshRateKotlin = highRefreshRateKotlin;
