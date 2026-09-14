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
import java.net.HttpURLConnection
import java.net.URL

/**
 * Save a shared URL from the translucent receiver without launching React.
 * Falls back to MainActivity when the network is unreachable so the JS sheet
 * can retry. Auth failures stay off-screen (toast + finish).
 */
internal object QuickShareSave {
  private const val CONNECT_MS = 8000
  private const val READ_MS = 12000
  private const val REFRESH_LEAD_MS = 60_000L
  private const val SAVED = "Saved to Bookmarks"
  private const val SIGN_IN = "Sign in to save bookmarks."
  private const val INVALID = "The shared text doesn't contain a valid link."
  private val main = Handler(Looper.getMainLooper())
  private val urlPattern = Regex("https?://\\\\S+", RegexOption.IGNORE_CASE)

  private enum class Outcome { SAVED, AUTH, INVALID, FALLBACK }

  private class Session(
    val serverUrl: String,
    var accessToken: String,
    var refreshToken: String,
    var accessExpiresAt: Long?
  )

  @JvmStatic
  fun save(activity: Activity, forwardQuick: Boolean) {
    val url = extractFromIntent(activity.intent)
    if (url == null) {
      toast(activity, INVALID)
      activity.finish()
      return
    }
    Thread {
      val outcome = saveUrl(activity.applicationContext, url)
      main.post {
        if (activity.isFinishing) return@post
        when (outcome) {
          Outcome.SAVED -> {
            haptic(activity)
            toast(activity, SAVED)
            activity.finish()
          }
          Outcome.AUTH -> {
            toast(activity, SIGN_IN)
            activity.finish()
          }
          Outcome.INVALID -> {
            toast(activity, INVALID)
            activity.finish()
          }
          Outcome.FALLBACK -> ShareIntake.forwardToMain(activity, forwardQuick)
        }
      }
    }.start()
  }

  private fun saveUrl(context: Context, url: String): Outcome {
    val session = readSession(context) ?: return Outcome.FALLBACK
    var usedRefresh = false
    try {
      if (needsRefresh(session)) {
        if (!refresh(context, session)) return Outcome.AUTH
        usedRefresh = true
      }
      val created = createBookmark(session, url)
      if (created == 200 || created == 201) return Outcome.SAVED
      if (created == 401 && !usedRefresh) {
        if (!refresh(context, session)) return Outcome.AUTH
        val retried = createBookmark(session, url)
        if (retried == 200 || retried == 201) return Outcome.SAVED
        if (retried == 401) return Outcome.AUTH
      }
      if (created == 401) return Outcome.AUTH
      return Outcome.FALLBACK
    } catch (_: Exception) {
      return Outcome.FALLBACK
    }
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
    val raw = ShareIntake.readSidecar(context, ShareIntake.SESSION_FILE) ?: return null
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
    ShareIntake.writeSidecar(context, ShareIntake.SESSION_FILE, json.toString())
  }

  private fun extractFromIntent(intent: Intent): String? {
    val extras = arrayOf(
      intent.getStringExtra(Intent.EXTRA_TEXT),
      intent.getCharSequenceExtra(Intent.EXTRA_TEXT)?.toString()
    )
    for (extra in extras) {
      extractSharedUrl(extra)?.let { return it }
    }
    val clip = intent.clipData
    if (clip != null) {
      for (i in 0 until clip.itemCount) {
        extractSharedUrl(clip.getItemAt(i).text?.toString())?.let { return it }
      }
    }
    return null
  }

  fun extractSharedUrl(text: String?): String? {
    if (text.isNullOrBlank()) return null
    val match = urlPattern.find(text) ?: return null
    var trimmed = match.value.replace(Regex("[.,;:!?]+\$"), "")
    val pairs = arrayOf("(" to ")", "[" to "]", "{" to "}")
    for ((opening, closing) in pairs) {
      while (
        trimmed.endsWith(closing) &&
        trimmed.split(closing).size > trimmed.split(opening).size
      ) {
        trimmed = trimmed.dropLast(1)
      }
    }
    val lower = trimmed.lowercase()
    if (!lower.startsWith("http://") && !lower.startsWith("https://")) return null
    return trimmed
  }

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
