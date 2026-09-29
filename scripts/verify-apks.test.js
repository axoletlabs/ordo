const assert = require("node:assert/strict");
const { test } = require("node:test");
const { spawnSync } = require("node:child_process");
const { mkdtempSync, writeFileSync, rmSync } = require("node:fs");
const { join, resolve } = require("node:path");
const { tmpdir } = require("node:os");

test("packaged APK verifier rejects wrong keys, versions, runtimes and channels", (t) => {
  const temp = mkdtempSync(join(tmpdir(), "ordo-verify-apk-"));
  t.after(() => rmSync(temp, { recursive: true, force: true }));
  const program = join(temp, "verify.py");
  writeFileSync(program, `
import contextlib, io, json, runpy, zipfile
from pathlib import Path
s = runpy.run_path(${JSON.stringify(resolve(__dirname, "../.github/scripts/verify-apks.py"))})
verify = s['verify']
apk = Path(${JSON.stringify(join(temp, "app-arm64-v8a-release.apk"))})
runtime = 'a' * 40
with zipfile.ZipFile(apk, 'w') as z:
    z.writestr('assets/fingerprint', runtime)
outputs = {
    'verify': 'Signer #1 certificate SHA-256 digest: ' + 'b' * 64,
    'badging': "package: name='com.axolet.ordo' versionCode='400012' versionName='0.2.0'",
    'resources': 'resource 0x7f01 com.axolet.ordo:string/expo_runtime_version: t=0x03\\n  (string8) "file:fingerprint"',
    'xmltree': '\\n  E: meta-data (line=1)\\n    A: android:name="expo.modules.updates.UPDATES_CONFIGURATION_REQUEST_HEADERS_KEY"\\n    A: android:value=' + json.dumps(json.dumps({'expo-channel-name': 'production'})),
}
def output(*args):
    return outputs['verify' if args[1] == 'verify' else args[-2] if args[-2] == 'resources' else args[2]]
verify.__globals__['output'] = output
settings = dict(aapt='aapt', apksigner='apksigner', version='0.2.0', base=40001, runtime=runtime, channel='production', certificate='b' * 64)
with contextlib.redirect_stdout(io.StringIO()):
    verify(apk, **settings)
for field, wrong in [('version','0.1.0'),('base',40002),('runtime','c'*40),('channel','development'),('certificate','d'*64)]:
    try:
        verify(apk, **{**settings, field: wrong})
    except ValueError:
        pass
    else:
        raise AssertionError(field + ' mismatch was accepted')
outputs['resources'] = 'resource 0x7f01 com.axolet.ordo:string/expo_runtime_version: t=0x03\\n  (string8) "' + runtime + '"'
with contextlib.redirect_stdout(io.StringIO()):
    verify(apk, **settings)
print('APK verification matrix passed')
`);
  const result = spawnSync("python3", [program], { encoding: "utf8" });
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /matrix passed/);
});
