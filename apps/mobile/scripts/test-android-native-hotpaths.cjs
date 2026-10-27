/** Execute the installed Kotlin guard and generated log excerpt with JVM fakes.
 * Requires a Kotlin CLI compiler (KOTLINC may point to its executable) and Java.
 * No phone, Gradle project, or Android SDK is needed for these focused checks. */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

function block(source, start) {
  const from = source.indexOf(start);
  assert(from >= 0, `Missing Kotlin block: ${start}`);
  const open = source.indexOf('{', from);
  let depth = 1;
  let end = open + 1;
  while (depth && end < source.length) {
    if (source[end] === '{') depth++;
    if (source[end] === '}') depth--;
    end++;
  }
  assert.equal(depth, 0);
  return source.slice(from, end);
}

const reanimated = path.dirname(require.resolve('react-native-reanimated/package.json'));
const proxy = fs.readFileSync(path.join(reanimated, 'android/src/main/java/com/swmansion/reanimated/NativeProxy.kt'), 'utf8');
const begin = proxy.indexOf('private val mountingManager:');
const end = proxy.indexOf('    @DoNotStrip\n    fun setGestureState', begin);
assert(begin >= 0 && end > begin);
const diagnostics = require('../plugins/diagnostics-kotlin').ordoDiagnosticsModuleKotlin('test.ordo');
const excerpt = block(diagnostics, 'private fun nativeLogExcerpt(');
const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'ordo-native-hotpaths-'));
const source = `
annotation class DoNotStrip
object BuildConfig { var IS_REACT_NATIVE_86_OR_NEWER = true }
object Log {
  val warnings = mutableListOf<String>()
  fun w(tag: String, text: String) { warnings.add(tag + ": " + text) }
}
object SynchronousPropsBufferParser {
  fun parse(tags: IntArray, values: DoubleArray, update: (Int, String) -> Unit) {
    for (tag in tags) update(tag, "opacity")
  }
}
class FabricUIManager(@JvmField val mMountingManager: Any) {
  val legacy = mutableListOf<Int>()
  fun synchronouslyUpdateViewOnUIThread(tag: Int, props: String) { legacy.add(tag) }
}
class CheckedManager {
  val alive = mutableSetOf(1, 3, 4)
  val writes = mutableListOf<Int>()
  var staleCalls = 0
  var failLive = false
  fun getViewExists(tag: Int) = tag in alive
  fun updatePropsSynchronously(tag: Int, props: String) {
    if (tag !in alive) { staleCalls++; error("stale view") }
    if (failLive) error("unexpected live update failure")
    writes.add(tag)
  }
}
class OlderManager {
  val writes = mutableListOf<Int>()
  fun updatePropsSynchronously(tag: Int, props: String) { writes.add(tag) }
}
class Proxy(val mFabricUIManager: FabricUIManager) {
  ${proxy.slice(begin, end)}
}
class Excerpt {
  ${excerpt}
  fun read(text: String) = nativeLogExcerpt(text.toByteArray(Charsets.UTF_8))
}
fun main() {
  val manager = CheckedManager()
  val fabric = FabricUIManager(manager)
  val proxy = Proxy(fabric)
  proxy.synchronouslyUpdateUIProps(intArrayOf(1, 2, 3), doubleArrayOf())
  check(manager.writes == listOf(1, 3)) { "mounted updates must survive stale siblings" }
  check(manager.staleCalls == 0 && Log.warnings.isEmpty()) { "stale tags must not throw or log" }
  manager.alive.remove(1)
  proxy.synchronouslyUpdateUIProps(intArrayOf(1, 3), doubleArrayOf())
  check(manager.writes == listOf(1, 3, 3)) { "existence must be rechecked after unmount" }
  manager.failLive = true
  proxy.synchronouslyUpdateUIProps(intArrayOf(3), doubleArrayOf())
  check(Log.warnings.size == 1 && "unexpected live update failure" in Log.warnings.single())
  check("InvocationTargetException" !in Log.warnings.single() && '\\n' !in Log.warnings.single())
  val older = OlderManager()
  Proxy(FabricUIManager(older)).synchronouslyUpdateUIProps(intArrayOf(4), doubleArrayOf())
  check(older.writes == listOf(4)) { "missing optional lookup preserves compatibility" }
  BuildConfig.IS_REACT_NATIVE_86_OR_NEWER = false
  proxy.synchronouslyUpdateUIProps(intArrayOf(7), doubleArrayOf())
  check(fabric.legacy == listOf(7)) { "pre-0.86 path must stay intact" }

  val excerpt = Excerpt()
  val short = "short native error\\nCaused by: useful cause"
  check(excerpt.read(short) == short)
  val recent = "10-26 15:04:51.700 E Fabric: incident-time failure"
  val flood = "opening failure\\n" + "old stack frame abcdefghijklmnopqrstuvwxyz\\n".repeat(3000) + recent
  val retained = excerpt.read(flood)
  check(retained.startsWith("opening failure\\n") && retained.endsWith(recent))
  check("middle of native log omitted" in retained)
  check(retained.toByteArray(Charsets.UTF_8).size <= 24000)
  val unicode = excerpt.read("🌕".repeat(15000) + "\\n" + recent)
  check(unicode.endsWith(recent) && unicode.toByteArray(Charsets.UTF_8).size <= 24000)
  println("PASS: installed Kotlin stale-tag guard, unmount recheck, live updates, concise failures, legacy compatibility, recent-log retention and UTF-8 bounds")
}
`;

try {
  const file = path.join(directory, 'Check.kt');
  const jar = path.join(directory, 'check.jar');
  fs.writeFileSync(file, source);
  execFileSync(process.env.KOTLINC || 'kotlinc', [file, '-nowarn', '-include-runtime', '-d', jar], { stdio: 'inherit' });
  execFileSync('java', ['-jar', jar], { stdio: 'inherit' });
} finally {
  fs.rmSync(directory, { recursive: true, force: true });
}
