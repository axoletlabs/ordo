/** Compile and execute the generated diagnostics v2 Kotlin on the JVM.
 *
 * The full generated OrdoDiagnosticsModule.kt and OrdoDiagnosticsPolicy.kt
 * are compiled together against minimal Android/React stubs (catching
 * syntax/type regressions in the generators), then the pure parser, policy
 * state machine, histogram, view-type vocabulary, and frame-capture
 * cancellation controller are exercised with JVM fakes and the real incident
 * templates from docs/android-rendering-investigation.md.
 *
 * This validates generated code and pure logic only; it is not Android
 * instrumentation and does not claim device behavior.
 *
 * Usage: KOTLINC=/tmp/ordo-kotlin/kotlinc/bin/kotlinc node scripts/test-diagnostics-native.cjs
 */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const { ordoDiagnosticsModuleKotlin, ordoDiagnosticsPolicyKotlin } = require('../plugins/diagnostics-kotlin');
const moduleKotlin = ordoDiagnosticsModuleKotlin('test.ordo');
const policyKotlin = ordoDiagnosticsPolicyKotlin('test.ordo');

// Contract surface the parent facade gates on.
for (const method of [
  'configureRecording',
  'cancelDiagnosticCapture',
  'collectSafeEvidence',
  'captureSafeFrameStats',
  'getSafeRenderState',
]) {
  assert(moduleKotlin.includes(`fun ${method}(`), `missing v2 method ${method}`);
}
assert(moduleKotlin.includes('diagnosticsApiVersion'));
assert(moduleKotlin.includes('recordingEnabled'));
assert(moduleKotlin.includes('cutoffTimestamp'));
assert(moduleKotlin.includes('processStartElapsedRealtime'));
assert(moduleKotlin.includes('processStartedAt'));
assert(!moduleKotlin.includes('${'), 'no JS interpolation in generated Kotlin');
assert(!policyKotlin.includes('${'), 'no JS interpolation in generated Kotlin');

const STUBS = {
  'stub-expo-package.kt': `package expo.modules.core.interfaces
import android.content.Context
interface Package { fun createReactNativeHostHandlers(context: Context): List<ReactNativeHostHandler> = emptyList() }
interface ReactNativeHostHandler { fun onReactInstanceException(useDeveloperSupport: Boolean, exception: Exception) {} }
`,
  'stub-android-app.kt': `package android.app

import android.content.Context
import android.content.SharedPreferences
import android.os.Bundle
import android.view.Window

open class Activity : Context() {
  val window: Window = Window()
}

class ActivityManager {
  fun getHistoricalProcessExitReasons(packageName: String, pid: Int, maxNum: Int): List<ApplicationExitInfo> = emptyList()
}

class ApplicationExitInfo(
  val pid: Int,
  val processName: String?,
  val timestamp: Long,
  val reason: Int,
  val status: Int,
  val importance: Int,
)

open class Application : Context() {
  private val callbacks = mutableListOf<ActivityLifecycleCallbacks>()

  fun registerActivityLifecycleCallbacks(callback: ActivityLifecycleCallbacks) {
    callbacks.add(callback)
  }

  fun dispatchPaused() {
    callbacks.forEach { it.onActivityPaused(Activity()) }
  }

  interface ActivityLifecycleCallbacks {
    fun onActivityCreated(activity: Activity, savedInstanceState: Bundle?)
    fun onActivityStarted(activity: Activity)
    fun onActivityResumed(activity: Activity)
    fun onActivityPaused(activity: Activity)
    fun onActivityStopped(activity: Activity)
    fun onActivitySaveInstanceState(activity: Activity, outState: Bundle)
    fun onActivityDestroyed(activity: Activity)
  }
}
`,
  'stub-android-content.kt': `package android.content

object SharedPrefStore {
  val files = LinkedHashMap<String, StubSharedPreferences>()
}

interface SharedPreferences {
  fun contains(key: String): Boolean
  fun getInt(key: String, defValue: Int): Int
  fun getBoolean(key: String, defValue: Boolean): Boolean
  fun getLong(key: String, defValue: Long): Long
  fun edit(): SharedPreferences.Editor

  interface Editor {
    fun putInt(key: String, value: Int): Editor
    fun putBoolean(key: String, value: Boolean): Editor
    fun putLong(key: String, value: Long): Editor
    fun clear(): Editor
    fun remove(key: String): Editor
    fun commit(): Boolean
  }
}

class StubSharedPreferences : SharedPreferences {
  val data = HashMap<String, Any>()

  override fun contains(key: String): Boolean = data.containsKey(key)

  override fun getInt(key: String, defValue: Int): Int = (data[key] as? Int) ?: defValue

  override fun getBoolean(key: String, defValue: Boolean): Boolean = (data[key] as? Boolean) ?: defValue

  override fun getLong(key: String, defValue: Long): Long = (data[key] as? Long) ?: defValue

  override fun edit(): SharedPreferences.Editor = StubEditor(this)
}

class StubEditor(private val prefs: StubSharedPreferences) : SharedPreferences.Editor {
  private val pending = HashMap<String, Any>()
  private var clearing = false
  private val removed = mutableSetOf<String>()
  override fun remove(key: String): SharedPreferences.Editor { removed.add(key); pending.remove(key); return this }
  override fun clear(): SharedPreferences.Editor { clearing = true; pending.clear(); return this }

  override fun putInt(key: String, value: Int): SharedPreferences.Editor {
    pending[key] = value
    return this
  }

  override fun putBoolean(key: String, value: Boolean): SharedPreferences.Editor {
    pending[key] = value
    return this
  }

  override fun putLong(key: String, value: Long): SharedPreferences.Editor {
    pending[key] = value
    return this
  }

  override fun commit(): Boolean {
    if (clearing) prefs.data.clear()
    removed.forEach { prefs.data.remove(it) }
    prefs.data.putAll(pending)
    return true
  }
}

open class Context {
  companion object {
    const val ACTIVITY_SERVICE: String = "activity"
    const val MODE_PRIVATE: Int = 0
  }

  private val activityManager = ActivityManagerStub()

  val applicationContext: Context get() = this

  open fun getPackageName(): String = "test.ordo"

  fun getSystemService(name: String): Any? = if (name == ACTIVITY_SERVICE) activityManager else null

  fun getSharedPreferences(name: String, mode: Int): SharedPreferences =
    SharedPrefStore.files.getOrPut(name) { StubSharedPreferences() }

  class ActivityManagerStub
}
`,
  'stub-android-os.kt': `package android.os

import android.content.SharedPrefStore

class Build {
  companion object {
    val VERSION = Version()
  }

  class Version {
    val SDK_INT: Int = 36
  }
}

class Bundle

class Looper private constructor() {
  companion object {
    private val instance = Looper()
    fun getMainLooper(): Looper = instance
  }
}

class Handler(looper: Looper) {
  companion object { var hold = false; val pending = mutableListOf<Runnable>() }
  fun post(r: Runnable): Boolean { if (hold) pending.add(r) else r.run(); return true }
  fun postDelayed(r: Runnable, delayMillis: Long): Boolean {
    r.run()
    return true
  }

  fun removeCallbacks(r: Runnable) { pending.remove(r) }
}

class Process {
  companion object {
    fun myPid(): Int = 4242
    fun myUid(): Int = 10264
    fun getStartElapsedRealtime(): Long = 500_000L
  }
}

class SystemClock {
  companion object {
    fun elapsedRealtime(): Long = 900_000L
  }
}
`,
  'stub-android-view.kt': `package android.view

class Choreographer {
  companion object {
    private val instance = Choreographer()
    fun getInstance(): Choreographer = instance
  }

  fun postFrameCallback(callback: FrameCallback) {}

  fun removeFrameCallback(callback: FrameCallback) {}

  interface FrameCallback {
    fun doFrame(frameTimeNanos: Long)
  }
}

class Display {
  val refreshRate: Float get() = 60f
  val mode: Mode get() = Mode(1, 60f)

  class Mode(val modeId: Int, val refreshRate: Float)
}

open class View {
  var width: Int = 1080
  var height: Int = 2400
  var alpha: Float = 1f
  var visibility: Int = 0

  fun hasWindowFocus(): Boolean = true

  val display: Display? get() = Display()
}

class DecorView : View()

open class ViewGroup : View() {
  val childCount: Int = 0

  fun getChildAt(index: Int): View = this
}

class WindowManager {
  class LayoutParams {
    var alpha: Float = 1f
    var preferredRefreshRate: Float = 120.0000076f
  }
}

class Window {
  val attributes: WindowManager.LayoutParams get() = WindowManager.LayoutParams()
  val decorView: View get() = DecorView()
}
`,
  'stub-react-bridge.kt': `package com.facebook.react.bridge

import android.app.Activity
import android.content.Context

interface Promise {
  fun resolve(value: Any?)
}

interface WritableMap {
  fun putString(key: String, value: String?): WritableMap
  fun putInt(key: String, value: Int): WritableMap
  fun putDouble(key: String, value: Double): WritableMap
  fun putBoolean(key: String, value: Boolean): WritableMap
  fun putArray(key: String, value: WritableArray?): WritableMap
  fun putMap(key: String, value: WritableMap?): WritableMap
}

interface WritableArray {
  fun pushString(value: String?): WritableArray
  fun pushInt(value: Int): WritableArray
  fun pushDouble(value: Double): WritableArray
  fun pushBoolean(value: Boolean): WritableArray
  fun pushMap(value: WritableMap): WritableArray
}

private class StubMap : WritableMap {
  override fun putString(key: String, value: String?): WritableMap = this
  override fun putInt(key: String, value: Int): WritableMap = this
  override fun putDouble(key: String, value: Double): WritableMap = this
  override fun putBoolean(key: String, value: Boolean): WritableMap = this
  override fun putArray(key: String, value: WritableArray?): WritableMap = this
  override fun putMap(key: String, value: WritableMap?): WritableMap = this
}

private class StubArray : WritableArray {
  override fun pushString(value: String?): WritableArray = this
  override fun pushInt(value: Int): WritableArray = this
  override fun pushDouble(value: Double): WritableArray = this
  override fun pushBoolean(value: Boolean): WritableArray = this
  override fun pushMap(value: WritableMap): WritableArray = this
}

object Arguments {
  fun createMap(): WritableMap = StubMap()
  fun createArray(): WritableArray = StubArray()
}

annotation class ReactMethod

object UiThreadUtil {
  fun isOnUiThread(): Boolean = true

  fun runOnUiThread(task: Runnable) {
    task.run()
  }
}

class ReactApplicationContext(private val appContext: Context) {
  val packageName: String get() = appContext.getPackageName()

  val applicationContext: Context get() = appContext

  val currentActivity: Activity? get() = Activity()

  fun getSystemService(name: String): Any? = appContext.getSystemService(name)
}

open class ReactContextBaseJavaModule(private val reactContext: ReactApplicationContext) {
  protected val reactApplicationContext: ReactApplicationContext get() = reactContext

  open fun getName(): String? = null

  open fun getConstants(): Map<String, Any>? = null

  open fun invalidate() {}
}
`,
};

const TESTS = `package test.ordo

import android.app.Application
import android.content.SharedPrefStore
import android.content.StubSharedPreferences

// ── fixtures ────────────────────────────────────────────────────────────
// Incident lines below reproduce the reviewed templates from
// docs/android-rendering-investigation.md (synthetic, private-data-free).

fun wall(hour: Int, minute: Int, second: Int, millis: Int): Long {
  val calendar = java.util.Calendar.getInstance()
  calendar.clear()
  calendar.set(2026, java.util.Calendar.OCTOBER, 26, hour, minute, second)
  calendar.set(java.util.Calendar.MILLISECOND, millis)
  return calendar.timeInMillis
}

internal class FakeScheduler(var now: Long = 0L) : OrdoDeadlineScheduler {
  val pending = ArrayList<Pair<Long, () -> Unit>>()
  var cancelled = 0

  override fun nowElapsedMs(): Long = now

  override fun schedule(delayMs: Long, runnable: () -> Unit): OrdoScheduled {
    pending.add(Pair(delayMs, runnable))
    return object : OrdoScheduled {
      override fun cancel() {
        cancelled += 1
        pending.removeAll { it.second === runnable }
      }
    }
  }

  fun fireDeadline() {
    if (pending.isEmpty()) return
    pending.removeAt(0).second.invoke()
  }
}

internal class FakeFrames : OrdoFrameSource {
  var posted = false
  var stopped = 0
  var callback: ((Long) -> Boolean)? = null

  override fun start(onFrame: (Long) -> Boolean): Boolean {
    if (posted) return false
    posted = true
    callback = onFrame
    return true
  }

  override fun stop() {
    stopped += 1
    posted = false
    callback = null
  }

  fun deliver(nanos: Long): Boolean = callback?.invoke(nanos) ?: false
}

fun main() {
  // ── fixed contract ────────────────────────────────────────────────────
  check(OrdoDiagnosticsContract.API_VERSION == 2)
  check(
    OrdoDiagnosticsContract.INCIDENT_CODES == setOf(
      "reanimated.invalid_color",
      "react.host_destroyed",
      "fabric.mount_failed",
      "fabric.mounting_disabled",
      "native.unrecognized",
    ),
  )

  // ── incident parser: the real reviewed templates ─────────────────────
  val q = '"'
  val bs = '\\\\'
  val priorPid = 21284
  val now = wall(12, 0, 0, 0)
  val invalidColor = "10-26 11:51:20.308 " + priorPid + " " + priorPid +
    " W unknown:BridgelessReact: ReactHost{0}.handleHostException(message = " + q +
    "[Reanimated] Invalid color value: " + bs + q + "rgba(28,53,49,4.2036685545777925e-7)" + bs + q + q + ")"
  val destroyLine = "10-26 11:51:20.312 " + priorPid + " " + priorPid +
    " W unknown:BridgelessReact: ReactHost{0}.getOrCreateDestroyTask(): Starting React Native destruction"
  val mountFailed = "10-26 11:52:01.100 " + priorPid + " 21290 E FabricUIManager: Exception thrown when executing UIFrameGuarded"
  val mountingDisabled = "10-26 11:52:02.200 " + priorPid + " 21290 W FabricUIManager: Not flushing pending UI operations: exception was previously thrown"
  val unknownHostException = "10-26 11:53:00.000 " + priorPid + " 21290 W unknown:BridgelessReact: ReactHost{0}.handleHostException(message = " + q + "java.lang.SomeNewFailure" + q + ")"
  val oemFlood = "10-26 11:53:01.000 " + priorPid + " 21290 E fas.render: /proc/fas/render ioctl denied again"
  val secretFlood = "10-26 11:53:02.000 " + priorPid + " 21290 W WebView: loading https://user:secret@private.example.test/path?token=x from 192.168.1.4 /sdcard/ordo/data.json password=hunter2"
  val sandboxLine = "10-26 11:53:03.000 999 999 E chromium: Not flushing pending UI operations: sandbox imposter"
  val continuation = "  at com.facebook.react.fabric.FabricUIManager.renderFrame(FabricUIManager.java:4)"
  val malformed = "10-26 11:53:04.000 notapid 21290 E FabricUIManager: Exception thrown when executing UIFrameGuarded"
  val oldIncident = "10-26 10:30:00.000 " + priorPid + " 21290 W unknown:BridgelessReact: ReactHost{0}.handleHostException(message = old)"
  val floor = wall(11, 0, 0, 0)

  val currentPid = 4242
  val parsed = OrdoParsedLog.parse(
    listOf(
      invalidColor, destroyLine, mountFailed, mountingDisabled, unknownHostException,
      oemFlood, secretFlood, sandboxLine, continuation, malformed, oldIncident,
    ).asSequence(),
    priorPid, floor, now, currentPid, wall(11, 30, 0, 0), now,
  )
  val codes = parsed.incidents.map { it.code }
  check(codes.count { it == "reanimated.invalid_color" } == 1)
  check(codes.count { it == "react.host_destroyed" } == 1)
  check(codes.count { it == "fabric.mount_failed" } == 1)
  check(codes.count { it == "fabric.mounting_disabled" } == 1)
  check(codes.count { it == "native.unrecognized" } == 1)
  check(parsed.omitted == 2) { "expected oem flood + secret flood only, got " + parsed.omitted }
  check(parsed.incidents.all { it.code in OrdoDiagnosticsContract.INCIDENT_CODES })

  // The invalid-color incident time must be the parsed line time, proving
  // the real template with escaped quotes round-trips into a timestamp.
  check(parsed.incidents.first { it.code == "reanimated.invalid_color" }.wallMs == wall(11, 51, 20, 308))

  // Stage one prefilter: header-shaped and marker lines survive; junk and
  // continuation lines do not.
  val joined = OrdoIncidentLogLine.prefilter(listOf(invalidColor, continuation, "hello world", destroyLine).asSequence())
  check(joined.contains("handleHostException"))
  check(joined.contains("Starting React Native destruction"))
  check(!joined.contains("renderFrame"))
  check(!joined.contains("hello world"))

  // A marker without a header is kept by the prefilter but contributes
  // nothing through the strict parser.
  check(OrdoIncidentLogLine.parseHeader("Starting React Native destruction") == null)

  // Time scoping: the invalid-color line (.308) falls before a floor set
  // between it and the destruction line (.312); only the later one survives.
  val strictFloor = OrdoParsedLog.parse(
    listOf(invalidColor, destroyLine).asSequence(),
    priorPid, wall(11, 51, 20, 310), now, currentPid, wall(11, 30, 0, 0), now,
  )
  check(strictFloor.incidents.map { it.code } == listOf("react.host_destroyed"))
  check(strictFloor.omitted == 0)

  // PID reuse: current-PID lines from before this process started drop.
  val reusedLine = "10-26 11:00:30.000 " + currentPid + " " + currentPid + " W unknown:BridgelessReact: ReactHost{0}.handleHostException(message = old pid owner)"
  val liveLine = "10-26 11:40:30.000 " + currentPid + " " + currentPid + " W FabricUIManager: Not flushing pending UI operations: exception was previously thrown"
  val pidParsed = OrdoParsedLog.parse(
    listOf(reusedLine, liveLine).asSequence(),
    currentPid, wall(10, 0, 0, 0), now, currentPid, wall(11, 30, 0, 0), now,
  )
  check(pidParsed.incidents.map { it.code } == listOf("fabric.mounting_disabled"))

  // Header parsing rejects malformed lines but accepts real threadtime.
  check(OrdoIncidentLogLine.parseHeader(invalidColor)?.pid == priorPid)
  val paddedLine = "10-26 11:53:00.000   " + priorPid + "   21290 W unknown:BridgelessReact: ReactHost{0}.handleHostException(message = x)"
  check(OrdoIncidentLogLine.parseHeader(paddedLine)?.pid == priorPid) { "real padded threadtime header" }
  check(OrdoParsedLog.parse(sequenceOf(paddedLine), priorPid, floor, now, currentPid, floor, now).incidents.size == 1)
  check(OrdoIncidentLogLine.parseHeader(malformed) == null)
  check(OrdoIncidentLogLine.parseHeader(continuation) == null)
  val header = OrdoIncidentLogLine.parseHeader(mountFailed)
  check(header != null && header!!.level == 'E' && header!!.pid == priorPid)
  check(OrdoIncidentLogLine.headerWallMs(header!!, now) == wall(11, 52, 1, 100))

  // ── policy state machine ─────────────────────────────────────────────
  val initial = OrdoDiagnosticsPolicyState.initial()
  check(initial.masterEnabled && !initial.corrupt && initial.captureAllowed(0.0))
  // Absent preference: everything null means first run, native-on default.
  check(OrdoDiagnosticsPolicyState.fromPersisted(null, null, null, null).masterEnabled)
  // Corrupt states fail closed.
  check(!OrdoDiagnosticsPolicyState.fromPersisted(1, null, 5L, 2L).captureAllowed(2.0))
  check(!OrdoDiagnosticsPolicyState.fromPersisted(2, true, 5L, 2L).captureAllowed(2.0))
  check(!OrdoDiagnosticsPolicyState.fromPersisted(null, true, 5L, 2L).captureAllowed(2.0))
  check(!OrdoDiagnosticsPolicyState.fromPersisted(1, true, -1L, 2L).captureAllowed(2.0))
  check(!OrdoDiagnosticsPolicyState.fromPersisted(1, true, 5L, -2L).captureAllowed(-2.0))
  check(!OrdoDiagnosticsPolicyState.fromPersisted(1, false, 5L, 2L).captureAllowed(2.0))
  val valid = OrdoDiagnosticsPolicyState.fromPersisted(1, true, 5L, 2L)
  check(valid.captureAllowed(2.0) && !valid.captureAllowed(1.0) && !valid.captureAllowed(3.0))
  // Argument normalization rejects NaN/fractional/future values.
  check(OrdoDiagnosticsPolicyState.normalizeGeneration(Double.NaN) < 0)
  check(OrdoDiagnosticsPolicyState.normalizeGeneration(2.5) < 0)
  check(OrdoDiagnosticsPolicyState.normalizeGeneration(-1.0) < 0)
  check(OrdoDiagnosticsPolicyState.normalizeGeneration(3.0) == 3L)
  check(OrdoDiagnosticsPolicyState.normalizeCutoff(-1.0, now) < 0)
  check(OrdoDiagnosticsPolicyState.normalizeCutoff(now + 9.9e8, now) < 0)
  check(OrdoDiagnosticsPolicyState.normalizeCutoff(123.0, now) == 123L)
  // Evidence floor: the persisted cutoff always wins over an older request.
  val floored = OrdoDiagnosticsPolicyState.fromPersisted(1, true, 500L, 1L)
  check(floored.evidenceFloorMs(100.0, 1000L) == 500L)
  check(floored.evidenceFloorMs(700.0, 1000L) == 700L)
  check(floored.evidenceFloorMs(-5.0, 1000L) < 0)
  check(floored.evidenceFloorMs(2000.0, 1000L) < 0) { "clock rollback must not move an evidence floor backward" }

  // ── policy object: install, cancellation, persistence ────────────────
  SharedPrefStore.files.clear()
  val app = Application()
  OrdoDiagnosticsPolicy.install(app)
  check(OrdoDiagnosticsPolicy.snapshot().masterEnabled && !OrdoDiagnosticsPolicy.snapshot().corrupt)
  val levels = ArrayList<Boolean>()
  val unregister = OrdoDiagnosticsPolicy.registerCaptureCanceller { level -> levels.add(level) }
  OrdoDiagnosticsPolicy.cancelActiveCaptures(true)
  check(levels == listOf(true))
  app.dispatchPaused()
  check(levels == listOf(true, false)) { "background must cancel at lifecycle level, not policy level" }
  unregister()
  app.dispatchPaused()
  check(levels.size == 2)
  // Master switch gating and generation invalidation.
  OrdoDiagnosticsPolicy.applyUpdate(false, 0L, 5L)
  check(!OrdoDiagnosticsPolicy.snapshot().captureAllowed(5.0))
  OrdoDiagnosticsPolicy.applyUpdate(true, 700L, 6L)
  check(!OrdoDiagnosticsPolicy.snapshot().captureAllowed(5.0))
  check(OrdoDiagnosticsPolicy.snapshot().captureAllowed(6.0))
  // cancel-only path keeps the master preference and advances the token.
  OrdoDiagnosticsPolicy.advanceGeneration(7L)
  check(OrdoDiagnosticsPolicy.snapshot().masterEnabled)
  check(!OrdoDiagnosticsPolicy.snapshot().captureAllowed(6.0))
  check(OrdoDiagnosticsPolicy.snapshot().captureAllowed(7.0))
  // Persistence round-trips through the private SharedPreferences file.
  check(OrdoDiagnosticsPolicy.persist(true, 800L, 9L))
  val stored = SharedPrefStore.files[OrdoDiagnosticsPolicy.PREFS_NAME] as StubSharedPreferences
  check(stored.data["format"] == 1 && stored.data["master"] == true)
  check(stored.data["cutoff"] == 800L && stored.data["generation"] == 9L)
  check(
    OrdoDiagnosticsPolicyState.fromPersisted(
      stored.data["format"] as Int,
      stored.data["master"] as Boolean,
      stored.data["cutoff"] as Long,
      stored.data["generation"] as Long,
    ).captureAllowed(9.0),
  )

  // ── frame histogram ───────────────────────────────────────────────────
  val histogram = OrdoFrameHistogram()
  check(histogram.frameCount() == 0 && histogram.percentile(0.50) == 0.0 && histogram.maxIntervalMs() == 0.0)
  repeat(100) { histogram.add(16.7) }
  check(histogram.frameCount() == 100)
  check(histogram.percentile(0.50) in 16.0..17.5) { "p50 was " + histogram.percentile(0.50) }
  check(histogram.percentile(0.95) in 16.0..17.5)
  histogram.add(500.0)
  check(histogram.maxIntervalMs() == 500.0)
  check(histogram.percentile(0.999) == 500.0)
  histogram.add(Double.NaN)
  check(histogram.frameCount() == 101)

  // ── frame capture job: completion, deadlines, cancellation ───────────
  val outcomes = ArrayList<OrdoFrameCaptureOutcome>()
  fun freshJob(scheduler: FakeScheduler, frames: FakeFrames, modes: () -> OrdoDisplayModeSnapshot?, gate: () -> Boolean, durationMs: Long = 250L): OrdoFrameCaptureJob {
    val job = OrdoFrameCaptureJob(frames, scheduler, modes)
    job.start(durationMs, 120.0, gate) { outcome -> outcomes.add(outcome) }
    return job
  }

  // Completed window: 60 Hz delivery, callback removed, deadline cancelled.
  val scheduler = FakeScheduler()
  val frames = FakeFrames()
  var nanos = 0L
  var job = freshJob(scheduler, frames, { OrdoDisplayModeSnapshot(3, 60.0) }, { true })
  while (!job.isFinished() && scheduler.now < 260) {
    scheduler.now += 16
    nanos += 16_700_000L
    frames.deliver(nanos)
  }
  check(outcomes.size == 1)
  check(outcomes[0].status == "complete") { "got " + outcomes[0].status }
  check(outcomes[0].frameCount >= 14)
  check(outcomes[0].intervalP50Ms in 16.0..17.5)
  check(outcomes[0].intervalMaxMs in 16.0..17.6)
  check(outcomes[0].startModeRefreshHz == 60.0 && outcomes[0].preferredRefreshRateHz == 120.0)
  check(!outcomes[0].modeChanged)
  check(frames.stopped == 1 && scheduler.cancelled == 1 && scheduler.pending.isEmpty())
  check(frames.deliver(nanos + 16_700_000L) == false)

  // Deadline fires with no vsync: partial, no fabricated frames.
  outcomes.clear()
  val scheduler2 = FakeScheduler()
  val frames2 = FakeFrames()
  job = freshJob(scheduler2, frames2, { null }, { true })
  check(!job.isFinished())
  scheduler2.fireDeadline()
  check(outcomes.size == 1 && outcomes[0].status == "partial" && outcomes[0].frameCount == 0)
  check(frames2.stopped == 1)
  scheduler2.fireDeadline()
  check(outcomes.size == 1) { "no double delivery" }

  // Lifecycle cancel keeps partial data; later frames are inert.
  outcomes.clear()
  val scheduler3 = FakeScheduler()
  val frames3 = FakeFrames()
  job = freshJob(scheduler3, frames3, { OrdoDisplayModeSnapshot(3, 60.0) }, { true })
  for (i in 1..5) {
    scheduler3.now += 16
    nanos += 16_700_000L
    frames3.deliver(nanos)
  }
  job.cancelFromLifecycle()
  check(outcomes.size == 1 && outcomes[0].status == "partial")
  check(outcomes[0].frameCount == 4)
  check(outcomes[0].intervalMaxMs in 16.0..17.6)
  check(frames3.stopped == 1 && !frames3.posted)
  check(frames3.deliver(nanos + 16_700_000L) == false)
  job.cancelFromLifecycle()
  check(outcomes.size == 1)

  // Policy cancel discards anything measurable.
  outcomes.clear()
  val scheduler4 = FakeScheduler()
  val frames4 = FakeFrames()
  job = freshJob(scheduler4, frames4, { OrdoDisplayModeSnapshot(3, 60.0) }, { true })
  scheduler4.now += 16
  nanos += 16_700_000L
  frames4.deliver(nanos)
  job.cancelFromPolicy()
  check(outcomes.size == 1 && outcomes[0].status == "unavailable" && outcomes[0].frameCount == 0)

  // Closed gate at start: unavailable, nothing posted.
  outcomes.clear()
  val scheduler5 = FakeScheduler()
  freshJob(scheduler5, FakeFrames(), { null }, { false })
  check(outcomes.size == 1 && outcomes[0].status == "unavailable")
  check(scheduler5.pending.isEmpty())

  // Gate revoked during the window: completion is coerced unavailable.
  outcomes.clear()
  val scheduler6 = FakeScheduler()
  val frames6 = FakeFrames()
  var revoked = false
  job = freshJob(scheduler6, frames6, { OrdoDisplayModeSnapshot(3, 60.0) }, { !revoked })
  while (!job.isFinished() && scheduler6.now < 260) {
    scheduler6.now += 16
    nanos += 16_700_000L
    if (scheduler6.now >= 240) revoked = true
    frames6.deliver(nanos)
  }
  check(outcomes.size == 1 && outcomes[0].status == "unavailable" && outcomes[0].frameCount == 0)

  // Mid-window display-mode switch is reported.
  outcomes.clear()
  val scheduler7 = FakeScheduler()
  val frames7 = FakeFrames()
  var modeSwitched = false
  job = freshJob(scheduler7, frames7, { if (modeSwitched) OrdoDisplayModeSnapshot(1, 120.0) else OrdoDisplayModeSnapshot(3, 60.0) }, { true }, 1200L)
  while (!job.isFinished() && scheduler7.now < 1200) {
    scheduler7.now += 16
    nanos += 16_700_000L
    if (scheduler7.now >= 600) modeSwitched = true
    frames7.deliver(nanos)
  }
  check(outcomes.size == 1 && outcomes[0].modeChanged)
  check(outcomes[0].startModeRefreshHz == 60.0 && outcomes[0].endModeRefreshHz == 120.0)

  // ── sanitized node types ──────────────────────────────────────────────
  val allowed = setOf("root", "screen", "container", "text", "web", "image", "other")
  val expected = mapOf(
    "DecorView" to "root",
    "ReactSurfaceView" to "root",
    "ReactTextView" to "text",
    "EditText" to "text",
    "RNCWebView" to "web",
    "ReactImageView" to "image",
    "ScreenStack" to "screen",
    "ReactViewGroup" to "container",
    "FrameLayout" to "container",
    "TextureView" to "other",
    "SeekBar" to "other",
  )
  for ((name, type) in expected) {
    check(OrdoSafeNodeTypes.classify(name) == type) { name + " -> " + OrdoSafeNodeTypes.classify(name) }
  }
  for (name in listOf("", "表情View", "a" + "x".repeat(300), "PasswordTextView", " com.evil.WebViewFragment")) {
    check(OrdoSafeNodeTypes.classify(name) in allowed)
  }

  // Execute the real Expo hook and fatal journal with synthetic private text.
  val journal = expo.modules.ordodiagnostics.OrdoDiagnosticsJournal
  val journalFloor = System.currentTimeMillis() - 10000
  journal.configure(app, true, journalFloor)
  val original = Exception("[Reanimated] Invalid color value: 192.0.2.44 SECRET")
  val handlers = expo.modules.ordodiagnostics.OrdoDiagnosticsPackage().createReactNativeHostHandlers(app)
  handlers.single().onReactInstanceException(false, original)
  val recovered = journal.read(app, journalFloor, System.currentTimeMillis())
  check(recovered.single().code == "reanimated.invalid_color")
  check(recovered.single().count == 1)
  val journalPrefs = SharedPrefStore.files[expo.modules.ordodiagnostics.OrdoDiagnosticsJournal.PREFS]!!
  check(journalPrefs.data.values.all { it is Number }) { "only numeric timestamps/counts may be stored" }
  journal.configure(app, true, journalFloor)
  check(journal.read(app, journalFloor, System.currentTimeMillis()).size == 1) { "reinitialization must preserve incident evidence" }
  journal.configure(app, true, journalFloor + 1000)
  check(journal.read(app, journalFloor, System.currentTimeMillis()).size == 1) { "advancing the retention floor must preserve a newer pre-JS incident" }
  journal.configure(app, false, System.currentTimeMillis())
  handlers.single().onReactInstanceException(false, original)
  check(journalPrefs.data.isEmpty()) { "off must purge and suppress fatal markers" }
  // Execute actual module queue cancellation, rather than just the job fake.
  OrdoDiagnosticsPolicy.applyUpdate(true, 0L, 40L)
  val module = OrdoDiagnosticsModule(com.facebook.react.bridge.ReactApplicationContext(app))
  android.os.Handler.hold = true
  var deliveries = 0
  val promise = object : com.facebook.react.bridge.Promise { override fun resolve(value: Any?) { deliveries++ } }
  module.getSafeRenderState(40.0, promise)
  check(android.os.Handler.pending.size == 1 && deliveries == 0)
  OrdoDiagnosticsPolicy.cancelActiveCaptures(false)
  check(android.os.Handler.pending.isEmpty() && deliveries == 1) { "background must remove queued hierarchy scans and resolve once" }
  module.captureSafeFrameStats(1000.0, 40.0, promise)
  check(android.os.Handler.pending.size == 1)
  module.invalidate()
  check(android.os.Handler.pending.isEmpty() && deliveries == 2) { "teardown must remove queued frame captures" }
  module.getSafeRenderState(40.0, promise)
  check(android.os.Handler.pending.isEmpty() && deliveries == 3) { "invalidated modules cannot enqueue collectors" }
  android.os.Handler.hold = false
  println("PASS: diagnostics v2 generated Kotlin compiles; contract codes, phone-report incident templates, PID/time scoping, privacy omission counts, fail-closed policy state, install/cancel wiring, persistence round-trip, fixed histogram, frame-capture completion/deadline/lifecycle/policy cancellation, and sanitized node types all behave")
}
`;

const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'ordo-diagnostics-native-'));
try {
  fs.writeFileSync(path.join(directory, 'OrdoDiagnosticsPolicy.kt'), policyKotlin);
  fs.writeFileSync(path.join(directory, 'OrdoDiagnosticsModule.kt'), moduleKotlin);
  for (const [name, source] of Object.entries(STUBS)) {
    fs.writeFileSync(path.join(directory, name), source);
  }
  const journalRoot = path.resolve(__dirname, '../modules/ordo-diagnostics/android/src/main/java/expo/modules/ordodiagnostics');
  for (const name of ['OrdoDiagnosticsJournal.kt', 'OrdoDiagnosticsPackage.kt']) fs.copyFileSync(path.join(journalRoot, name), path.join(directory, name));
  fs.writeFileSync(path.join(directory, 'DiagnosticsTests.kt'), TESTS);
  const sources = [
    'OrdoDiagnosticsPolicy.kt',
    'OrdoDiagnosticsModule.kt',
    'OrdoDiagnosticsJournal.kt',
    'OrdoDiagnosticsPackage.kt',
    ...Object.keys(STUBS),
    'DiagnosticsTests.kt',
  ];
  const kotlinc = process.env.KOTLINC || 'kotlinc';
  const jar = path.join(directory, 'diagnostics-tests.jar');
  execFileSync(kotlinc, [...sources, '-nowarn', '-include-runtime', '-d', jar], {
    cwd: directory,
    stdio: 'inherit',
  });
  execFileSync('java', ['-jar', jar, 'test.ordo.DiagnosticsTestsKt'], { stdio: 'inherit' });
} finally {
  fs.rmSync(directory, { recursive: true, force: true });
}
