/** EncryptedSharedPreferences store + RN bridge for the Quick Save session. */

const QUICK_SHARE_SESSION_FILE = 'ordo-quick-share-session';
const QUICK_SHARE_SESSION_PREFS = 'ordo_quick_share_session';
const QUICK_SHARE_SESSION_KEY = 'session';
const SECURITY_CRYPTO = 'androidx.security:security-crypto:1.1.0-alpha06';

function shareSessionStoreKotlin(packageName) {
  return `package ${packageName}

import android.content.Context
import android.content.SharedPreferences
import androidx.security.crypto.EncryptedSharedPreferences
import androidx.security.crypto.MasterKey
import java.io.File

/**
 * Keystore-backed sidecar for Quick Save. JS also keeps the full session in
 * expo-secure-store; this copy is what the translucent receiver can read
 * without launching React. Leftover plaintext files from older builds are
 * migrated in on first read and deleted after every write.
 */
internal object ShareSessionStore {
  const val PREFS_NAME = "${QUICK_SHARE_SESSION_PREFS}"
  const val KEY = "${QUICK_SHARE_SESSION_KEY}"
  const val LEGACY_FILE = "${QUICK_SHARE_SESSION_FILE}"

  @Volatile private var cached: SharedPreferences? = null
  private val lock = Any()

  @JvmStatic
  fun read(context: Context): String? {
    try {
      val stored = prefs(context).getString(KEY, null)
      if (!stored.isNullOrEmpty()) {
        deleteLegacyFiles(context)
        return stored
      }
    } catch (_: Exception) {
    }
    val legacy = readLegacyFiles(context) ?: return null
    try {
      write(context, legacy)
    } catch (_: Exception) {
    }
    return legacy
  }

  @JvmStatic
  fun write(context: Context, json: String) {
    prefs(context).edit().putString(KEY, json).commit()
    deleteLegacyFiles(context)
  }

  @JvmStatic
  fun clear(context: Context) {
    try {
      prefs(context).edit().remove(KEY).commit()
    } catch (_: Exception) {
    }
    deleteLegacyFiles(context)
  }

  private fun prefs(context: Context): SharedPreferences {
    cached?.let { return it }
    synchronized(lock) {
      cached?.let { return it }
      val app = context.applicationContext
      val masterKey = MasterKey.Builder(app)
        .setKeyScheme(MasterKey.KeyScheme.AES256_GCM)
        .build()
      val created = EncryptedSharedPreferences.create(
        app,
        PREFS_NAME,
        masterKey,
        EncryptedSharedPreferences.PrefKeyEncryptionScheme.AES256_SIV,
        EncryptedSharedPreferences.PrefValueEncryptionScheme.AES256_GCM
      )
      cached = created
      return created
    }
  }

  private fun readLegacyFiles(context: Context): String? {
    val files = File(context.filesDir, LEGACY_FILE)
    if (files.exists()) {
      val text = files.readText()
      if (text.isNotBlank()) return text
    }
    val cache = File(context.cacheDir, LEGACY_FILE)
    if (cache.exists()) {
      val text = cache.readText()
      if (text.isNotBlank()) return text
    }
    return null
  }

  private fun deleteLegacyFiles(context: Context) {
    File(context.filesDir, LEGACY_FILE).delete()
    File(context.cacheDir, LEGACY_FILE).delete()
  }
}
`;
}

function ordoShareSessionModuleKotlin(packageName) {
  return `package ${packageName}

import com.facebook.react.ReactPackage
import com.facebook.react.bridge.NativeModule
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod
import com.facebook.react.uimanager.ViewManager

class OrdoShareSessionPackage : ReactPackage {
  override fun createNativeModules(reactContext: ReactApplicationContext): List<NativeModule> {
    return listOf(OrdoShareSessionModule(reactContext))
  }

  override fun createViewManagers(reactContext: ReactApplicationContext): List<ViewManager<*, *>> {
    return emptyList()
  }
}

class OrdoShareSessionModule(reactContext: ReactApplicationContext) :
  ReactContextBaseJavaModule(reactContext) {
  override fun getName(): String = "OrdoShareSession"

  @ReactMethod
  fun get(promise: Promise) {
    try {
      promise.resolve(ShareSessionStore.read(reactApplicationContext))
    } catch (e: Exception) {
      promise.reject("ERR_SHARE_SESSION", e)
    }
  }

  @ReactMethod
  fun set(json: String, promise: Promise) {
    try {
      ShareSessionStore.write(reactApplicationContext, json)
      promise.resolve(null)
    } catch (e: Exception) {
      promise.reject("ERR_SHARE_SESSION", e)
    }
  }

  @ReactMethod
  fun clear(promise: Promise) {
    try {
      ShareSessionStore.clear(reactApplicationContext)
      promise.resolve(null)
    } catch (e: Exception) {
      promise.reject("ERR_SHARE_SESSION", e)
    }
  }

  @ReactMethod
  fun moveTaskToBack(promise: Promise) {
    try {
      val activity = reactApplicationContext.currentActivity
      activity?.moveTaskToBack(true)
      promise.resolve(null)
    } catch (e: Exception) {
      promise.reject("ERR_SHARE_SESSION", e)
    }
  }
}
`;
}

module.exports = {
  QUICK_SHARE_SESSION_FILE,
  QUICK_SHARE_SESSION_PREFS,
  QUICK_SHARE_SESSION_KEY,
  SECURITY_CRYPTO,
  shareSessionStoreKotlin,
  ordoShareSessionModuleKotlin,
};
