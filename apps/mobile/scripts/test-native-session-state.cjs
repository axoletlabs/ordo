/** Compile the generated session store and Quick Save; exercise refresh/logout
 * ownership and real retry branches against JVM Android/HTTP fakes. */
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { shareSessionStoreKotlin } = require('../plugins/share-session-kotlin');
const quickSave = require('../plugins/quick-share-save-kotlin');
const files = {
  'Store.kt': shareSessionStoreKotlin('test.ordo'),
  'Quick.kt': quickSave('test.ordo'),
  'Context.kt': `package android.content
import java.io.File
open class Context {
  val applicationContext: Context get() = this
  val filesDir = File(System.getProperty("java.io.tmpdir"), "ordo-native-session-files").apply { mkdirs() }
  val cacheDir = File(filesDir, "cache").apply { mkdirs() }
}
interface SharedPreferences {
  fun getString(key: String, fallback: String?): String?
  fun edit(): Editor
  interface Editor { fun putString(key: String, value: String): Editor; fun remove(key: String): Editor; fun commit(): Boolean }
}
class Intent {
  companion object { const val EXTRA_TEXT = "text" }
  fun getStringExtra(key: String): String? = null
  fun getCharSequenceExtra(key: String): CharSequence? = null
  val clipData: ClipData? = null
}
class ClipData { val itemCount = 0; fun getItemAt(i: Int) = Item(); class Item { val text: CharSequence? = null } }
`,
  'Crypto.kt': `package androidx.security.crypto
import android.content.Context
import android.content.SharedPreferences
class MasterKey {
  enum class KeyScheme { AES256_GCM }
  class Builder(context: Context) { fun setKeyScheme(s: KeyScheme) = this; fun build() = MasterKey() }
}
object EncryptedSharedPreferences {
  enum class PrefKeyEncryptionScheme { AES256_SIV }
  enum class PrefValueEncryptionScheme { AES256_GCM }
  private val values = mutableMapOf<String, String>()
  fun create(c: Context, name: String, key: MasterKey, keys: PrefKeyEncryptionScheme, vals: PrefValueEncryptionScheme): SharedPreferences = object : SharedPreferences {
    override fun getString(key: String, fallback: String?) = values[key] ?: fallback
    override fun edit() = object : SharedPreferences.Editor {
      private val changes = mutableMapOf<String, String?>()
      override fun putString(key: String, value: String) = apply { changes[key] = value }
      override fun remove(key: String) = apply { changes[key] = null }
      override fun commit(): Boolean { for ((k,v) in changes) if (v == null) values.remove(k) else values[k] = v; return true }
    }
  }
}
`,
  'Activity.kt': `package android.app
import android.content.Context
import android.content.Intent
import android.view.Window
open class Activity : Context() { val intent = Intent(); val isFinishing = false; val window: Window? = Window(); fun finish() {} }
`,
  'Os.kt': `package android.os
object Build { object VERSION { const val SDK_INT = 33 } }
class Looper { companion object { fun getMainLooper() = Looper() } }
class Handler(looper: Looper) { fun post(work: () -> Unit) { work() } }
`,
  'View.kt': `package android.view
object HapticFeedbackConstants { const val CONFIRM = 1; const val CONTEXT_CLICK = 2 }
class View { fun performHapticFeedback(value: Int) = true }
class Window { val decorView = View() }
`,
  'Toast.kt': `package android.widget
import android.app.Activity
class Toast { fun show() {}; companion object { const val LENGTH_SHORT = 0; fun makeText(a: Activity, s: String, d: Int) = Toast() } }
`,
  'Json.kt': `package org.json
class JSONArray
class JSONObject {
  companion object { val NULL = Any(); val documents = mutableMapOf<String, Map<String, Any?>>() }
  private val data = mutableMapOf<String, Any?>()
  constructor()
  constructor(raw: String) { data.putAll(documents[raw] ?: error("Unknown fixture: " + raw)) }
  fun put(key: String, value: Any?) = apply { data[key] = value }
  fun getString(key: String) = data[key] as String
  fun optString(key: String) = data[key] as? String ?: ""
  fun getJSONObject(key: String) = data[key] as JSONObject
  fun optInt(key: String, fallback: Int) = (data[key] as? Number)?.toInt() ?: fallback
  fun optLong(key: String) = (data[key] as? Number)?.toLong() ?: 0L
  fun isNull(key: String) = data[key] == null || data[key] === NULL
  override fun toString(): String { val key = "fixture-" + documents.size; documents[key] = data.toMap(); return key }
}
`,
  'Check.kt': `package test.ordo
import android.app.Activity
import android.content.Context
import org.json.JSONObject
import java.net.URL
import java.net.URLStreamHandler
import java.net.HttpURLConnection
import java.io.ByteArrayInputStream
import java.io.ByteArrayOutputStream
object ShareIntake { fun forwardToMain(a: Activity, quick: Boolean) {} }
data class Reply(val code: Int, val body: String = "", val during: () -> Unit = {})
val replies = java.util.ArrayDeque<Reply>()
fun session(id: String, expires: Long = Long.MAX_VALUE): String = JSONObject()
  .put("sessionId", id).put("serverUrl", "http://test").put("accessToken", "access")
  .put("refreshToken", "refresh").put("accessExpiresAt", expires).put("updatedAt", 1L).toString()
fun main() {
  URL.setURLStreamHandlerFactory { object : URLStreamHandler() {
    override fun openConnection(url: URL) = object : HttpURLConnection(url) {
      private var reply: Reply? = null
      private fun response(): Reply { if (reply == null) { reply = replies.removeFirst(); reply!!.during() }; return reply!! }
      override fun getResponseCode() = response().code
      override fun getInputStream() = ByteArrayInputStream(response().body.toByteArray())
      override fun getErrorStream() = inputStream
      override fun getOutputStream() = ByteArrayOutputStream()
      override fun disconnect() {}; override fun connect() {}; override fun usingProxy() = false
    }
  } }
  val context = Context()
  val original = session("original")
  ShareSessionStore.write(context, original)
  ShareSessionStore.clear(context)
  check(!ShareSessionStore.replace(context, original, session("stale"))) { "refresh resurrected logout" }
  check(ShareSessionStore.read(context) == null)
  val newer = session("newer")
  ShareSessionStore.write(context, newer)
  check(!ShareSessionStore.replace(context, original, session("stale"))) { "old account replaced new account" }
  check(ShareSessionStore.read(context) == newer)
  val rotated = session("newer")
  check(ShareSessionStore.replace(context, newer, rotated))

  val method = QuickShareSave::class.java.getDeclaredMethod("saveUrl", Context::class.java, String::class.java)
  method.isAccessible = true
  val tokenBody = JSONObject().put("tokens", JSONObject().put("accessToken", "rotated-access").put("refreshToken", "rotated-refresh").put("expiresIn", 3600)).toString()
  fun outcome(vararg responses: Reply): String {
    replies.clear(); replies.addAll(responses.toList())
    return method.invoke(QuickShareSave, context, "http://saved.test/article").toString()
  }
  ShareSessionStore.write(context, session("retry"))
  check(outcome(Reply(401), Reply(200, tokenBody), Reply(503)) == "FALLBACK") { "retried 5xx was treated as auth failure" }
  check(JSONObject(ShareSessionStore.read(context)!!).optString("sessionId") == "retry")
  ShareSessionStore.write(context, session("logout-race", 1L))
  check(outcome(Reply(200, tokenBody) { ShareSessionStore.clear(context) }) == "AUTH")
  check(ShareSessionStore.read(context) == null) { "network refresh restored a cleared session" }
  ShareSessionStore.write(context, session("account-race", 1L))
  check(outcome(Reply(200, tokenBody) { ShareSessionStore.write(context, newer) }) == "AUTH")
  check(ShareSessionStore.read(context) == newer)
  ShareSessionStore.write(context, session("auth"))
  check(outcome(Reply(401), Reply(200, tokenBody), Reply(401)) == "AUTH")
  println("PASS: generated Kotlin refresh ownership, logout/account races, preserved session identity and retry outcomes")
}
`,
};
const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'ordo-native-sessions-'));
try {
  for (const [name, source] of Object.entries(files)) fs.writeFileSync(path.join(directory, name), source);
  const jar = path.join(directory, 'check.jar');
  execFileSync(process.env.KOTLINC || 'kotlinc', [...Object.keys(files).map(name => path.join(directory, name)), '-nowarn', '-include-runtime', '-d', jar], { stdio: 'inherit' });
  execFileSync('java', ['-jar', jar], { stdio: 'inherit' });
} finally {
  fs.rmSync(directory, { recursive: true, force: true });
}
