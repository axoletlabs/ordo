const assert = require('node:assert/strict');
const { test } = require('node:test');
const {
  ABI_VERSION_BLOCK_MARKER,
  APP_JNI_CMAKE,
  APP_WINDOW_CHROME_API27_ITEMS,
  APP_WINDOW_CHROME_API29_ITEMS,
  APP_WINDOW_CHROME_ITEMS,
  BACKUP_RULES_FILE,
  BACKUP_RULES_XML,
  DATA_EXTRACTION_RULES_FILE,
  DATA_EXTRACTION_RULES_XML,
  LIGHT_SYSTEM_BARS_BOOL,
  QUICK_SHARE_ENABLED_FILE,
  QUICK_SHARE_FLAG_FILE,
  QUICK_SHARE_BOOKMARK_FILE,
  QUICK_SHARE_SESSION_FILE,
  QUICK_SHARE_SESSION_KEY,
  QUICK_SHARE_SESSION_PREFS,
  QUICK_SHARE_LABEL,
  QUICK_SHARE_SHORTCUT_ID,
  SAVE_SHARE_LABEL,
  SECURITY_CRYPTO,
  SHARE_RECEIVER_DEFAULT_ALIAS,
  SHARE_RECEIVER_SAVE_ALIAS,
  VERSION_CODE_ABI_STRIDE,
  applyCmakePath,
  applySecurityCrypto,
  applyVersionCode,
  ordoShareSessionModuleKotlin,
  patchMainActivityForShareTargets,
  patchMainApplicationForShareSession,
  quickShareCategory,
  quickShareReceiverKotlin,
  quickShareSaveKotlin,
  shareIntakeKotlin,
  shareReceiverActivity,
  shareReceiverAlias,
  shareReceiverKotlin,
  shareSessionStoreKotlin,
  shortcutsXml,
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
    ['android:forceDarkAllowed', 'false'],
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

const KOTLIN_ACTIVITY = `package com.axolet.ordo

import android.os.Bundle

import com.facebook.react.ReactActivity

class MainActivity : ReactActivity() {
  override fun onCreate(savedInstanceState: Bundle?) {
    setTheme(R.style.AppTheme);
    super.onCreate(null)
  }
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

test("share intake uses sidecar files that match the JS constants", () => {
  const source = shareIntakeKotlin('com.axolet.ordo');
  assert.match(source, /package com\.axolet\.ordo/);
  assert.match(source, new RegExp(`ENABLED_FILE = "${QUICK_SHARE_ENABLED_FILE}"`));
  assert.match(source, new RegExp(`FLAG_FILE = "${QUICK_SHARE_FLAG_FILE}"`));
  assert.match(source, new RegExp(`BOOKMARK_FILE = "${QUICK_SHARE_BOOKMARK_FILE}"`));
  assert.doesNotMatch(source, /SESSION_FILE/);
  assert.match(source, /handleIncoming/);
  assert.match(source, /isQuickDefault/);
  assert.match(source, /QuickShareSave\.save/);
  assert.match(source, /COMPONENT_ENABLED_STATE_DISABLED/);
  assert.equal(SAVE_SHARE_LABEL, 'Save');
  assert.equal(QUICK_SHARE_LABEL, 'Quick Save');
});

test("alongside share targets are labeled Save and Quick Save", () => {
  const source = shareIntakeKotlin('com.axolet.ordo');
  assert.match(source, /LABEL = "Quick Save"/);
  assert.match(source, /DEFAULT_ALIAS = "com\.axolet\.ordo\.ShareReceiverDefault"/);
  assert.match(source, /SAVE_ALIAS = "com\.axolet\.ordo\.ShareReceiverSave"/);
  assert.match(source, /setEnabled\(context, DEFAULT_ALIAS, !alongside && !sidecarExists\(context, BOOKMARK_FILE\)\)/);
  assert.match(source, /setEnabled\(context, SAVE_ALIAS, alongside\)/);
  assert.match(source, /QuickShareReceiverActivity::class\.java\.name, quick/);

  const save = shareReceiverAlias(SHARE_RECEIVER_SAVE_ALIAS, {
    'android:label': SAVE_SHARE_LABEL,
    'android:enabled': 'false',
  });
  assert.equal(save.$['android:label'], 'Save');
  assert.equal(save.$['android:targetActivity'], '.ShareReceiverActivity');

  const quick = shareReceiverActivity('.QuickShareReceiverActivity', {
    'android:label': QUICK_SHARE_LABEL,
    'android:enabled': 'false',
  });
  assert.equal(quick.$['android:label'], 'Quick Save');
  assert.equal(
    quick['intent-filter'][0].category[0].$['android:name'],
    'android.intent.category.DEFAULT',
  );

  const receiver = shareReceiverActivity('.ShareReceiverActivity', {}, { intentFilter: false });
  assert.equal(receiver['intent-filter'], undefined);
  assert.equal(SHARE_RECEIVER_DEFAULT_ALIAS, '.ShareReceiverDefault');
});

test("share intake publishes a sharing shortcut so Android 11+ can show both actions", () => {
  const source = shareIntakeKotlin('com.axolet.ordo');
  const category = quickShareCategory('com.axolet.ordo');
  assert.match(source, /ShortcutManager/);
  assert.match(source, /pushDynamicShortcut|addDynamicShortcuts/);
  assert.match(source, new RegExp(`SHORTCUT_ID = "${QUICK_SHARE_SHORTCUT_ID}"`));
  assert.match(source, new RegExp(`CATEGORY = "${category.replace(/\./g, '\\.')}"`));
  assert.match(source, /QuickShareReceiverActivity::class\.java/);
  assert.match(source, /ACTION_SEND/);
  assert.match(source, /BOOKMARK_FILE/);
  assert.match(source, /postDelayed/);
  assert.match(source, /filesDir/);
  assert.match(source, /cacheDir/);
});

test("shortcuts.xml points the Quick Save share-target at the quick activity", () => {
  const xml = shortcutsXml('com.axolet.ordo');
  assert.match(xml, /com\.axolet\.ordo\.QuickShareReceiverActivity/);
  assert.match(xml, /android:mimeType="text\/plain"/);
  assert.match(xml, new RegExp(quickShareCategory('com.axolet.ordo').replace(/\./g, '\\.')));
});

test("share receivers hand off to ShareIntake so Quick Save can stay off-screen", () => {
  const share = shareReceiverKotlin('com.axolet.ordo');
  const quick = quickShareReceiverKotlin('com.axolet.ordo');
  assert.match(share, /ShareIntake\.handleIncoming\(this, false\)/);
  assert.match(quick, /ShareIntake\.handleIncoming\(this, true\)/);
  assert.doesNotMatch(share, /markQuick/);
});

test("Quick Save posts from the translucent activity using EncryptedSharedPreferences", () => {
  const source = quickShareSaveKotlin('com.axolet.ordo');
  assert.match(source, /package com\.axolet\.ordo/);
  assert.match(source, /\/api\/bookmarks/);
  assert.match(source, /\/api\/auth\/refresh/);
  assert.match(source, /x-client-type/);
  assert.match(source, /x-refresh-token/);
  assert.match(source, /Saved to Bookmarks/);
  assert.match(source, /Sign in to save bookmarks/);
  assert.match(source, /ShareSessionStore\.read/);
  assert.match(source, /ShareSessionStore\.write/);
  assert.doesNotMatch(source, /writeSidecar/);
  assert.match(source, /Theme\.Translucent|forwardToMain/);
  assert.match(source, /https\?:\/\//);
});

test("Quick Save session lives in EncryptedSharedPreferences, not files/cache", () => {
  const store = shareSessionStoreKotlin('com.axolet.ordo');
  assert.match(store, /EncryptedSharedPreferences\.create/);
  assert.match(store, /MasterKey\.Builder/);
  assert.match(store, new RegExp(`PREFS_NAME = "${QUICK_SHARE_SESSION_PREFS}"`));
  assert.match(store, new RegExp(`KEY = "${QUICK_SHARE_SESSION_KEY}"`));
  assert.match(store, new RegExp(`LEGACY_FILE = "${QUICK_SHARE_SESSION_FILE}"`));
  assert.match(store, /deleteLegacyFiles/);
  assert.doesNotMatch(store, /writeText/);

  const bridge = ordoShareSessionModuleKotlin('com.axolet.ordo');
  assert.match(bridge, /class OrdoShareSessionPackage/);
  assert.match(bridge, /getName\(\): String = "OrdoShareSession"/);
  assert.match(bridge, /ShareSessionStore\.read/);
  assert.match(bridge, /ShareSessionStore\.write/);
  assert.match(bridge, /ShareSessionStore\.clear/);
});

test("app Gradle pulls androidx.security-crypto for the session store", () => {
  const gradle = [
    'dependencies {',
    '    implementation("com.facebook.react:react-android")',
    '}',
  ].join('\n');
  const patched = applySecurityCrypto(gradle);
  assert.match(patched, new RegExp(SECURITY_CRYPTO.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  assert.equal(applySecurityCrypto(patched), patched);
});

test("backup rules keep SecureStore and the Quick Save session off Auto Backup", () => {
  assert.equal(BACKUP_RULES_FILE, 'ordo_backup_rules');
  assert.equal(DATA_EXTRACTION_RULES_FILE, 'ordo_data_extraction_rules');
  assert.match(BACKUP_RULES_XML, /path="SecureStore"/);
  assert.match(BACKUP_RULES_XML, new RegExp(`path="${QUICK_SHARE_SESSION_PREFS}"`));
  assert.match(BACKUP_RULES_XML, new RegExp(`path="${QUICK_SHARE_SESSION_FILE}"`));
  assert.match(DATA_EXTRACTION_RULES_XML, /cloud-backup/);
  assert.match(DATA_EXTRACTION_RULES_XML, /device-transfer/);
  assert.match(DATA_EXTRACTION_RULES_XML, new RegExp(`path="${QUICK_SHARE_SESSION_PREFS}"`));
});

test("MainActivity syncs the disabled Quick Bookmark target on create and pause", () => {
  const patched = patchMainActivityForShareTargets(KOTLIN_ACTIVITY, 'kt');
  assert.match(patched, /ShareIntake\.watchAndSync\(this\)/);
  assert.match(patched, /override fun onPause\(\)/);
  assert.equal(patched.split('ShareIntake.watchAndSync(this)').length - 1, 2);
  assert.equal(patchMainActivityForShareTargets(patched, 'kt'), patched);
});

test("patches Java MainActivity for the Quick Bookmark target", () => {
  const patched = patchMainActivityForShareTargets(JAVA_ACTIVITY, 'java');
  assert.match(patched, /ShareIntake\.watchAndSync\(this\);/);
  assert.match(patched, /public void onPause\(\)/);
});

const KOTLIN_APPLICATION = `class MainApplication : Application(), ReactApplication {
  override val reactNativeHost: ReactNativeHost = ReactNativeHostWrapper(
        this,
        object : DefaultReactNativeHost(this) {
          override fun getPackages(): List<ReactPackage> {
            val packages = PackageList(this).packages
            return packages
          }
      }
  )
}
`;

const JAVA_APPLICATION = `public class MainApplication extends Application implements ReactApplication {
  protected List<ReactPackage> getPackages() {
    List<ReactPackage> packages = new PackageList(this).getPackages();
    return packages;
  }
}
`;

const EXPO57_APPLICATION = `class MainApplication : Application(), ReactApplication {
  override val reactHost: ReactHost by lazy {
    ExpoReactHostFactory.getDefaultReactHost(
      context = applicationContext,
      packageList =
        PackageList(this).packages.apply {
          // Packages that cannot be autolinked yet can be added manually here, for example:
          // add(MyReactNativePackage())
        }
    )
  }
}
`;

test("MainApplication registers the EncryptedSharedPreferences session module", () => {
  const patched = patchMainApplicationForShareSession(KOTLIN_APPLICATION, 'kt');
  assert.match(patched, /packages\.add\(OrdoShareSessionPackage\(\)\)/);
  assert.equal(patchMainApplicationForShareSession(patched, 'kt'), patched);
});

test("patches Expo 57 MainApplication packageList.apply for the session module", () => {
  const patched = patchMainApplicationForShareSession(EXPO57_APPLICATION, 'kt');
  assert.match(patched, /add\(OrdoShareSessionPackage\(\)\)/);
  assert.doesNotMatch(patched, /packages\.add\(OrdoShareSessionPackage\(\)\)/);
  assert.equal(patchMainApplicationForShareSession(patched, 'kt'), patched);
});

test("patches Java MainApplication for the session module", () => {
  const patched = patchMainApplicationForShareSession(JAVA_APPLICATION, 'java');
  assert.match(patched, /packages\.add\(new OrdoShareSessionPackage\(\)\);/);
});
