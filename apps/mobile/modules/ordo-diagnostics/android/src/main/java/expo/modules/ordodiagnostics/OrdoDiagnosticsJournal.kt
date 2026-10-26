package expo.modules.ordodiagnostics

import android.content.Context

/** Tiny fatal-path journal. Five fixed code slots, no messages/stacks/content.
 * A synchronous commit is intentional here: React may be destroyed as soon as
 * the lifecycle observer returns. No routine interaction writes use this path. */
object OrdoDiagnosticsJournal {
  const val PREFS = "ordo_diagnostics_incidents"
  private val lock = Any()
  private var enabled = false
  private var configured = false
  private var cutoff = 0L
  private val codes = listOf("reanimated.invalid_color", "fabric.mount_failed",
    "fabric.mounting_disabled", "react.host_destroyed", "native.unrecognized")

  data class Incident(val code: String, val wallMs: Long, val count: Int)

  @JvmStatic
  fun configure(context: Context, master: Boolean, cutoffMs: Long) {
    synchronized(lock) {
      enabled = master
      val prune = !configured || cutoffMs > cutoff
      cutoff = cutoffMs
      configured = true
      try {
        val prefs = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
        if (!master) prefs.edit().clear().commit()
        else if (prune) {
          // Advancing a retention floor must preserve a recent pre-JS fatal.
          // Explicit deletion advances it to now, excluding every older slot.
          val stale = codes.indices.filter { prefs.contains("time$it") && prefs.getLong("time$it", 0L) <= cutoff }
          if (stale.isNotEmpty()) {
            val editor = prefs.edit()
            stale.forEach { editor.remove("time$it").remove("count$it") }
            editor.commit()
          }
        }
      } catch (_: Throwable) {}
    }
  }

  internal fun classify(message: String?): String {
    if (message == null || message.length > 32000) return "native.unrecognized"
    return when {
      message.contains("[Reanimated]") && message.contains("Invalid color value") -> "reanimated.invalid_color"
      message.contains("Exception thrown when executing UIFrameGuarded") -> "fabric.mount_failed"
      message.contains("Not flushing pending UI operations") -> "fabric.mounting_disabled"
      else -> "native.unrecognized"
    }
  }

  @JvmStatic
  fun record(context: Context, exception: Exception) {
    try {
      synchronized(lock) {
        if (!enabled) return
        val slot = codes.indexOf(classify(exception.message))
        val now = System.currentTimeMillis()
        if (slot < 0 || now < cutoff) return
        val prefs = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
        val previousTime = prefs.getLong("time$slot", 0L)
        // Runtime destruction can report the same exception repeatedly. Keep
        // the fatal path bounded rather than hammering disk during teardown.
        if (previousTime >= cutoff && now - previousTime in 0L..999L) return
        val fresh = previousTime >= cutoff && now - previousTime in 0L..(72L * 60 * 60 * 1000)
        val count = if (fresh) prefs.getInt("count$slot", 0).coerceIn(0, 9998) + 1 else 1
        prefs.edit().putLong("time$slot", now).putInt("count$slot", count).commit()
      }
    } catch (_: Throwable) { /* Observation must never replace the original failure. */ }
  }

  @JvmStatic
  fun read(context: Context, floor: Long, now: Long): List<Incident> {
    try {
      synchronized(lock) {
        if (!enabled) return emptyList()
        val prefs = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
        return codes.mapIndexedNotNull { index, code ->
          val time = prefs.getLong("time$index", 0L)
          if (time <= maxOf(floor, cutoff) || time > now || now - time > 72L * 60 * 60 * 1000) null
          else Incident(code, time, prefs.getInt("count$index", 1).coerceIn(1, 9999))
        }
      }
    } catch (_: Throwable) { return emptyList() }
  }
}
