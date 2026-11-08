/** Kotlin source for the off-screen Android Quick Save activity helper. */
module.exports = function quickShareSaveKotlin(packageName) {
  return `package ${packageName}

import android.app.Activity
import android.content.Context
import android.content.Intent
import android.os.Build
import android.os.Handler
import android.os.Looper
import android.view.HapticFeedbackConstants
import android.widget.Toast
import org.json.JSONArray
import org.json.JSONObject
import okhttp3.HttpUrl.Companion.toHttpUrlOrNull
import java.net.HttpURLConnection
import java.net.URL

/**
 * Save shared URLs from the translucent receiver without launching React.
 * Falls back to MainActivity when the network is unreachable so the JS sheet
 * can retry. Auth failures stay off-screen (toast + finish).
 */
internal object QuickShareSave {
  private const val CONNECT_MS = 8000
  private const val READ_MS = 12000
  private const val REFRESH_LEAD_MS = 60_000L
  const val SAVED = "Saved to Bookmarks"
  const val SIGN_IN = "Sign in to save bookmarks."
  const val INVALID = "The shared text doesn't contain a valid link."
  private val main = Handler(Looper.getMainLooper())
  private val urlPattern = Regex("""https?://[^\\s<>"']+""", RegexOption.IGNORE_CASE)
  private val saveLock = Any()

  private enum class Outcome { SAVED, AUTH, FALLBACK }

  private class Session(
    val serverUrl: String,
    var accessToken: String,
    var refreshToken: String,
    var accessExpiresAt: Long?
  )

  private class Result(val outcome: Outcome, val saved: Int, val remaining: List<String>)

  @JvmStatic
  fun save(activity: Activity) {
    val urls = urlsFromIntent(activity.intent)
    if (urls.isEmpty()) {
      toast(activity, INVALID)
      activity.finish()
      return
    }
    Thread {
      // Token refresh and sequential creates belong to one batch. A second
      // receiver must read the newly rotated session rather than race it.
      val result = synchronized(saveLock) { saveUrls(activity.applicationContext, urls) }
      main.post {
        if (activity.isFinishing) return@post
        when {
          result.outcome == Outcome.SAVED -> {
            haptic(activity)
            toast(activity, if (result.saved == 1) SAVED else "\${result.saved} bookmarks saved to Bookmarks")
            activity.finish()
          }
          result.outcome == Outcome.AUTH && result.saved == 0 -> {
            toast(activity, SIGN_IN)
            activity.finish()
          }
          else -> ShareIntake.forwardToMain(activity, false, result.remaining, result.saved, true)
        }
      }
    }.start()
  }

  private fun saveUrls(context: Context, urls: List<String>): Result {
    val session = readSession(context) ?: return Result(Outcome.AUTH, 0, urls)
    var saved = 0
    for ((index, url) in urls.withIndex()) {
      val remaining = urls.drop(index)
      try {
        var usedRefresh = false
        if (needsRefresh(session)) {
          if (!refresh(context, session)) return Result(Outcome.AUTH, saved, remaining)
          usedRefresh = true
        }
        var created = createBookmark(session, url)
        if (created == 401 && !usedRefresh) {
          if (!refresh(context, session)) return Result(Outcome.AUTH, saved, remaining)
          created = createBookmark(session, url)
        }
        if (created == 401) return Result(Outcome.AUTH, saved, remaining)
        if (created != 200 && created != 201) return Result(Outcome.FALLBACK, saved, remaining)
        saved++
      } catch (_: Exception) {
        return Result(Outcome.FALLBACK, saved, remaining)
      }
    }
    return Result(Outcome.SAVED, saved, emptyList())
  }

  private fun needsRefresh(session: Session): Boolean {
    val expires = session.accessExpiresAt ?: return true
    return expires - System.currentTimeMillis() <= REFRESH_LEAD_MS
  }

  private fun refresh(context: Context, session: Session): Boolean {
    val headers = HashMap<String, String>()
    headers.put("x-client-type", "mobile")
    headers.put("x-refresh-token", session.refreshToken)
    val res = request(session.serverUrl + "/api/auth/refresh", "POST", null, headers)
    if (res.code == 401) return false
    if (res.code < 200 || res.code > 299) throw RuntimeException("refresh failed")
    val tokens = JSONObject(res.body).getJSONObject("tokens")
    session.accessToken = tokens.getString("accessToken")
    session.refreshToken = tokens.getString("refreshToken")
    val expiresIn = tokens.optInt("expiresIn", 0)
    session.accessExpiresAt = System.currentTimeMillis() + expiresIn * 1000L
    writeSession(context, session)
    return true
  }

  private fun createBookmark(session: Session, url: String): Int {
    val body = JSONObject()
      .put("url", url)
      .put("folderId", JSONObject.NULL)
      .put("tagIds", JSONArray())
      .toString()
    val headers = HashMap<String, String>()
    headers.put("x-client-type", "mobile")
    headers.put("Authorization", "Bearer " + session.accessToken)
    return request(session.serverUrl + "/api/bookmarks", "POST", body, headers).code
  }

  private class HttpResult(val code: Int, val body: String)

  private fun request(
    url: String,
    method: String,
    body: String?,
    headers: Map<String, String>
  ): HttpResult {
    val conn = URL(url).openConnection() as HttpURLConnection
    try {
      conn.requestMethod = method
      conn.connectTimeout = CONNECT_MS
      conn.readTimeout = READ_MS
      conn.useCaches = false
      conn.doInput = true
      conn.instanceFollowRedirects = true
      for (entry in headers.entries) {
        conn.setRequestProperty(entry.key, entry.value)
      }
      if (body != null) {
        val bytes = body.toByteArray(Charsets.UTF_8)
        conn.doOutput = true
        conn.setRequestProperty("Content-Type", "application/json; charset=utf-8")
        conn.outputStream.use { it.write(bytes) }
      }
      val code = conn.responseCode
      val stream = if (code >= 200 && code < 300) conn.inputStream else conn.errorStream
      val text = stream?.bufferedReader()?.use { it.readText() } ?: ""
      return HttpResult(code, text)
    } finally {
      conn.disconnect()
    }
  }

  private fun readSession(context: Context): Session? {
    val raw = ShareSessionStore.read(context) ?: return null
    return try {
      val json = JSONObject(raw)
      val server = json.optString("serverUrl").trim().trimEnd('/')
      val access = json.optString("accessToken")
      val refreshToken = json.optString("refreshToken")
      if (server.isEmpty() || access.isEmpty() || refreshToken.isEmpty()) return null
      val expires = if (json.isNull("accessExpiresAt")) null else json.optLong("accessExpiresAt")
      Session(server, access, refreshToken, if (expires != null && expires > 0L) expires else null)
    } catch (_: Exception) {
      null
    }
  }

  private fun writeSession(context: Context, session: Session) {
    val json = JSONObject()
      .put("serverUrl", session.serverUrl)
      .put("accessToken", session.accessToken)
      .put("refreshToken", session.refreshToken)
      .put("updatedAt", System.currentTimeMillis())
    if (session.accessExpiresAt != null) json.put("accessExpiresAt", session.accessExpiresAt as Long)
    else json.put("accessExpiresAt", JSONObject.NULL)
    ShareSessionStore.write(context, json.toString())
  }

  @JvmStatic
  @Suppress("DEPRECATION")
  fun urlsFromIntent(intent: Intent): List<String> {
    val urls = LinkedHashMap<String, String>()
    fun add(text: String?) {
      for (url in extractSharedUrls(text)) urls.putIfAbsent(urlKey(url) ?: continue, url)
    }
    when (val text = intent.extras?.get(Intent.EXTRA_TEXT)) {
      is CharSequence -> add(text.toString())
      is Array<*> -> text.filterIsInstance<CharSequence>().forEach { add(it.toString()) }
      is Iterable<*> -> text.filterIsInstance<CharSequence>().forEach { add(it.toString()) }
    }
    when (val stream = intent.extras?.get(Intent.EXTRA_STREAM)) {
      is android.net.Uri -> add(stream.toString())
      is Array<*> -> stream.filterIsInstance<android.net.Uri>().forEach { add(it.toString()) }
      is Iterable<*> -> stream.filterIsInstance<android.net.Uri>().forEach { add(it.toString()) }
    }
    val clip = intent.clipData
    if (clip != null) {
      for (i in 0 until clip.itemCount) {
        add(clip.getItemAt(i).text?.toString())
        add(clip.getItemAt(i).uri?.toString())
      }
    }
    add(intent.data?.toString())
    return urls.values.toList()
  }

  fun extractSharedUrls(text: String?): List<String> {
    if (text.isNullOrBlank()) return emptyList()
    val urls = LinkedHashMap<String, String>()
    for (match in urlPattern.findAll(text)) {
      for (candidate in match.value.split(Regex("""[,;](?=https?://)""", RegexOption.IGNORE_CASE))) {
        var trimmed = candidate.replace(Regex("""[.,;:!?]+$"""), "")
        val pairs = arrayOf("(" to ")", "[" to "]", "{" to "}")
        for ((opening, closing) in pairs) {
          while (trimmed.endsWith(closing) && trimmed.split(closing).size > trimmed.split(opening).size) {
            trimmed = trimmed.dropLast(1)
          }
        }
        val key = urlKey(trimmed) ?: continue
        urls.putIfAbsent(key, trimmed)
      }
    }
    return urls.values.toList()
  }

  private fun urlKey(value: String): String? = try {
    val authority = Regex("""^https?://([^/?#]*)""", RegexOption.IGNORE_CASE).find(value)?.groupValues?.get(1)
    val url = value.toHttpUrlOrNull()
    if (url == null || authority.isNullOrBlank() ||
      authority.any { it.isWhitespace() || it in "<>{}|^" || it.code == 96 || it.code == 92 || it == '"' }) null
    else {
      // React Native already exposes OkHttp. Its URL parser also normalizes
      // dot segments, IDNs and Unicode paths, like the JS URL implementation.
      val host = if (url.host.contains(':')) "[" + url.host + "]" else url.host
      val port = if (url.scheme == "http" && url.port == 80 || url.scheme == "https" && url.port == 443) "" else ":" + url.port
      val path = if (url.encodedPath == "/") "" else url.encodedPath
      url.scheme + "://" + host + port + path +
        (url.encodedQuery?.let { "?" + it } ?: "") + (url.encodedFragment?.takeIf { it.isNotEmpty() }?.let { "#" + it } ?: "")
    }
  } catch (_: Exception) { null }

  private fun toast(activity: Activity, message: String) {
    Toast.makeText(activity, message, Toast.LENGTH_SHORT).show()
  }

  private fun haptic(activity: Activity) {
    val view = activity.window?.decorView ?: return
    if (Build.VERSION.SDK_INT >= 30) {
      view.performHapticFeedback(HapticFeedbackConstants.CONFIRM)
    } else {
      view.performHapticFeedback(HapticFeedbackConstants.CONTEXT_CLICK)
    }
  }
}
`;
};
