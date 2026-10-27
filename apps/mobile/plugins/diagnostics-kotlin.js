/** Native diagnostics v2: policy-gated, sanitized collectors for production.
 *
 * Two generated files:
 *  - OrdoDiagnosticsPolicy.kt: the process-wide recording policy state
 *    machine, loaded before React starts, plus lifecycle cancellation. No
 *    React imports; MainApplication installs it directly.
 *  - OrdoDiagnosticsModule.kt: the OrdoDiagnostics NativeModules contract
 *    (diagnosticsApiVersion 2), the pure (JVM-testable) parser/histogram/
 *    view-type/frame-capture types, and sanitized legacy wrappers.
 *
 * Privacy rules (docs/production-diagnostics-plan.md §4): raw logcat/ANR text,
 * exception messages, thread names, class names, tags, paths, and user strings
 * never leave native code. Own-UID, PID-scoped, time-bounded log reads are
 * parsed on a worker into the five reviewed incident templates and the raw
 * bytes are discarded immediately. */
const DIAGNOSTICS_POLICY_PREFS = 'ordo_diagnostics_policy';

function ordoDiagnosticsPolicyKotlin(packageName) {
  return `package ${packageName}

import android.app.Application
import android.content.Context
import expo.modules.ordodiagnostics.OrdoDiagnosticsJournal
import java.util.concurrent.CopyOnWriteArrayList

/** Pure policy state machine: absent preferences default recording on,
 * anything unreadable or partial fails closed. */
internal class OrdoDiagnosticsPolicyState private constructor(
  @Volatile var masterEnabled: Boolean,
  @Volatile var cutoffWallMs: Long,
  @Volatile var generation: Long,
  @Volatile var corrupt: Boolean,
) {
  fun captureAllowed(generation: Double): Boolean {
    if (corrupt || !masterEnabled) return false
    val requested = normalizeGeneration(generation)
    return requested >= 0 && requested == this.generation
  }

  /** Wall-clock floor for evidence. The persisted cutoff always wins over an
   * older request so deleted history cannot be re-imported. -1 = invalid. */
  fun evidenceFloorMs(sinceMs: Double, nowWallMs: Long): Long {
    val since = normalizeSince(sinceMs, nowWallMs)
    if (since < 0) return -1
    val floor = maxOf(since, cutoffWallMs)
    return if (floor > nowWallMs) -1 else floor
  }

  companion object {
    const val FORMAT = 1

    fun initial(): OrdoDiagnosticsPolicyState =
      OrdoDiagnosticsPolicyState(true, 0L, 0L, false)

    fun corrupt(): OrdoDiagnosticsPolicyState =
      OrdoDiagnosticsPolicyState(false, 0L, 0L, true)

    /** Every value present and well-formed, or fail closed. */
    fun fromPersisted(
      format: Int?,
      master: Boolean?,
      cutoffMs: Long?,
      generation: Long?,
    ): OrdoDiagnosticsPolicyState {
      if (format == null && master == null && cutoffMs == null && generation == null) {
        return initial()
      }
      if (format != FORMAT || master == null || cutoffMs == null || generation == null) {
        return corrupt()
      }
      if (cutoffMs < 0 || generation < 0) {
        return corrupt()
      }
      return OrdoDiagnosticsPolicyState(master, cutoffMs, generation, false)
    }

    fun normalizeGeneration(generation: Double): Long {
      if (!generation.isFinite() || generation < 0.0 || generation > 9.007199254740991e15) return -1
      val asLong = generation.toLong()
      if (asLong.toDouble() != generation) return -1
      return asLong
    }

    fun normalizeCutoff(cutoffMs: Double, nowWallMs: Long): Long {
      if (!cutoffMs.isFinite() || cutoffMs < 0.0) return -1
      if (cutoffMs > nowWallMs.toDouble() + 86400000.0) return -1
      if (cutoffMs.toLong().toDouble() != cutoffMs) return -1
      return cutoffMs.toLong().coerceAtLeast(0L)
    }

    fun normalizeSince(sinceMs: Double, nowWallMs: Long): Long {
      if (!sinceMs.isFinite() || sinceMs < 0.0) return -1
      if (sinceMs > nowWallMs.toDouble() + 60000.0) return -1
      if (sinceMs.toLong().toDouble() != sinceMs) return -1
      return sinceMs.toLong().coerceAtLeast(0L)
    }
  }
}

/** Process-wide recording policy. Installed from the generated
 * MainApplication before React starts so every entry point in this process
 * (main activity and the share receivers) shares one policy, and so the
 * master preference gates native collectors before any JS runs. */
object OrdoDiagnosticsPolicy {
  const val PREFS_NAME = "${DIAGNOSTICS_POLICY_PREFS}"
  private const val KEY_FORMAT = "format"
  private const val KEY_MASTER = "master"
  private const val KEY_CUTOFF = "cutoff"
  private const val KEY_GENERATION = "generation"

  private val lock = Any()
  private var installed = false
  @Volatile private var state: OrdoDiagnosticsPolicyState = OrdoDiagnosticsPolicyState.initial()
  @Volatile private var appContext: Context? = null
  private val captureCancellers = CopyOnWriteArrayList<(policyLevel: Boolean) -> Unit>()

  /** One-time application hookup: reads the persisted policy (a few hundred
   * bytes, before React starts, per plan section 5) and registers background
   * cancellation callbacks. */
  @JvmStatic
  fun install(app: Application) {
    synchronized(lock) {
      if (installed) return
      val appContext = app.applicationContext
      this.appContext = appContext
      state = loadPolicy(appContext)
      OrdoDiagnosticsJournal.configure(appContext, state.masterEnabled && !state.corrupt, state.cutoffWallMs)
      try {
        app.registerActivityLifecycleCallbacks(HostLifecycle)
      } catch (_: Throwable) {
        // Without lifecycle callbacks, captures still end by their own
        // bounded deadlines; this is degraded, not unsafe.
      }
      installed = true
    }
  }

  /** Fallback for module creation when the generated hook did not run. */
  @JvmStatic
  fun ensure(context: Context) {
    synchronized(lock) {
      if (installed) return
      val app = context.applicationContext
      appContext = app
      state = loadPolicy(app)
      OrdoDiagnosticsJournal.configure(app, state.masterEnabled && !state.corrupt, state.cutoffWallMs)
      if (app is Application) {
        try {
          app.registerActivityLifecycleCallbacks(HostLifecycle)
        } catch (_: Throwable) {
        }
      }
      installed = true
    }
  }

  @JvmStatic
  internal fun snapshot(): OrdoDiagnosticsPolicyState = state

  /** Swap the in-memory state first (a disable must win even if the disk
   * write later fails) and cancel everything running under an older
   * generation. */
  @JvmStatic
  internal fun applyUpdate(
    masterEnabled: Boolean,
    cutoffWallMs: Long,
    generation: Long,
  ): OrdoDiagnosticsPolicyState {
    val next = OrdoDiagnosticsPolicyState.fromPersisted(
      OrdoDiagnosticsPolicyState.FORMAT, masterEnabled, cutoffWallMs, generation,
    )
    state = next
    appContext?.let { OrdoDiagnosticsJournal.configure(it, masterEnabled, cutoffWallMs) }
    cancelActiveCaptures(true)
    return next
  }

  /** cancelDiagnosticCapture path: advance only the runtime cancellation
   * token; the persisted master/cutoff policy is untouched. */
  @JvmStatic
  internal fun advanceGeneration(generation: Long) {
    val current = state
    val next = OrdoDiagnosticsPolicyState.fromPersisted(
      OrdoDiagnosticsPolicyState.FORMAT,
      current.masterEnabled && !current.corrupt,
      current.cutoffWallMs,
      generation,
    )
    state = next
    cancelActiveCaptures(true)
  }

  @JvmStatic
  internal fun registerCaptureCanceller(canceller: (policyLevel: Boolean) -> Unit): () -> Unit {
    captureCancellers.add(canceller)
    return { captureCancellers.remove(canceller) }
  }

  /** policyLevel=true originates from configureRecording/cancel calls and
   * resolves captures as unavailable; lifecycle stops keep partial data. */
  @JvmStatic
  internal fun cancelActiveCaptures(policyLevel: Boolean) {
    for (canceller in captureCancellers) {
      try {
        canceller(policyLevel)
      } catch (_: Throwable) {
      }
    }
  }

  /** Blocking persistence for the worker thread. Returns false when the
   * policy could not be written; the in-memory state stays applied. */
  @JvmStatic
  internal fun persist(masterEnabled: Boolean, cutoffWallMs: Long, generation: Long): Boolean {
    val context = appContext ?: return false
    return try {
      val prefs = context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
      prefs.edit()
        .putInt(KEY_FORMAT, OrdoDiagnosticsPolicyState.FORMAT)
        .putBoolean(KEY_MASTER, masterEnabled)
        .putLong(KEY_CUTOFF, cutoffWallMs)
        .putLong(KEY_GENERATION, generation)
        .commit()
    } catch (_: Throwable) {
      false
    }
  }

  private fun loadPolicy(context: Context): OrdoDiagnosticsPolicyState {
    return try {
      val prefs = context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
      val hasFormat = prefs.contains(KEY_FORMAT)
      val hasMaster = prefs.contains(KEY_MASTER)
      val hasCutoff = prefs.contains(KEY_CUTOFF)
      val hasGeneration = prefs.contains(KEY_GENERATION)
      if (!hasFormat && !hasMaster && !hasCutoff && !hasGeneration) {
        OrdoDiagnosticsPolicyState.initial()
      } else {
        OrdoDiagnosticsPolicyState.fromPersisted(
          if (hasFormat) prefs.getInt(KEY_FORMAT, -1) else null,
          if (hasMaster) prefs.getBoolean(KEY_MASTER, false) else null,
          if (hasCutoff) prefs.getLong(KEY_CUTOFF, -1L) else null,
          if (hasGeneration) prefs.getLong(KEY_GENERATION, -1L) else null,
        )
      }
    } catch (_: Throwable) {
      OrdoDiagnosticsPolicyState.corrupt()
    }
  }

  private object HostLifecycle : Application.ActivityLifecycleCallbacks {
    override fun onActivityCreated(activity: android.app.Activity, savedInstanceState: android.os.Bundle?) {}

    override fun onActivityStarted(activity: android.app.Activity) {}

    override fun onActivityResumed(activity: android.app.Activity) {}

    override fun onActivityPaused(activity: android.app.Activity) {
      cancelActiveCaptures(false)
    }

    override fun onActivityStopped(activity: android.app.Activity) {
      cancelActiveCaptures(false)
    }

    override fun onActivitySaveInstanceState(activity: android.app.Activity, outState: android.os.Bundle) {}

    override fun onActivityDestroyed(activity: android.app.Activity) {}
  }
}
`;
}

function ordoDiagnosticsModuleKotlin(packageName) {
  return `package ${packageName}

import android.app.ActivityManager
import expo.modules.ordodiagnostics.OrdoDiagnosticsJournal
import android.app.ApplicationExitInfo
import android.content.Context
import android.os.Build
import android.os.Handler
import android.os.Looper
import android.os.Process
import android.os.SystemClock
import android.view.Choreographer
import android.view.Display
import android.view.View
import android.view.ViewGroup
import android.view.Window
import java.io.ByteArrayOutputStream
import java.util.ArrayDeque
import java.util.concurrent.Executors
import java.util.concurrent.ConcurrentHashMap
import java.util.concurrent.FutureTask
import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.AtomicBoolean
import com.facebook.react.bridge.Arguments
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod
import com.facebook.react.bridge.UiThreadUtil
import com.facebook.react.bridge.WritableArray
import com.facebook.react.bridge.WritableMap

/** Fixed incident vocabulary. Nothing else is ever exposed to JS. */
internal object OrdoDiagnosticsContract {
  const val API_VERSION = 2
  const val CODE_REANIMATED_INVALID_COLOR = "reanimated.invalid_color"
  const val CODE_REACT_HOST_DESTROYED = "react.host_destroyed"
  const val CODE_FABRIC_MOUNT_FAILED = "fabric.mount_failed"
  const val CODE_FABRIC_MOUNTING_DISABLED = "fabric.mounting_disabled"
  const val CODE_NATIVE_UNRECOGNIZED = "native.unrecognized"

  val INCIDENT_CODES = setOf(
    CODE_REANIMATED_INVALID_COLOR,
    CODE_REACT_HOST_DESTROYED,
    CODE_FABRIC_MOUNT_FAILED,
    CODE_FABRIC_MOUNTING_DISABLED,
    CODE_NATIVE_UNRECOGNIZED,
  )
}

internal class OrdoIncidentHeader(
  val month: Int,
  val day: Int,
  val hour: Int,
  val minute: Int,
  val second: Int,
  val millis: Int,
  val pid: Int,
  val level: Char,
)

/** Strict two-stage parser for own-UID threadtime logcat lines. Only
 * header-shaped or marker-carrying lines survive stage one; stage two
 * classifies into reviewed template codes. Line text is never retained or
 * returned, so freeform messages, thread names, and URLs cannot leak. */
internal object OrdoIncidentLogLine {
  private val MARKERS = listOf(
    "handleHostException",
    "Invalid color value",
    "Starting React Native destruction",
    "Exception thrown when executing UIFrameGuarded",
    "Not flushing pending UI operations",
  )

  private val LEVELS = "VDIWEF"

  /** Stage one: drop lines that are neither header-shaped nor relevant. The
   * joined result is bounded by the bounded scan that produced it. */
  fun prefilter(lines: Sequence<String>): String =
    lines.filter { line -> MARKERS.any { line.contains(it) } || parseHeader(line) != null }
      .joinToString("\\n")

  /** Stage two: classify one line into a reviewed code, or null. */
  fun classify(line: String): String? {
    if (line.contains("[Reanimated]") && line.contains("Invalid color value")) {
      return OrdoDiagnosticsContract.CODE_REANIMATED_INVALID_COLOR
    }
    if (line.contains("handleHostException")) {
      return OrdoDiagnosticsContract.CODE_NATIVE_UNRECOGNIZED
    }
    if (line.contains("Starting React Native destruction")) {
      return OrdoDiagnosticsContract.CODE_REACT_HOST_DESTROYED
    }
    if (line.contains("Exception thrown when executing UIFrameGuarded")) {
      return OrdoDiagnosticsContract.CODE_FABRIC_MOUNT_FAILED
    }
    if (line.contains("Not flushing pending UI operations")) {
      return OrdoDiagnosticsContract.CODE_FABRIC_MOUNTING_DISABLED
    }
    return null
  }

  /** threadtime header: "MM-DD HH:MM:SS.mmm PID TID LEVEL TAG: message". */
  fun parseHeader(line: String): OrdoIncidentHeader? {
    val parts = line.trim().split(Regex("\\\\s+"), limit = 7)
    if (parts.size < 6) return null
    val date = parts[0]
    val time = parts[1]
    if (date.length != 5 || date[2] != '-') return null
    if (time.length != 12 || time[8] != '.') return null
    val month = date.substring(0, 2).toIntOrNull() ?: return null
    val day = date.substring(3, 5).toIntOrNull() ?: return null
    val hour = time.substring(0, 2).toIntOrNull() ?: return null
    val minute = time.substring(3, 5).toIntOrNull() ?: return null
    val second = time.substring(6, 8).toIntOrNull() ?: return null
    val millis = time.substring(9).toIntOrNull() ?: return null
    if (month < 1 || month > 12 || day < 1 || day > 31) return null
    if (hour > 23 || minute > 59 || second > 59 || millis > 999) return null
    val pid = parts[2].toIntOrNull() ?: return null
    val level = parts[4]
    if (pid < 1 || level.length != 1 || LEVELS.indexOf(level[0]) < 0) return null
    return OrdoIncidentHeader(month, day, hour, minute, second, millis, pid, level[0])
  }

  /** threadtime prints MM-DD without a year; resolve against the current
   * wall clock and step back one year across new-year boundaries. */
  fun headerWallMs(header: OrdoIncidentHeader, nowWallMs: Long): Long {
    val year = epochYear(nowWallMs)
    var wall = gregorianWallMs(year, header)
    if (wall - nowWallMs > 86400000L) {
      wall = gregorianWallMs(year - 1, header)
    }
    return wall
  }

  fun epochYear(wallMs: Long): Int {
    val calendar = java.util.Calendar.getInstance()
    calendar.timeInMillis = wallMs
    return calendar.get(java.util.Calendar.YEAR)
  }

  fun gregorianWallMs(year: Int, header: OrdoIncidentHeader): Long {
    val calendar = java.util.Calendar.getInstance()
    calendar.clear()
    calendar.set(year, header.month - 1, header.day, header.hour, header.minute, header.second)
    calendar.set(java.util.Calendar.MILLISECOND, header.millis)
    return calendar.timeInMillis
  }
}

internal class OrdoParsedIncident(val code: String, val wallMs: Long)

internal class OrdoParsedLog(val incidents: List<OrdoParsedIncident>, val omitted: Int) {
  companion object {
    /** PID- and time-scoped scan of one bounded log read. Lines from the
     * current PID before this process started are dropped: the PID belonged
     * to an older process (PID reuse). */
    fun parse(
      lines: Sequence<String>,
      allowedPid: Int,
      floorWallMs: Long,
      ceilingWallMs: Long,
      currentPid: Int,
      currentPidStartWallMs: Long,
      nowWallMs: Long,
    ): OrdoParsedLog {
      val incidents = ArrayList<OrdoParsedIncident>(8)
      var omitted = 0
      for (line in lines) {
        val header = OrdoIncidentLogLine.parseHeader(line) ?: continue
        if (header.pid != allowedPid) continue
        val wall = OrdoIncidentLogLine.headerWallMs(header, nowWallMs)
        if (wall < floorWallMs || wall > ceilingWallMs) continue
        if (header.pid == currentPid && wall < currentPidStartWallMs - 1500L) continue
        val code = OrdoIncidentLogLine.classify(line)
        if (code == null) {
          if (omitted < 100000) omitted += 1
        } else {
          incidents.add(OrdoParsedIncident(code, wall))
        }
      }
      return OrdoParsedLog(incidents, omitted)
    }
  }
}

/** Fixed-size interval histogram: 256 buckets of 0.5 ms (0..128 ms) plus an
 * overflow count. No per-frame storage; percentiles are bucket-midpoint
 * estimates, the maximum is exact, and overflow percentiles report the exact
 * maximum rather than inventing precision. */
internal class OrdoFrameHistogram {
  private val buckets = IntArray(FINE_BUCKETS + 1)
  private var maxMs = 0.0
  private var count = 0

  fun add(intervalMs: Double) {
    if (!intervalMs.isFinite() || intervalMs < 0.0) return
    count += 1
    if (intervalMs > maxMs) maxMs = intervalMs
    val index = (intervalMs / BUCKET_WIDTH_MS).toInt()
    if (index >= FINE_BUCKETS) {
      buckets[FINE_BUCKETS] += 1
    } else {
      buckets[index] += 1
    }
  }

  fun frameCount(): Int = count

  fun maxIntervalMs(): Double = if (count == 0) 0.0 else maxMs

  fun percentile(fraction: Double): Double {
    if (count == 0) return 0.0
    var rank = kotlin.math.ceil(count * fraction).toInt().coerceIn(1, count)
    for (index in 0 until FINE_BUCKETS) {
      if (rank <= buckets[index]) return (index.toDouble() + 0.5) * BUCKET_WIDTH_MS
      rank -= buckets[index]
    }
    return maxMs
  }

  companion object {
    const val FINE_BUCKETS = 256
    const val BUCKET_WIDTH_MS = 0.5
  }
}

/** Fixed view-type vocabulary for sanitized hierarchy samples. Unknown or
 * surprising class names map to bounded enums; names never reach JS. */
internal object OrdoSafeNodeTypes {
  const val ROOT = "root"
  const val SCREEN = "screen"
  const val CONTAINER = "container"
  const val TEXT = "text"
  const val WEB = "web"
  const val IMAGE = "image"
  const val OTHER = "other"

  fun classify(simpleName: String): String {
    if (simpleName.endsWith("DecorView")) return ROOT
    if (simpleName.endsWith("ReactRootView")) return ROOT
    if (simpleName.endsWith("ReactSurfaceView")) return ROOT
    if (simpleName.contains("TextureView")) return OTHER
    if (simpleName.contains("Screen")) return SCREEN
    if (simpleName.contains("WebView")) return WEB
    if (simpleName.contains("Text")) return TEXT
    if (simpleName.contains("Image")) return IMAGE
    if (simpleName.contains("ViewGroup")) return CONTAINER
    if (simpleName.contains("Layout")) return CONTAINER
    if (simpleName.contains("Pager")) return CONTAINER
    if (simpleName.contains("RecyclerView")) return CONTAINER
    if (simpleName.contains("Fragment")) return CONTAINER
    if (simpleName.contains("Modal")) return CONTAINER
    if (simpleName.contains("Dialog")) return CONTAINER
    if (simpleName.contains("Host")) return CONTAINER
    return OTHER
  }
}

internal class OrdoDisplayModeSnapshot(val modeId: Int, val refreshHz: Double)

/** Abstractions so the capture controller and its cancellation run against
 * JVM fakes as well as real Choreographer/Handler wiring. */
internal interface OrdoFrameSource {
  /** Posts the frame callback. onFrame returns whether to keep sampling. */
  fun start(onFrame: (frameTimeNanos: Long) -> Boolean): Boolean

  fun stop()
}

internal interface OrdoScheduled {
  fun cancel()
}

internal interface OrdoDeadlineScheduler {
  fun nowElapsedMs(): Long

  fun schedule(delayMs: Long, runnable: () -> Unit): OrdoScheduled
}

internal class OrdoFrameCaptureOutcome(
  val status: String,
  val durationMs: Long,
  val frameCount: Int,
  val intervalP50Ms: Double,
  val intervalP95Ms: Double,
  val intervalMaxMs: Double,
  val startModeRefreshHz: Double,
  val endModeRefreshHz: Double,
  val preferredRefreshRateHz: Double,
  val modeChanged: Boolean,
) {
  companion object {
    fun unavailable(): OrdoFrameCaptureOutcome =
      OrdoFrameCaptureOutcome("unavailable", 0L, 0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, false)
  }
}

/** One bounded main-thread cadence window. The frame callback lives only for
 * the requested duration and is removed on completion, deadline, or
 * cancellation; nothing samples outside a window. */
internal class OrdoFrameCaptureJob(
  private val frames: OrdoFrameSource,
  private val scheduler: OrdoDeadlineScheduler,
  private val modes: () -> OrdoDisplayModeSnapshot?,
) {
  private var started = false
  private var finished = false
  private var startElapsed = 0L
  private var duration = 0L
  private var preferredHz = 0.0
  private var gate: (() -> Boolean)? = null
  private var deliver: ((OrdoFrameCaptureOutcome) -> Unit)? = null
  private var histogram = OrdoFrameHistogram()
  private var lastFrameNanos = 0L
  private var startMode: OrdoDisplayModeSnapshot? = null
  private var endMode: OrdoDisplayModeSnapshot? = null
  private var modeChanged = false
  private var framesSinceModeCheck = 0
  private var deadline: OrdoScheduled? = null

  fun isFinished(): Boolean = finished

  fun start(
    durationMs: Long,
    preferredRefreshHz: Double,
    gate: () -> Boolean,
    deliver: (OrdoFrameCaptureOutcome) -> Unit,
  ) {
    if (started || finished) return
    started = true
    this.duration = durationMs
    this.preferredHz = preferredRefreshHz
    this.gate = gate
    this.deliver = deliver
    if (!gate()) {
      finish("unavailable")
      return
    }
    startElapsed = scheduler.nowElapsedMs()
    startMode = modes()
    endMode = startMode
    val posted = frames.start { frameTimeNanos -> onFrame(frameTimeNanos) }
    if (!posted) {
      finish("unavailable")
      return
    }
    deadline = scheduler.schedule(durationMs + 3000L) { finish("partial") }
  }

  private fun onFrame(frameTimeNanos: Long): Boolean {
    if (finished) return false
    if (lastFrameNanos != 0L && frameTimeNanos > lastFrameNanos) {
      histogram.add((frameTimeNanos - lastFrameNanos) / 1000000.0)
    }
    lastFrameNanos = frameTimeNanos
    framesSinceModeCheck += 1
    if (framesSinceModeCheck >= 32) {
      framesSinceModeCheck = 0
      noteMode()
    }
    if (scheduler.nowElapsedMs() - startElapsed >= duration) {
      finish("complete")
      return false
    }
    return true
  }

  private fun noteMode() {
    val mode = modes() ?: return
    endMode = mode
    val start = startMode
    if (start != null && mode.modeId != start.modeId) modeChanged = true
  }

  /** Background/lifecycle stop: keep what was measured, mark partial. */
  fun cancelFromLifecycle() {
    if (finished) return
    if (!started) {
      finished = true
      return
    }
    finish("partial")
  }

  /** Policy revoked the generation: deliver nothing measurable. */
  fun cancelFromPolicy() {
    if (finished) return
    if (!started) {
      finished = true
      deliver?.invoke(OrdoFrameCaptureOutcome.unavailable())
      deliver = null
      gate = null
      return
    }
    finish("unavailable")
  }

  private fun finish(requestedStatus: String) {
    if (finished) return
    finished = true
    frames.stop()
    deadline?.cancel()
    noteMode()
    val gateOk = gate?.invoke() ?: false
    val status = if (!gateOk) "unavailable" else requestedStatus
    val elapsed = scheduler.nowElapsedMs() - startElapsed
    if (status == "unavailable") {
      deliver?.invoke(OrdoFrameCaptureOutcome.unavailable())
    } else {
      deliver?.invoke(
        OrdoFrameCaptureOutcome(
          status,
          elapsed.coerceAtLeast(0L),
          histogram.frameCount(),
          histogram.percentile(0.50),
          histogram.percentile(0.95),
          histogram.maxIntervalMs(),
          startMode?.refreshHz ?: 0.0,
          endMode?.refreshHz ?: 0.0,
          preferredHz,
          modeChanged,
        ),
      )
    }
    deliver = null
    gate = null
  }
}

class OrdoDiagnosticsModule(context: ReactApplicationContext) :
  ReactContextBaseJavaModule(context) {

  override fun getName(): String = "OrdoDiagnostics"

  // A task swipe can recreate the React runtime without killing its process.
  // Persist this identity with each JS session to distinguish the two cases.
  private val pid = Process.myPid()
  private val pidStartElapsedMs = Process.getStartElapsedRealtime()
  private val pidStartWallMs: Long =
    System.currentTimeMillis() - SystemClock.elapsedRealtime() + pidStartElapsedMs

  private val worker = Executors.newSingleThreadExecutor { runnable ->
    Thread(runnable, "ordo-diagnostics").apply { isDaemon = true }
  }
  private val mainHandler = Handler(Looper.getMainLooper())
  @Volatile private var invalidated = false
  private val pendingUi = ConcurrentHashMap<String, PendingUiWork>()

  private inner class PendingUiWork(val key: String, val action: () -> Unit, val cancelled: () -> Unit) : Runnable {
    private val delivered = AtomicBoolean(false)
    override fun run() {
      if (!delivered.compareAndSet(false, true)) return
      pendingUi.remove(key, this)
      if (invalidated) cancelled() else action()
    }
    fun cancel() {
      mainHandler.removeCallbacks(this)
      pendingUi.remove(key, this)
      if (delivered.compareAndSet(false, true)) cancelled()
    }
  }

  private fun enqueueUi(key: String, cancelled: () -> Unit, action: () -> Unit) {
    val work = PendingUiWork(key, action, cancelled)
    if (invalidated || pendingUi.putIfAbsent(key, work) != null) { cancelled(); return }
    mainHandler.post(work)
    if (invalidated || pendingUi[key] !== work) work.cancel()
  }

  @Volatile private var frameJob: OrdoFrameCaptureJob? = null
  @Volatile private var activeScan: ActiveLogScan? = null
  private var unregisterCaptureCanceller: (() -> Unit)? = null

  init {
    OrdoDiagnosticsPolicy.ensure(reactApplicationContext.applicationContext)
    unregisterCaptureCanceller = OrdoDiagnosticsPolicy.registerCaptureCanceller { policyLevel ->
      cancelActiveCaptures(policyLevel)
    }
  }

  override fun invalidate() {
    invalidated = true
    cancelActiveCaptures(true)
    unregisterCaptureCanceller?.invoke()
    unregisterCaptureCanceller = null
    // Let queued tiny policy commits resolve; revoked scans do no further IO.
    worker.shutdown()
    super.invalidate()
  }

  override fun getConstants(): Map<String, Any> {
    val state = OrdoDiagnosticsPolicy.snapshot()
    return mapOf(
      "pid" to pid,
      "packageName" to reactApplicationContext.packageName,
      "processStartElapsedRealtime" to pidStartElapsedMs.toDouble(),
      "processStartedAt" to pidStartWallMs.toDouble(),
      "diagnosticsApiVersion" to OrdoDiagnosticsContract.API_VERSION,
      "recordingEnabled" to (state.masterEnabled && !state.corrupt),
      "cutoffTimestamp" to state.cutoffWallMs.toDouble(),
      "recordingGeneration" to state.generation.toDouble(),
    )
  }

  /** Master switch. Persists the policy, cancels every active capture, and
   * advances the generation so late callers with an older generation are
   * denied. Resolves false for invalid or stale-generation arguments or when
   * persistence fails (the in-memory policy still applies). */
  @ReactMethod
  fun configureRecording(enabled: Boolean, cutoffMs: Double, generation: Double, promise: Promise) {
    val now = System.currentTimeMillis()
    val cutoff = OrdoDiagnosticsPolicyState.normalizeCutoff(cutoffMs, now)
    val generationLong = OrdoDiagnosticsPolicyState.normalizeGeneration(generation)
    if (invalidated || cutoff < 0 || generationLong < 0 || generationLong < OrdoDiagnosticsPolicy.snapshot().generation) {
      promise.resolve(false)
      return
    }
    OrdoDiagnosticsPolicy.applyUpdate(enabled, cutoff, generationLong)
    try { worker.execute {
      val persisted = try {
        val latest = OrdoDiagnosticsPolicy.snapshot()
        if (latest.generation != generationLong || latest.masterEnabled != enabled || latest.cutoffWallMs != cutoff) false
        else OrdoDiagnosticsPolicy.persist(enabled, cutoff, generationLong)
      } catch (_: Throwable) {
        false
      }
      promise.resolve(persisted)
    } } catch (_: java.util.concurrent.RejectedExecutionException) { promise.resolve(false) }
  }

  /** Stops captures without touching the master preference. A generation at
   * least as new as the current one also invalidates older callers; a stale
   * generation is ignored (resolves false). */
  @ReactMethod
  fun cancelDiagnosticCapture(generation: Double, promise: Promise) {
    val generationLong = OrdoDiagnosticsPolicyState.normalizeGeneration(generation)
    val current = OrdoDiagnosticsPolicy.snapshot()
    if (generationLong < 0 || generationLong < current.generation) {
      promise.resolve(false)
      return
    }
    if (generationLong > current.generation) {
      OrdoDiagnosticsPolicy.advanceGeneration(generationLong)
    } else {
      OrdoDiagnosticsPolicy.cancelActiveCaptures(true)
    }
    promise.resolve(true)
  }

  /** Sanitized evidence snapshot: numeric exit history plus incidents parsed
   * from bounded own-UID log reads. Raw log or ANR text, messages, thread
   * names, and paths never cross this boundary. */
  @ReactMethod
  fun collectSafeEvidence(sinceMs: Double, generation: Double, promise: Promise) {
    val state = OrdoDiagnosticsPolicy.snapshot()
    if (invalidated || activeScan != null || !state.captureAllowed(generation)) {
      promise.resolve(unavailableEvidence())
      return
    }
    val now = System.currentTimeMillis()
    val floor = state.evidenceFloorMs(sinceMs, now)
    if (floor < 0) {
      promise.resolve(unavailableEvidence())
      return
    }
    val scan = ActiveLogScan()
    activeScan = scan
    try { worker.execute {
      val result = try {
        if (scan.revoked.get() || invalidated) unavailableEvidence() else collectEvidenceOnWorker(floor, now, scan)
      } catch (_: Throwable) {
        unavailableEvidence()
      }
      activeScan = null
      // A revocation during collection discards the evidence entirely.
      if (scan.revoked.get() || !OrdoDiagnosticsPolicy.snapshot().captureAllowed(generation)) {
        promise.resolve(unavailableEvidence())
      } else {
        promise.resolve(result)
      }
    } } catch (_: java.util.concurrent.RejectedExecutionException) { activeScan = null; promise.resolve(unavailableEvidence()) }
  }

  /** Bounded main-thread cadence window (250..60000 ms). Fixed histogram
   * aggregates only; invalid durations and closed policies do no work, and a
   * concurrent request resolves busy instead of queueing. */
  @ReactMethod
  fun captureSafeFrameStats(durationMs: Double, generation: Double, promise: Promise) {
    if (!durationMs.isFinite() || durationMs < 250.0 || durationMs > 60000.0) {
      promise.resolve(frameStatsMap("unavailable", 0L, 0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, false))
      return
    }
    if (!OrdoDiagnosticsPolicy.snapshot().captureAllowed(generation)) {
      promise.resolve(frameStatsMap("unavailable", 0L, 0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, false))
      return
    }
    if (frameJob != null) {
      promise.resolve(frameStatsMap("busy", 0L, 0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, false))
      return
    }
    enqueueUi("frames", { promise.resolve(frameStatsMap("unavailable", 0L, 0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, false)) }) {
      if (frameJob != null) {
        promise.resolve(frameStatsMap("busy", 0L, 0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, false))
        return@enqueueUi
      }
      val job = OrdoFrameCaptureJob(
        ChoreographerFrameSource(),
        HandlerDeadlineScheduler(mainHandler),
        ::currentDisplayMode,
      )
      frameJob = job
      val window = reactApplicationContext.currentActivity?.window
      val preferredHz = window?.attributes?.preferredRefreshRate?.toDouble() ?: 0.0
      job.start(
        durationMs.toLong(),
        preferredHz,
        { OrdoDiagnosticsPolicy.snapshot().captureAllowed(generation) },
      ) { outcome ->
        frameJob = null
        promise.resolve(
          frameStatsMap(
            outcome.status,
            outcome.durationMs,
            outcome.frameCount,
            outcome.intervalP50Ms,
            outcome.intervalP95Ms,
            outcome.intervalMaxMs,
            outcome.startModeRefreshHz,
            outcome.endModeRefreshHz,
            outcome.preferredRefreshRateHz,
            outcome.modeChanged,
          ),
        )
      }
    }
  }

  /** Bounded sanitized hierarchy snapshot: fixed type enums and geometry
   * only, at most 40 nodes. Never reads text, tags, accessibility labels,
   * test IDs, URLs, or pixels. */
  @ReactMethod
  fun getSafeRenderState(generation: Double, promise: Promise) {
    if (!OrdoDiagnosticsPolicy.snapshot().captureAllowed(generation)) {
      promise.resolve(renderStateMap("unavailable", null, Arguments.createArray()))
      return
    }
    enqueueUi("render", { promise.resolve(renderStateMap("unavailable", null, Arguments.createArray())) }) {
      if (!OrdoDiagnosticsPolicy.snapshot().captureAllowed(generation)) {
        promise.resolve(renderStateMap("unavailable", null, Arguments.createArray()))
        return@enqueueUi
      }
      val result = try {
        buildRenderState()
      } catch (_: Throwable) {
        renderStateMap("unavailable", null, Arguments.createArray())
      }
      if (!OrdoDiagnosticsPolicy.snapshot().captureAllowed(generation)) {
        promise.resolve(renderStateMap("unavailable", null, Arguments.createArray()))
      } else {
        promise.resolve(result)
      }
    }
  }

  // ── Legacy v1 surface ──────────────────────────────────────────────────
  // Kept only as sanitized wrappers over the v2 implementations so old JS
  // callers cannot read raw text. The v2 facade uses the new methods only
  // and treats a missing diagnosticsApiVersion 2 as unavailable.

  @Deprecated("v1 surface; sanitized v2 wrapper")
  @ReactMethod
  fun captureFrameStats(durationMs: Double, promise: Promise) {
    captureSafeFrameStats(
      durationMs,
      OrdoDiagnosticsPolicy.snapshot().generation.toDouble(),
      promise,
    )
  }

  @Deprecated("v1 surface; sanitized v2 wrapper")
  @ReactMethod
  fun getRenderState(promise: Promise) {
    getSafeRenderState(OrdoDiagnosticsPolicy.snapshot().generation.toDouble(), promise)
  }

  // ── internals ───────────────────────────────────────────────────────────

  private class ActiveLogScan {
    val revoked = AtomicBoolean(false)
    @Volatile var process: java.lang.Process? = null

    fun revoke() {
      revoked.set(true)
      try {
        process?.destroy()
      } catch (_: Throwable) {
      }
    }
  }

  private class LogScanOutcome(val parsed: OrdoParsedLog?, val degraded: Boolean)

  private fun cancelActiveCaptures(policyLevel: Boolean) {
    pendingUi.values.toList().forEach { it.cancel() }
    val job = frameJob
    if (job != null) {
      UiThreadUtil.runOnUiThread {
        if (policyLevel) job.cancelFromPolicy() else job.cancelFromLifecycle()
      }
    }
    activeScan?.revoke()
  }

  private fun collectEvidenceOnWorker(floor: Long, now: Long, scan: ActiveLogScan): WritableMap {
    var attempted = 0
    var degraded = 0

    // 1. Numeric exit history (API 30+), own package processes only. Entries
    //    for the current PID must predate this process (PID reuse guard).
    val exits = ArrayList<ApplicationExitInfo>(4)
    attempted += 1
    if (Build.VERSION.SDK_INT >= 30) {
      try {
        val manager = reactApplicationContext
          .getSystemService(Context.ACTIVITY_SERVICE) as ActivityManager
        val history = manager.getHistoricalProcessExitReasons(reactApplicationContext.packageName, 0, 5)
        for (exit in history) {
          val name = exit.processName
          if (name != null && name != reactApplicationContext.packageName) continue
          val timestamp = exit.timestamp
          if (timestamp <= floor || timestamp > now) continue
          if (exit.pid == pid && timestamp >= pidStartWallMs) continue
          exits.add(exit)
        }
      } catch (_: Throwable) {
        degraded += 1
      }
    } else {
      degraded += 1
    }

    // 2. Bounded own-UID log scans into reviewed incident templates. The
    //    current process always gets one; the most recent dead app PID from
    //    the exit window gets one sequential scan. Two scans never overlap.
    val parsedLogs = ArrayList<OrdoParsedLog>(2)
    val currentFloor = maxOf(floor, pidStartWallMs)
    attempted += 1
    val currentScan = scanLogForPid(pid, currentFloor, now, scan)
    if (currentScan.parsed == null || currentScan.degraded) degraded += 1
    if (currentScan.parsed != null) parsedLogs.add(currentScan.parsed)
    if (!scan.revoked.get()) {
      val priorExit = exits.firstOrNull { it.pid != pid && it.pid > 0 }
      if (priorExit != null) {
        val ceiling = minOf(priorExit.timestamp + 1500L, now)
        if (ceiling > floor) {
          attempted += 1
          val priorScan = scanLogForPid(priorExit.pid, floor, ceiling, scan)
          if (priorScan.parsed == null || priorScan.degraded) degraded += 1
          if (priorScan.parsed != null) parsedLogs.add(priorScan.parsed)
        }
      }
    }

    // 3. Aggregate: fixed codes, counts, and recency only.
    val counts = HashMap<String, Int>(8)
    val latest = HashMap<String, Long>(8)
    var omitted = 0
    for (log in parsedLogs) {
      for (incident in log.incidents) {
        counts[incident.code] = (counts[incident.code] ?: 0) + 1
        val previous = latest[incident.code]
        if (previous == null || incident.wallMs > previous) latest[incident.code] = incident.wallMs
      }
      omitted += log.omitted
    }
    // The public Expo exception observer persists fixed codes before the host
    // tears down. It survives logcat eviction and requires no JS callback.
    for (incident in OrdoDiagnosticsJournal.read(reactApplicationContext.applicationContext, floor, now)) {
      counts[incident.code] = maxOf(counts[incident.code] ?: 0, incident.count)
      latest[incident.code] = maxOf(latest[incident.code] ?: 0L, incident.wallMs)
    }
    val status = when {
      attempted == 0 -> "unavailable"
      degraded == 0 -> "complete"
      degraded < attempted -> "partial"
      else -> "unavailable"
    }

    val result = Arguments.createMap()
    result.putString("status", status)
    val exitArray = Arguments.createArray()
    for (exit in exits) {
      val entry = Arguments.createMap()
      entry.putInt("reason", exit.reason)
      entry.putInt("status", exit.status)
      entry.putInt("importance", exit.importance)
      entry.putDouble("ageMs", (now - exit.timestamp).toDouble().coerceAtLeast(0.0))
      exitArray.pushMap(entry)
    }
    result.putArray("exits", exitArray)
    val incidentArray = Arguments.createArray()
    val codes = latest.keys.filter { it in OrdoDiagnosticsContract.INCIDENT_CODES }
      .sortedBy { code -> latest[code] ?: 0L }
    for (code in codes) {
      val incident = Arguments.createMap()
      incident.putString("code", code)
      incident.putInt("count", (counts[code] ?: 0).coerceAtMost(9999))
      incident.putDouble("agoMs", (now - (latest[code] ?: now)).toDouble().coerceAtLeast(0.0))
      incidentArray.pushMap(incident)
    }
    result.putArray("incidents", incidentArray)
    result.putInt("omitted", omitted.coerceAtMost(100000))
    return result
  }

  /** One bounded, PID-scoped logcat read. Raw bytes go straight into the
   * strict two-stage parser and are discarded before returning. */
  private fun scanLogForPid(scanPid: Int, floor: Long, ceiling: Long, scan: ActiveLogScan): LogScanOutcome {
    if (Build.VERSION.SDK_INT < 26 || scan.revoked.get()) {
      return LogScanOutcome(null, true)
    }
    val bytes = ByteArrayOutputStream(8192)
    var timedOut = false
    var failed = false
    var command: java.lang.Process? = null
    var readLog: FutureTask<Unit>? = null
    try {
      val process = ProcessBuilder("logcat", "-d", "-t", "300", "--uid", Process.myUid().toString(),
        "--pid", scanPid.toString(), "-v", "threadtime", "*:W")
        .redirectErrorStream(true).start()
      command = process
      scan.process = process
      val task = FutureTask<Unit> {
        process.inputStream.use { input ->
          val buffer = ByteArray(2048)
          var remaining = 262144
          while (remaining > 0 && !Thread.currentThread().isInterrupted()) {
            val read = input.read(buffer, 0, minOf(buffer.size, remaining))
            if (read <= 0) break
            synchronized(bytes) { bytes.write(buffer, 0, read) }
            remaining -= read
          }
        }
      }
      readLog = task
      Thread(task, "ordo-log-read").apply { isDaemon = true; start() }
      task.get(1200, TimeUnit.MILLISECONDS)
    } catch (_: java.util.concurrent.TimeoutException) {
      timedOut = true
    } catch (_: Throwable) {
      failed = true
    } finally {
      readLog?.cancel(true)
      command?.destroy()
      scan.process = null
    }
    if (failed && bytes.size() == 0) {
      return LogScanOutcome(null, true)
    }
    val text = synchronized(bytes) {
      OrdoIncidentLogLine.prefilter(bytes.toString("UTF-8").lineSequence())
    }
    val parsed = OrdoParsedLog.parse(
      text.lineSequence(),
      scanPid,
      floor,
      ceiling,
      pid,
      pidStartWallMs,
      System.currentTimeMillis(),
    )
    return LogScanOutcome(parsed, timedOut)
  }

  private fun unavailableEvidence(): WritableMap {
    val result = Arguments.createMap()
    result.putString("status", "unavailable")
    result.putArray("exits", Arguments.createArray())
    result.putArray("incidents", Arguments.createArray())
    result.putInt("omitted", 0)
    return result
  }

  private fun frameStatsMap(
    status: String,
    durationMs: Long,
    frameCount: Int,
    p50: Double,
    p95: Double,
    maxMs: Double,
    startHz: Double,
    endHz: Double,
    preferredHz: Double,
    modeChanged: Boolean,
  ): WritableMap {
    val result = Arguments.createMap()
    result.putDouble("durationMs", durationMs.toDouble())
    result.putInt("frameCount", frameCount)
    result.putDouble("intervalP50Ms", p50)
    result.putDouble("intervalP95Ms", p95)
    result.putDouble("intervalMaxMs", maxMs)
    result.putDouble("startModeRefreshHz", startHz)
    result.putDouble("endModeRefreshHz", endHz)
    result.putDouble("preferredRefreshRateHz", preferredHz)
    result.putBoolean("modeChanged", modeChanged)
    result.putString("status", status)
    return result
  }

  private fun renderStateMap(status: String, window: Window?, nodes: WritableArray): WritableMap {
    val result = Arguments.createMap()
    result.putString("status", status)
    if (window != null) {
      val root = window.decorView
      val display = root?.display
      result.putDouble("displayRefreshRateHz", display?.refreshRate?.toDouble() ?: 0.0)
      result.putDouble("requestedRefreshRateHz", window.attributes.preferredRefreshRate.toDouble())
      result.putBoolean("windowFocused", root?.hasWindowFocus() ?: false)
      result.putDouble("windowAlpha", window.attributes.alpha.toDouble())
    } else {
      result.putDouble("displayRefreshRateHz", 0.0)
      result.putDouble("requestedRefreshRateHz", 0.0)
      result.putBoolean("windowFocused", false)
      result.putDouble("windowAlpha", 0.0)
    }
    result.putArray("nodes", nodes)
    return result
  }

  private fun buildRenderState(): WritableMap {
    val window = reactApplicationContext.currentActivity?.window
    val root = window?.decorView
    if (window == null || root == null) {
      return renderStateMap("unavailable", null, Arguments.createArray())
    }
    val nodes = Arguments.createArray()
    val queue = ArrayDeque<Pair<View, Int>>()
    queue.add(Pair(root, -1))
    var index = 0
    while (queue.isNotEmpty() && index < 40) {
      val (view, parent) = queue.removeFirst()
      val entry = Arguments.createMap()
      entry.putInt("parent", parent)
      entry.putString("type", OrdoSafeNodeTypes.classify(view.javaClass.simpleName))
      entry.putInt("width", view.width)
      entry.putInt("height", view.height)
      entry.putDouble("alpha", view.alpha.toDouble())
      entry.putInt("visibility", view.visibility)
      val childCount = if (view is ViewGroup) view.childCount else 0
      entry.putInt("children", childCount)
      if (view is ViewGroup) {
        // Include late overlay siblings without walking an entire article.
        val children: Iterable<Int> = if (childCount <= 8) 0 until childCount
          else (0 until 4) + (childCount - 4 until childCount)
        for (child in children) {
          if (queue.size < 80) queue.add(Pair(view.getChildAt(child), index))
        }
      }
      nodes.pushMap(entry)
      index += 1
    }
    return renderStateMap(if (queue.isNotEmpty()) "partial" else "complete", window, nodes)
  }

  private fun currentDisplayMode(): OrdoDisplayModeSnapshot? {
    val display: Display? = reactApplicationContext.currentActivity?.window?.decorView?.display
    val mode = display?.mode ?: return null
    return OrdoDisplayModeSnapshot(mode.modeId, mode.refreshRate.toDouble())
  }

  private class ChoreographerFrameSource : OrdoFrameSource {
    private var callback: Choreographer.FrameCallback? = null

    override fun start(onFrame: (Long) -> Boolean): Boolean {
      val frameCallback = object : Choreographer.FrameCallback {
        override fun doFrame(frameTimeNanos: Long) {
          val active = callback ?: return
          if (onFrame(frameTimeNanos)) {
            Choreographer.getInstance().postFrameCallback(active)
          }
        }
      }
      callback = frameCallback
      return try {
        Choreographer.getInstance().postFrameCallback(frameCallback)
        true
      } catch (_: Throwable) {
        callback = null
        false
      }
    }

    override fun stop() {
      val active = callback ?: return
      callback = null
      try {
        Choreographer.getInstance().removeFrameCallback(active)
      } catch (_: Throwable) {
      }
    }
  }

  private class HandlerDeadlineScheduler(private val handler: Handler) : OrdoDeadlineScheduler {
    override fun nowElapsedMs(): Long = SystemClock.elapsedRealtime()

    override fun schedule(delayMs: Long, runnable: () -> Unit): OrdoScheduled {
      val wrapped = Runnable { runnable() }
      handler.postDelayed(wrapped, delayMs.coerceAtLeast(0L))
      return object : OrdoScheduled {
        override fun cancel() {
          handler.removeCallbacks(wrapped)
        }
      }
    }
  }

  /** Retained solely so the transition JVM harness keeps exercising the
   * bounded excerpt behavior; no v2 method returns raw text. */
  private fun nativeLogExcerpt(filtered: ByteArray): String {
    if (filtered.size <= 24000) return String(filtered, Charsets.UTF_8)
    val marker = "\\n[... middle of native log omitted; recent read lines follow ...]\\n"
    // Retain the opening error and recent lines rather than only the first
    // stack traces. Drop split lines at both cuts when line boundaries exist.
    val head = String(filtered, 0, 5900, Charsets.UTF_8).substringBeforeLast('\\n')
    val tail = String(filtered, filtered.size - 17900, 17900, Charsets.UTF_8).substringAfter('\\n')
    return head + marker + tail
  }
}
`;
}

module.exports = {
  DIAGNOSTICS_POLICY_PREFS,
  ordoDiagnosticsPolicyKotlin,
  ordoDiagnosticsModuleKotlin,
};
