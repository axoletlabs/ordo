/** Exercise real persistence/store sources with controllable native writes. */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');
const root = path.resolve(__dirname, '../src');
const flush = async () => { for (let i = 0; i < 12; i++) await Promise.resolve(); };
const compile = (file, mocks) => {
  const exports = {};
  const code = ts.transpileModule(fs.readFileSync(file, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  vm.runInNewContext(code, { exports, require: name => mocks[name] ?? require(name), Date });
  return exports;
};
const persistence = compile(path.join(root, 'lib/coalesced-persistence.ts'), {});

(async () => {
  const writes = [];
  const resolutions = [];
  const save = persistence.createCoalescedPersistence(value => new Promise((resolve, reject) => {
    writes.push(value); resolutions.push({ resolve, reject });
  }));
  const first = save('first');
  const skipped = save('intermediate');
  const last = save('latest');
  assert.deepEqual(writes, ['first']);
  resolutions[0].resolve(); await flush();
  assert.deepEqual(writes, ['first', 'latest']);
  resolutions[1].resolve(); await Promise.all([first, skipped, last]);
  const failing = save('failure');
  const recovery = save('recovery');
  resolutions[2].reject(new Error('storage unavailable')); await flush();
  assert.equal(writes.at(-1), 'recovery', 'a rejected write must not wedge the queue');
  resolutions[3].resolve(); await Promise.all([failing, recovery]);

  const nativeWrites = [];
  const shares = [];
  const storage = {
    StorageKeys: { AUTH: 'auth', RECOVERY_KEY: 'recovery' },
    secureGet: async () => null,
    secureSet: (key, payload) => new Promise(resolve => nativeWrites.push({ key, payload, resolve })),
    secureDelete: key => key !== 'auth' ? Promise.resolve()
      : new Promise(resolve => nativeWrites.push({ key, deleted: true, resolve })),
  };
  const { useAuthStore } = compile(path.join(root, 'store/auth.ts'), {
    '../lib/coalesced-persistence': persistence,
    '../lib/storage': storage,
    '../lib/share-intake': { shouldAdoptQuickShareSession: () => false },
    '../lib/share-targets': {
      readQuickShareSession: async () => null,
      syncQuickShareSession: async value => { shares.push(value); },
    },
    '../lib/auth-session-policy': { accessExpiresAtFromNow: () => 1234 },
    './settings': { useSettingsStore: { getState: () => ({ serverUrl: 'https://test.invalid' }) } },
  });
  const user = { id: 'a', preferences: { fontFamily: 'sans' } };
  const tokens = { accessToken: 'test-old', refreshToken: 'test-refresh', expiresIn: 3600 };
  const store = () => useAuthStore.getState();
  store().setSession({ user, tokens });
  for (let i = 0; i < 15; i++) store().setUser({ ...user, preferences: { fontFamily: `font-${i}` } });
  assert.equal(nativeWrites.length, 1, 'updates queue behind the in-flight credential write');
  assert.equal(shares.length, 1, 'user/preferences updates must not rewrite the token-only sidecar');
  nativeWrites[0].resolve(); await flush();
  assert.equal(nativeWrites.length, 2, 'intermediate account snapshots coalesce');
  assert.equal(nativeWrites[1].payload.user.preferences.fontFamily, 'font-14');
  store().setTokens({ ...tokens, accessToken: 'test-new' });
  nativeWrites[1].resolve(); await flush();
  assert.equal(nativeWrites[2].payload.tokens.accessToken, 'test-new');
  assert.equal(nativeWrites[2].payload.user.preferences.fontFamily, 'font-14');
  const cleared = store().clear();
  assert.equal(nativeWrites.length, 3, 'deletion waits for the earlier credential write');
  nativeWrites[2].resolve(); await flush();
  assert.equal(nativeWrites[3].deleted, true);
  nativeWrites[3].resolve();
  await cleared;
  assert.equal(store().tokens, null);
  assert.equal(nativeWrites.at(-1).key, 'auth', 'no stale save can run after auth deletion');

  // Signing in again while a logout deletion is pending must persist the new
  // account last, rather than deleting it after the sign-in save completes.
  store().setSession({ user, tokens });
  const nextClear = store().clear();
  nativeWrites[4].resolve(); await flush();
  assert.equal(nativeWrites[5].deleted, true);
  const nextUser = { ...user, id: 'b' };
  store().setSession({ user: nextUser, tokens });
  nativeWrites[5].resolve(); await flush();
  assert.equal(nativeWrites[6].payload.user.id, 'b');
  nativeWrites[6].resolve(); await nextClear;
  assert.equal(store().user.id, 'b');

  // Android splits a filter at its first colon. Tags containing "unknown:"
  // cannot be embedded in tag:priority expressions (the phone rejected them).
  const kotlin = require('../plugins/diagnostics-kotlin').ordoDiagnosticsModuleKotlin('test.ordo');
  const command = kotlin.match(/ProcessBuilder\(([\s\S]*?)\)\s*\.redirectErrorStream/)[1];
  const literals = [...command.matchAll(/"([^"\n]*)"/g)].map(match => match[1]);
  for (const filter of literals.filter(arg => arg.includes(':'))) {
    assert.match(filter, /^[^:]+:[VDIWEFS]$/, `Invalid Android log filter: ${filter}`);
  }
  assert(literals.includes('*:W'));
  assert(literals.includes('--uid') && literals.includes('--pid'));
  assert(kotlin.includes('.joinToString("\\n")'), 'Kotlin string escapes must survive JS generation');
  assert(kotlin.includes('captureFrameStats') && kotlin.includes('Choreographer'),
    'frame cadence capture must exist and sample real vsync delivery');
  assert(kotlin.includes('durationMs < 250.0') && kotlin.includes('durationMs > 60000.0'), 'capture rejects durations outside the bounded performance window');
  assert(kotlin.includes('"busy"'), 'concurrent captures resolve immediately instead of queueing');
  assert(!kotlin.includes('${'), 'generated Kotlin must not contain JS template interpolation');
  console.log('PASS: coalesced auth persistence, failure recovery, token ordering, logout deletion, sidecar isolation, Android log-filter grammar, bounded frame capture');
})().catch(error => { console.error(error); process.exitCode = 1; });
