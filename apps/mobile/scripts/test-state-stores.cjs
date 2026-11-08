/** Exercise restart ownership and secure-token persistence across async boundaries. */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');

function deferred() {
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
const tick = () => new Promise(resolve => setImmediate(resolve));
function loader(mocks, { runTimers = true } = {}) {
  const cache = new Map();
  function load(file) {
    if (cache.has(file)) return cache.get(file);
    const exports = {};
    cache.set(file, exports);
    const source = ts.transpileModule(fs.readFileSync(file, 'utf8'), {
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
    }).outputText;
    vm.runInNewContext(source, {
      exports, console, queueMicrotask, AbortController, AbortSignal,
      setTimeout: callback => { if (runTimers) queueMicrotask(callback); return 1; }, clearTimeout: () => {},
      requestAnimationFrame: callback => queueMicrotask(callback),
      require: name => Object.hasOwn(mocks, name) ? mocks[name] : name.startsWith('.')
        ? load(path.resolve(path.dirname(file), `${name}.ts`)) : require(name),
    }, { filename: file });
    return exports;
  }
  return name => load(path.resolve(__dirname, `../src/${name}.ts`));
}

async function restartTests() {
  const pin = deferred();
  const reload = deferred();
  let pins = 0, reloads = 0, commits = 0;
  const cover = new Map();
  const load = loader({
    '../lib/local-diagnostics': { recordDiagnosticOperation() {}, flushLocalDiagnostics() {} },
    'react-native': { Image: { resolveAssetSource: () => ({ uri: 'logo' }) } },
    'expo-updates': { reloadAsync: () => { reloads++; return reload.promise; } },
    'react-native-mmkv': { createMMKV: () => ({ set: (key, value) => cover.set(key, value), remove: key => cover.delete(key) }) },
    '../../assets/logo-mark.png': 'logo',
    '../theme/pin-system-chrome': { pinSystemChrome: () => ++pins === 1 ? pin.promise : Promise.resolve() },
    '../theme/current-app-palette': { currentAppPalette: () => ({ background: '#ffffff', mode: 'light' }) },
  });
  const { restartRuntime, reloadRuntime, useUpdateRestartStore: store } = load('store/update-restart');
  const first = restartRuntime(async () => { commits++; });
  first.catch(() => {});
  assert.equal(store.getState().status, 'preparing', 'ownership is reserved before native work');
  await assert.rejects(restartRuntime(async () => { commits++; }), /already in progress/);
  await assert.rejects(reloadRuntime(), /already in progress/);
  pin.resolve();
  await tick();
  assert.equal(commits, 1, 'only the owner can change the server/session');
  assert.equal(reloads, 1);
  assert.equal(store.getState().status, 'reloading');
  reload.reject(new Error('native reload failed'));
  await assert.rejects(first, /native reload failed/);
  assert.equal(store.getState().status, 'idle');
  assert.equal(cover.size, 0, 'failed reload cannot leave a persisted splash');
  await assert.rejects(restartRuntime(async () => { throw new Error('commit failed'); }), /commit failed/);
  assert.equal(store.getState().status, 'idle', 'failed commits permit a retry');

  let failPin = true;
  const retryLoad = loader({
    '../lib/local-diagnostics': { recordDiagnosticOperation() {}, flushLocalDiagnostics() {} },
    'react-native': { Image: { resolveAssetSource: () => ({ uri: 'logo' }) } },
    'expo-updates': { reloadAsync: async () => {} },
    'react-native-mmkv': { createMMKV: () => ({ set() {}, remove() {} }) },
    '../../assets/logo-mark.png': 'logo',
    '../theme/pin-system-chrome': { pinSystemChrome: async () => { if (failPin) throw new Error('chrome failed'); } },
    '../theme/current-app-palette': { currentAppPalette: () => ({ background: '#ffffff', mode: 'light' }) },
  });
  const retry = retryLoad('store/update-restart');
  await assert.rejects(retry.restartRuntime(), /chrome failed/);
  assert.equal(retry.useUpdateRestartStore.getState().status, 'idle');
  failPin = false;
  await retry.restartRuntime();
  assert.equal(retry.useUpdateRestartStore.getState().status, 'reloading');
}

async function tokenTests() {
  const writes = [];
  let persisted;
  const load = loader({
    'react-native': { AppState: { addEventListener() {} } },
    '../lib/storage': {
      StorageKeys: { FOLDER_TOKENS: 'tokens' },
      secureGet: async () => null,
      secureSet: (_key, value) => {
        const done = deferred();
        writes.push({ value, done });
        return done.promise.then(() => { persisted = value; });
      },
    },
  }, { runTimers: false });
  const { useFolderTokenStore: store } = load('store/folder-tokens');
  store.getState().set('folder', 'secret', 600);
  store.getState().clear('folder');
  const cleared = store.getState().clearAll();
  assert.equal(writes.length, 1, 'clear waits for the earlier unlock write');
  writes[0].done.resolve();
  await tick();
  assert.equal(writes.length, 2);
  writes[1].done.resolve();
  await cleared;
  assert.deepEqual(Object.keys(persisted), [], 'logout wins on disk as well as in memory');
  assert.equal(store.getState().get('folder'), null);
  assert.equal(store.getState().accessRevision, 3);
}

async function authTests() {
  const origin = 'https://current.example';
  const user = { id: 'account', email: 'a@example.test', displayName: 'Account' };
  const tokens = { accessToken: 'current-access', refreshToken: 'current-refresh', expiresIn: 3600 };
  const saved = { user, tokens, sessionUpdatedAt: 10, serverUrl: origin };
  function setup(value, sidecar = null, read = async () => value) {
    const writes = [];
    const load = loader({
      '../lib/storage': {
        StorageKeys: { AUTH: 'auth', RECOVERY_KEY: 'recovery' },
        secureGet: read,
        secureSet: async (key, payload) => { writes.push({ key, payload }); },
        secureDelete: async key => { writes.push({ key, payload: null }); },
      },
      '../lib/share-targets': { readQuickShareSession: async () => sidecar, syncQuickShareSession: async () => {} },
      'expo-crypto': { randomUUID: require('node:crypto').randomUUID },
      './settings': { useSettingsStore: { getState: () => ({ serverUrl: origin }) } },
      '../lib/hosting': { canonicalizeServerUrl: url => { try { return new URL(url).origin; } catch { return null; } } },
    }, { runTimers: false });
    return { store: load('store/auth').useAuthStore, writes };
  }
  const mismatched = setup({ ...saved, serverUrl: 'https://old.example' });
  await mismatched.store.getState().hydrate();
  await tick();
  assert.equal(mismatched.store.getState().status, 'unauthenticated', 'an interrupted server switch cannot send old-origin credentials');
  assert.equal(mismatched.writes.at(-1).payload, null);

  const foreignSidecar = setup(saved, {
    serverUrl: 'https://old.example', accessToken: 'foreign', refreshToken: 'foreign',
    updatedAt: 20, accessExpiresAt: 100,
  });
  await foreignSidecar.store.getState().hydrate();
  assert.equal(foreignSidecar.store.getState().tokens.accessToken, 'current-access');
  await foreignSidecar.store.getState().reconcileShareSession();
  assert.equal(foreignSidecar.store.getState().tokens.accessToken, 'current-access', 'foreground also checks the sidecar origin');
  await tick();
  assert.equal(foreignSidecar.writes.at(-1).payload.serverUrl, origin, 'persisted credentials carry their origin');

  const staleAccount = setup({ ...saved, sessionId: 'new-login' }, {
    sessionId: 'previous-login', serverUrl: origin,
    accessToken: 'previous-access', refreshToken: 'previous-refresh', updatedAt: 30,
  });
  await staleAccount.store.getState().hydrate();
  assert.equal(staleAccount.store.getState().tokens.accessToken, 'current-access', 'same-origin sidecars must own this sign-in');
  const rotated = setup({ ...saved, sessionId: 'same-login' }, {
    sessionId: 'same-login', serverUrl: origin,
    accessToken: 'rotated-access', refreshToken: 'rotated-refresh', updatedAt: 30,
  });
  await rotated.store.getState().hydrate();
  assert.equal(rotated.store.getState().tokens.accessToken, 'rotated-access', 'native rotations of this session are adopted');

  const disk = deferred();
  const clearing = setup(saved, null, () => disk.promise);
  const hydration = clearing.store.getState().hydrate();
  await clearing.store.getState().clear();
  disk.resolve(saved);
  await hydration;
  assert.equal(clearing.store.getState().status, 'unauthenticated', 'a late hydration cannot undo logout');
  assert.equal(clearing.store.getState().tokens, null);
  assert.equal(clearing.writes.at(-1).payload, null);

  const loginDisk = deferred();
  const signingIn = setup(saved, null, () => loginDisk.promise);
  const restoring = signingIn.store.getState().hydrate();
  signingIn.store.getState().setSession({ user, tokens: { ...tokens, accessToken: 'new-login' } });
  loginDisk.resolve(saved);
  await restoring;
  assert.equal(signingIn.store.getState().tokens.accessToken, 'new-login', 'hydration cannot overwrite a newer login');
}

async function shareTests() {
  const writes = [];
  let stored = null;
  const load = loader({
    'react-native': { Platform: { OS: 'android' }, NativeModules: { OrdoShareSession: {
      get: async () => stored,
      set: json => { const done = deferred(); writes.push({ json, done }); return done.promise.then(() => { stored = json; }); },
      clear: async () => { stored = null; },
    } } },
    './local-diagnostics': { recordDiagnosticOperation() {} },
    'expo-file-system/legacy': { documentDirectory: null, cacheDirectory: null },
  });
  const share = load('lib/share-targets');
  const session = { sessionId: 'one', serverUrl: 'https://one.test', accessToken: 'a', refreshToken: 'r', updatedAt: 1 };
  const saving = share.syncQuickShareSession(session);
  const clearing = share.syncQuickShareSession(null);
  const reading = share.readQuickShareSession();
  writes[0].done.resolve();
  await Promise.all([saving, clearing]);
  assert.equal(await reading, null, 'an old sidecar write cannot restore credentials after clear');
  assert.equal(stored, null);
}

async function serverSwitchTests() {
  for (const status of ['authenticated', 'unauthenticated']) {
    const cleared = deferred();
    const order = [];
    const load = loader({
      './api/client': { cancelProactiveRefresh() {} },
      './query-cache': { discardQueryCache() {} },
      '../store/auth': { useAuthStore: { getState: () => ({ status, clear: () => { order.push('auth'); return cleared.promise; } }) } },
      '../store/folder-tokens': { useFolderTokenStore: { getState: () => ({ clearAll: async () => { order.push('folders'); } }) } },
      '../store/settings': { useSettingsStore: { getState: () => ({ setServerUrl: async url => { order.push(url); } }) } },
      '../store/update-restart': { restartRuntime: async before => { await before(); throw new Error('reload failed'); } },
    });
    const { commitServerSwitch } = load('lib/commit-server-switch');
    const first = commitServerSwitch('new-origin');
    assert.equal((await commitServerSwitch('other-origin')).ok, false, 'switch ownership spans hook instances');
    assert(!order.includes('new-origin'), 'new origin waits until credentials are cleared');
    cleared.resolve();
    assert.equal((await first).ok, true);
    assert.equal(order.at(-1), 'new-origin');
  }
}

async function signalTests() {
  const { mergeAbortSignals } = loader({})('lib/fetch-timeout');
  const listeners = new Set();
  const signal = { aborted: false, addEventListener: (_name, fn) => listeners.add(fn), removeEventListener: (_name, fn) => listeners.delete(fn) };
  const other = new AbortController();
  const merged = mergeAbortSignals([signal, other.signal]);
  assert.equal(listeners.size, 1);
  merged.dispose();
  assert.equal(listeners.size, 0, 'completed requests release their source listeners');
  const aborted = mergeAbortSignals([signal, AbortSignal.abort()]);
  assert.equal(aborted.signal.aborted, true);
  assert.equal(listeners.size, 0, 'already-aborted sources release earlier listeners too');
}

(async () => {
  await restartTests();
  await tokenTests();
  await authTests();
  await shareTests();
  await serverSwitchTests();
  await signalTests();
  console.log('Restart ownership, auth restoration and folder-token persistence checks passed.');
})().catch(error => { console.error(error); process.exitCode = 1; });
