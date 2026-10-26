/** Contract tests load actual TS sources; no copied privacy implementation. */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');
const root = path.resolve(__dirname, '../src/lib/diagnostics');
const cache = new Map();
function load(name) {
  const file = path.join(root, name + '.ts');
  if (cache.has(file)) return cache.get(file);
  const exports = {}; cache.set(file, exports);
  vm.runInNewContext(ts.transpileModule(fs.readFileSync(file, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText, { exports, require: p => load(p.replace('./', '')), Error, Object, JSON, Date, Math,
    TextEncoder, Set, Map, performance }, { filename: file });
  return exports;
}
const s = load('schema');
const { createDiagnosticRecorder } = load('recorder');
const secrets = ['192.0.2.44', '2001:db8::7', 'private.example', 'Private_Note', 'SECRET', 'person@example.test'];
const privateText = 'https://private.example/Private_Note?token=SECRET 192.0.2.44 [2001:db8::7] person@example.test';
const safe = value => { const text = JSON.stringify(value); for (const secret of secrets) assert(!text.includes(secret), secret); };
for (const value of [privateText, { message: privateText, stack: privateText }, new Error(privateText), null]) {
  safe(s.normalizeError(value, 'uncaught-js', true));
}
let reads = 0;
const evil = Object.defineProperty({}, 'message', { get() { reads++; throw Error(privateText); } });
safe(s.normalizeError(evil, 'render', false));
assert.equal(reads, 0, 'never invoke getters from unknown error values');
assert.equal(s.normalizeError(new Error('[Reanimated] Invalid color value: "rgba(28,53,49,4.2036685545777925e-7)"'), 'uncaught-js', true).code, 'reanimated.invalid_color');
assert.equal(s.normalizeEvent('route', '(app)/reader/[id]').detail, 'reader');
assert.equal(s.normalizeEvent('route', privateText).detail, 'other');
safe(s.normalizeEvent('reader.preference', JSON.stringify({ fontFamily: privateText, theme: 'dark', secret: privateText })));
assert.equal(s.normalizeEvent('changelog.select', privateText), null);
safe(s.normalizeNativeEvidence({ status: 'complete', text: privateText, exits: [{ reason: 4, description: privateText }], incidents: [{ code: 'react.host_destroyed', text: privateText }] }));
safe(s.normalizeRenderState({ status: 'complete', text: privateText, nodes: [{ type: privateText, text: privateText, width: 100, height: 200, alpha: 1 }] }));
safe(s.normalizeFrameStats({ status: 'complete', frameCount: 12, metadata: privateText, intervalMaxMs: 25 }));
for (const payload of [privateText, 'content://private.example/SECRET', 'file:///private/Private_Note', '192%2E0%2E2%2E44', '2001%3Adb8%3A%3A7', 'Authorization: Bearer SECRET', '\u0000私密🙂SECRET', 'SECRET'.repeat(100000)]) {
  safe(s.normalizeError({message:payload,stack:payload},'render',true));
  safe(s.normalizeBuild({version:payload,commit:payload,origin:payload,platform:payload}));
  safe(s.normalizeEvent('reader.preference',{fontFamily:payload,theme:payload}));
  safe(s.normalizeNativeEvidence({status:payload,incidents:[{code:payload}],exits:[{description:payload}]}));
}
for(let i=0;i<1000;i++){
  const payload='SECRET'+String.fromCodePoint(0x100+i)+i;
  safe(s.normalizeRenderState({nodes:[{type:payload,text:payload,parent:payload,width:payload}]}));
  assert.equal(s.normalizeEvent('operation',payload),null);
}

let wall = 1_000_000, mono = 0, writes = 0;
let pending = [];
const disk = new Map();
const adapter = {
  wall: () => wall, monotonic: () => mono,
  read: key => disk.get(key), write: (key, value) => { writes++; disk.set(key, value); }, remove: key => disk.delete(key),
  schedule: fn => { pending.push(fn); return fn; }, cancel: fn => { pending = pending.filter(x => x !== fn); },
};
const recorder = createDiagnosticRecorder(adapter, { version: '0.3.0', commit: 'a'.repeat(40), platform: 'android', osVersion: 36 });
assert.equal(recorder.status().enabled, true);
const initialWrites = writes;
for (let i = 0; i < 1000; i++) { mono++; recorder.event('reader.controls.open'); }
assert.equal(writes, initialWrites, 'no IO per basic event');
assert.equal(pending.length, 1, 'one batch timer during event flood');
pending.shift()();
assert.equal(writes, initialWrites + 1);
assert(recorder.snapshot().sessions[0].events.length <= 256);
recorder.error(new Error(privateText), 'uncaught-js', true);
safe([...disk.values()]);
assert(disk.has('fatal-v2'), 'fatal marker persists synchronously');
const fatalWrites = writes;
for(let i=0;i<1000;i++)recorder.error(new Error(privateText),'uncaught-js',true);
assert.equal(writes,fatalWrites,'a repeated fatal category cannot hammer synchronous persistence');
recorder.startDetailed(); assert.equal(recorder.status().mode, 'detailed');
recorder.overlay('performance', true);
assert(recorder.status().overlays.performance);
mono += 300_001; recorder.tick();
assert.equal(recorder.status().mode, 'basic');
assert.equal(recorder.status().overlays.performance, false);
recorder.setEnabled(false);
const disabledWrites = writes;
recorder.event('reader.controls.open'); recorder.error(new Error(privateText), 'render', true);
assert.equal(writes, disabledWrites, 'off does not persist fatal errors or events');
assert.equal(recorder.snapshot().sessions.length, 0);
assert(!disk.has('fatal-v2'));
assert(!disk.has('records-v2'));
recorder.setEnabled(true);
recorder.startDetailed(); recorder.overlay('status', true); recorder.background();
assert.equal(recorder.status().mode, 'basic');
assert(!recorder.status().overlays.status);
const oldGeneration = recorder.status().generation;
recorder.clear(); assert(recorder.status().generation > oldGeneration);
recorder.measurement('frames', { frameCount: 50 }, oldGeneration);
assert.equal(recorder.snapshot().measurements.length, 0, 'old captures cannot reappear after deletion');
recorder.event('runtime.started'); pending.shift()?.();
wall += 73 * 60 * 60 * 1000;
const restarted = createDiagnosticRecorder(adapter, { version: '0.3.0', platform: 'android' });
assert.equal(restarted.snapshot().sessions.length, 1, 'expired prior sessions are discarded');
for (let i = 0; i < 100_000; i++) restarted.event('reader.controls.open');
pending.splice(0).forEach(fn => fn());
assert([...disk.values()].every(v => Buffer.byteLength(v, 'utf8') < 1_048_576));
const broken = createDiagnosticRecorder({ ...adapter, read() { throw Error('storage unavailable'); }, write() { throw Error('disk full'); } }, {});
assert.equal(broken.status().enabled, false, 'unreadable policy fails closed');
assert.doesNotThrow(() => broken.error(new Error('test'), 'render', true));
for (const policy of [{enabled:true},{enabled:true,cutoff:'bad'},{enabled:true,cutoff:wall+1},null]) {
  disk.set('policy-v2',JSON.stringify(policy));
  assert.equal(createDiagnosticRecorder(adapter,{}).status().enabled,false,'partial or corrupt policy fails closed');
}
assert.equal(createDiagnosticRecorder({...adapter,read:()=>undefined,write:()=>{throw Error('keychain locked');}},{}).status().enabled,false,'first-run policy write failure must not default-enable in memory');
for (const area of s.OPERATION_AREAS) for (const outcome of s.OPERATION_OUTCOMES) {
  assert(s.normalizeEvent('operation',`${area}.${outcome} normal`));
}
assert.equal(s.normalizeEvent('operation',`${privateText}.ok normal`),null);
console.log('PASS: schema privacy, native response validation, getter safety, typed events, bounded recorder, batching, fatal marker, off/purge, expiry, generations and failure isolation');
