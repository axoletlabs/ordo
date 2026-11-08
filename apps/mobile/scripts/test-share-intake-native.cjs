/** Compile the generated Quick Save helper and forwarding method against JVM
 * Android fakes, then exercise real HTTP batch writes and intent payloads.
 * Requires Java, KOTLINC (default: kotlinc), and NATIVE_TEST_CLASSPATH containing
 * org.json, OkHttp 4.9.2 and Okio JVM jars (the app already uses OkHttp via RN).
 * This checks native logic; it is not Android device instrumentation. */
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const vm = require("node:vm");
const ts = require("typescript");
const { execFileSync } = require("node:child_process");
const plugin = require("../plugins/with-android-build");

for (const receiver of [plugin.shareReceiverActivity(".QuickShareReceiverActivity"), plugin.shareReceiverAlias(".ShareReceiverDefault"), plugin.shareReceiverAlias(".ShareReceiverSave")]) {
  const filter = receiver["intent-filter"][0];
  assert(filter.action.some(action => action.$["android:name"] === "android.intent.action.SEND_MULTIPLE"));
  assert.equal(filter.data[0].$["android:mimeType"], "text/*");
}
assert(plugin.shortcutsXml("test.ordo").includes('android:mimeType="text/*"'));
const intakeSource = plugin.shareIntakeKotlin("test.ordo");
const forward = intakeSource.slice(intakeSource.indexOf("  @JvmStatic\n  fun forwardToMain("), intakeSource.indexOf("  @JvmStatic\n  fun watchAndSync("));
assert(forward.includes('urls.joinToString("\\n")'), "the generated Kotlin must join with actual newline separators");

const exported = {};
vm.runInNewContext(ts.transpileModule(fs.readFileSync(path.join(__dirname, "../src/lib/shared-url.ts"), "utf8"), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText, { exports: exported, require, URL });
const fixtures = [
  "Read https://one.example/a and https://two.example/b",
  "https://one.example,https://two.example;https://three.example",
  "https://ONE.example:443/ https://one.example# https://one.example/?q=2",
  "[Read](https://one.example/wiki/Thing_(detail)). <https://two.example/a?x=1&y=2#part>",
  "https://one.example/?next=https://two.example/a",
  "bad https:// https://?x ftp://one.example then https://two.example",
  "https://one.example/a/../b https://one.example/b",
  "https://münich.example/café https://xn--mnich-kva.example/caf%C3%A9",
  "https://one.example:99999 https://two.example",
  "no links",
].map(text => ({ text, expected: exported.extractSharedUrls(null, text) }));

const sources = {
  "QuickShareSave.kt": plugin.quickShareSaveKotlin("test.ordo"),
  "ShareIntake.kt": `package test.ordo
import android.app.Activity
import android.content.Intent
import org.json.JSONObject
import java.io.File
internal object ShareIntake {
  const val FLAG_FILE = "ordo-quick-share"
${forward}
}
class MainActivity
object ShareSessionStore {
  var raw: String? = null
  fun read(context: android.content.Context) = raw
  fun write(context: android.content.Context, value: String) { raw = value }
}
`,
  "Context.kt": `package android.content
import android.net.Uri
import android.os.Bundle
import java.io.File
open class Context {
  val applicationContext: Context get() = this
  val cacheDir: File = File(System.getProperty("java.io.tmpdir"), "ordo-share-" + System.nanoTime()).apply { mkdirs() }
}
class Intent() {
  constructor(context: Context, target: Class<*>) : this()
  var action: String? = null
  var type: String? = null
  var data: Uri? = null
  var clipData: ClipData? = null
  var extras: Bundle? = Bundle()
  fun putExtra(name: String, value: Any): Intent { extras!!.values[name] = value; return this }
  fun getCharSequenceExtra(name: String) = extras?.get(name) as? CharSequence
  fun addFlags(flags: Int) = this
  companion object {
    const val ACTION_SEND = "android.intent.action.SEND"
    const val ACTION_SEND_MULTIPLE = "android.intent.action.SEND_MULTIPLE"
    const val EXTRA_TEXT = "android.intent.extra.TEXT"
    const val EXTRA_STREAM = "android.intent.extra.STREAM"
    const val EXTRA_TITLE = "android.intent.extra.TITLE"
    const val FLAG_ACTIVITY_NEW_TASK = 1
    const val FLAG_ACTIVITY_CLEAR_TOP = 2
    const val FLAG_ACTIVITY_SINGLE_TOP = 4
  }
}
class ClipData(val items: List<Item>) {
  val itemCount get() = items.size
  fun getItemAt(index: Int) = items[index]
  class Item(val text: CharSequence? = null, val uri: Uri? = null)
}
`,
  "Activity.kt": `package android.app
import android.content.Context
import android.content.Intent
import java.util.concurrent.CountDownLatch
open class Activity : Context() {
  var intent = Intent()
  var isFinishing = false
  val window: android.view.Window? = android.view.Window()
  val done = CountDownLatch(1)
  var forwarded: Intent? = null
  fun finish() { isFinishing = true; done.countDown() }
  fun startActivity(intent: Intent) { forwarded = intent }
}
`,
  "OS.kt": `package android.os
object Build { object VERSION { const val SDK_INT = 36 } }
class Looper { companion object { fun getMainLooper() = Looper() } }
class Handler(looper: Looper) { fun post(callback: () -> Unit) { callback() } }
class Bundle {
  val values = mutableMapOf<String, Any>()
  fun get(name: String): Any? = values[name]
}
`,
  "Uri.kt": `package android.net
class Uri(private val value: String) {
  override fun toString() = value
  companion object { fun parse(value: String) = Uri(value) }
}
`,
  "View.kt": `package android.view
object HapticFeedbackConstants { const val CONFIRM = 1; const val CONTEXT_CLICK = 2 }
class View { fun performHapticFeedback(value: Int) = true }
class Window { val decorView = View() }
`,
  "Toast.kt": `package android.widget
import android.app.Activity
class Toast(private val text: String) {
  fun show() { messages.add(text) }
  companion object {
    const val LENGTH_SHORT = 0
    val messages = mutableListOf<String>()
    fun makeText(activity: Activity, text: String, length: Int) = Toast(text)
  }
}
`,
  "Check.kt": `package test.ordo
import android.app.Activity
import android.content.Intent
import android.content.ClipData
import android.net.Uri
import android.widget.Toast
import com.sun.net.httpserver.HttpServer
import java.io.File
import java.net.InetSocketAddress
import java.net.URI
import java.net.IDN
import java.util.concurrent.TimeUnit
import org.json.JSONArray
import org.json.JSONObject

fun canonical(raw: String): String {
  val uri = URI(raw).normalize()
  // JS uses the URL standard (IDN + percent encoding). Match that for comparison.
  val url = java.net.URL(uri.toString())
  val host = IDN.toASCII(url.host).lowercase()
  val port = if (url.port == -1 || url.protocol == "https" && url.port == 443 || url.protocol == "http" && url.port == 80) "" else ":" + url.port
  val path = if (url.path == "/") "" else url.path
  return (url.protocol.lowercase() + "://" + host + port + path +
    (url.query?.let { "?" + it } ?: "") + (url.ref?.takeIf { it.isNotEmpty() }?.let { "#" + it } ?: ""))
    .toByteArray(Charsets.UTF_8).joinToString("") { byte ->
      val value = byte.toInt() and 255
      if (value >= 128) "%%%02X".format(value) else value.toChar().toString()
    }
}
fun main(args: Array<String>) {
  val fixtures = JSONArray(File(args[0]).readText())
  for (index in 0 until fixtures.length()) {
    val fixture = fixtures.getJSONObject(index)
    val actual = QuickShareSave.extractSharedUrls(fixture.getString("text")).map(::canonical)
    val expectedArray = fixture.getJSONArray("expected")
    val expected = (0 until expectedArray.length()).map { canonical(expectedArray.getString(it)) }
    check(actual == expected) { "Parser mismatch for " + fixture.getString("text") + ": " + actual + " != " + expected }
  }
  val intent = Intent().apply {
    action = Intent.ACTION_SEND_MULTIPLE
    putExtra(Intent.EXTRA_TEXT, arrayListOf("Title: https://one.example", "https://two.example https://ONE.example:443/"))
    putExtra(Intent.EXTRA_STREAM, arrayListOf(Uri.parse("https://three.example"), Uri.parse("content://ignore")))
    clipData = ClipData(listOf(ClipData.Item("https://two.example"), ClipData.Item(uri = Uri.parse("https://four.example"))))
    data = Uri.parse("https://five.example")
  }
  check(QuickShareSave.urlsFromIntent(intent).map(::canonical) == (1..5).map { "https://" + listOf("one", "two", "three", "four", "five")[it - 1] + ".example" })
  intent.putExtra(Intent.EXTRA_TEXT, arrayOf("https://six.example", "https://seven.example"))
  check(QuickShareSave.urlsFromIntent(intent).size == 6)

  val requested = mutableListOf<String>()
  var failAt = -1
  var refreshes = 0
  val server = HttpServer.create(InetSocketAddress("127.0.0.1", 0), 0)
  server.createContext("/api/bookmarks") { exchange ->
    requested.add(JSONObject(exchange.requestBody.bufferedReader().readText()).getString("url"))
    val code = if (requested.size == failAt) 503 else 201
    val bytes = "{}".toByteArray()
    exchange.sendResponseHeaders(code, bytes.size.toLong())
    exchange.responseBody.use { it.write(bytes) }
  }
  server.createContext("/api/auth/refresh") { exchange ->
    refreshes++
    val bytes = """{"tokens":{"accessToken":"new-access","refreshToken":"new-refresh","expiresIn":3600}}""".toByteArray()
    exchange.sendResponseHeaders(200, bytes.size.toLong())
    exchange.responseBody.use { it.write(bytes) }
  }
  server.start()
  val activities = mutableListOf<Activity>()
  try {
    fun session(expired: Boolean = false) {
      ShareSessionStore.raw = JSONObject().put("serverUrl", "http://127.0.0.1:" + server.address.port)
        .put("accessToken", "access").put("refreshToken", "refresh")
        .put("accessExpiresAt", if (expired) 1 else System.currentTimeMillis() + 3600000).toString()
    }
    fun save(): Activity {
      val activity = Activity().apply {
        this.intent.putExtra(Intent.EXTRA_TEXT, "https://one.example https://two.example https://three.example https://one.example/")
        this.intent.clipData = ClipData(listOf(ClipData.Item("https://one.example")))
      }
      activities.add(activity)
      QuickShareSave.save(activity)
      check(activity.done.await(10, TimeUnit.SECONDS)) { "Native batch did not settle" }
      return activity
    }
    session(true)
    val success = save()
    check(requested.size == 3 && success.forwarded == null) {
      "Expected 3 native writes; got " + requested + ", refreshes=" + refreshes +
        ", fallback=" + success.forwarded?.getCharSequenceExtra(Intent.EXTRA_TEXT) + ", toast=" + Toast.messages.lastOrNull()
    }
    check(refreshes == 1) { "Refresh once for the batch, not every item" }
    check(JSONObject(ShareSessionStore.raw!!).getString("refreshToken") == "new-refresh")
    check(Toast.messages.last() == "3 bookmarks saved to Bookmarks")
    requested.clear(); failAt = 2; session()
    val partial = save()
    val payload = partial.forwarded!!
    check(requested.size == 2) { "Stop at first failed write" }
    check(payload.action == Intent.ACTION_SEND && payload.type == "text/plain")
    check(payload.getCharSequenceExtra(Intent.EXTRA_TEXT) == "https://two.example\\nhttps://three.example")
    check(payload.clipData == null) { "Never forward already-saved links in ClipData" }
    val handoff = JSONObject(File(partial.cacheDir, ShareIntake.FLAG_FILE).readText())
    check(handoff.getBoolean("review") && handoff.getInt("savedCount") == 1)
    requested.clear(); failAt = 1
    val failed = save()
    check(QuickShareSave.urlsFromIntent(failed.forwarded!!).size == 3)
    check(JSONObject(File(failed.cacheDir, ShareIntake.FLAG_FILE).readText()).getInt("savedCount") == 0)
    requested.clear(); ShareSessionStore.raw = null
    check(save().forwarded == null && requested.isEmpty())
    check(Toast.messages.last() == QuickShareSave.SIGN_IN)
    println("PASS: generated Kotlin compiles; multi-send arrays, streams, ClipData, parser parity, token refresh, HTTP batches and unsaved-only fallback")
  } finally {
    server.stop(0)
    activities.forEach { it.cacheDir.deleteRecursively() }
  }
}
`,
};

const classpath = process.env.NATIVE_TEST_CLASSPATH;
assert(classpath, "Set NATIVE_TEST_CLASSPATH to org.json, OkHttp and Okio JVM jars");
const directory = fs.mkdtempSync(path.join(os.tmpdir(), "ordo-share-native-"));
try {
  for (const [name, source] of Object.entries(sources)) fs.writeFileSync(path.join(directory, name), source);
  const fixtureFile = path.join(directory, "fixtures.json");
  fs.writeFileSync(fixtureFile, JSON.stringify(fixtures));
  const classes = path.join(directory, "classes");
  const files = Object.keys(sources).map(name => path.join(directory, name));
  const compiler = process.env.KOTLINC || "kotlinc";
  execFileSync(compiler, [...files, "-nowarn", "-classpath", classpath, "-d", classes], { stdio: "inherit" });
  const runtime = process.env.KOTLIN_STDLIB_JAR || path.resolve(path.dirname(fs.realpathSync(
    execFileSync("which", [compiler], { encoding: "utf8" }).trim(),
  )), "../lib/kotlin-stdlib.jar");
  execFileSync("java", ["-cp", [classes, classpath, runtime].join(path.delimiter), "test.ordo.CheckKt", fixtureFile], { stdio: "inherit" });
} finally {
  fs.rmSync(directory, { recursive: true, force: true });
}
