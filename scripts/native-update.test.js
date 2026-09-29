const assert = require("node:assert/strict");
const { test } = require("node:test");
const { readFileSync, existsSync } = require("node:fs");
const { resolve, dirname } = require("node:path");
const vm = require("node:vm");
const ts = require("typescript");

function deferred() {
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
function githubRelease(version, extra = {}) {
  return { tag_name: `v${version}`, published_at: "2026-09-01T00:00:00Z", prerelease: version.includes("-"),
    assets: [{ name: `ordo-v${version}-arm64-v8a.apk`, state: "uploaded", size: 100,
      browser_download_url: `https://github.com/axoletlabs/ordo/releases/download/v${version}/ordo-v${version}-arm64-v8a.apk` }], ...extra };
}
function fixture({ version = "0.1.0", channel = "production", cached = null, readPrefs, fetchImpl } = {}) {
  const files = new Map();
  const downloads = [];
  const installed = [];
  let saved = cached;
  let reads = 0;
  let fetches = 0;
  const mocks = {
    "react-native": { Platform: { OS: "android" } },
    "expo-constants": { nativeAppVersion: version },
    "expo-device": { supportedCpuArchitectures: ["arm64-v8a"] },
    "expo-updates": { channel },
    "@ordo/shared": { APP_NAME: "ordo" },
    "expo-intent-launcher": { ResultCode: { Canceled: 0 }, startActivityAsync: async (_action, options) => { installed.push(options); return { resultCode: 0 }; } },
    "expo-file-system/legacy": {
      cacheDirectory: "file:///cache/",
      getInfoAsync: async (uri) => ({ exists: files.has(uri), size: files.get(uri) }),
      getContentUriAsync: async (uri) => `content://${uri}`,
      deleteAsync: async (uri) => { files.delete(uri); },
      createDownloadResumable: (url, uri, _options, progress) => {
        const transfer = deferred();
        const cancel = deferred();
        const task = { url, uri, progress, transfer, cancel,
          downloadAsync: () => transfer.promise,
          cancelAsync: () => cancel.promise };
        downloads.push(task);
        return task;
      },
    },
    "zustand": { create: (init) => {
      let state;
      const store = { getState: () => state, setState: (patch) => { state = { ...state, ...patch }; } };
      state = init(store.setState, store.getState);
      return store;
    } },
  };
  const storage = { StorageKeys: { NATIVE_UPDATE: "update" },
    prefsGet: async () => { reads += 1; return readPrefs ? readPrefs() : saved; },
    prefsSet: async (_key, value) => { saved = value; } };
  const modules = new Map();
  function load(file) {
    if (modules.has(file)) return modules.get(file).exports;
    const module = { exports: {} };
    modules.set(file, module);
    const code = ts.transpileModule(readFileSync(file, "utf8"), {
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true },
    }).outputText;
    const localRequire = (specifier) => {
      if (mocks[specifier]) return mocks[specifier];
      if (specifier === "../lib/storage") return storage;
      if (!specifier.startsWith(".")) return require(specifier);
      const absolute = resolve(dirname(file), specifier);
      const target = existsSync(absolute) ? absolute : `${absolute}.ts`;
      return target.endsWith(".js") ? require(target) : load(target);
    };
    vm.runInNewContext(code, { module, exports: module.exports, require: localRequire,
      __DEV__: false, console, URL, AbortController, Date, setTimeout, clearTimeout,
      fetch: async (...args) => {
        fetches += 1;
        return fetchImpl ? fetchImpl(...args) : { ok: true, status: 200, json: async () => args[0].endsWith("latest") ? githubRelease("0.2.0") : [githubRelease("0.2.0")] };
      } }, { filename: file });
    return module.exports;
  }
  const store = load(resolve(__dirname, "../apps/mobile/src/store/native-update.ts")).useNativeUpdateStore;
  return { store, files, downloads, installed, get saved() { return saved; }, get reads() { return reads; }, get fetches() { return fetches; } };
}
const tick = () => new Promise((done) => setImmediate(done));

test("dev and feature binaries do not offer Android-blocked release downgrades", async () => {
  for (const channel of ["development", "development-feature"]) {
    const f = fixture({ channel });
    assert.equal(await f.store.getState().check(true), null);
    assert.equal(f.store.getState().status, "disabled");
    assert.equal(f.fetches, 0);
  }
});

test("concurrent hydration runs once and beta installs default to early access", async () => {
  const prefs = deferred();
  const f = fixture({ version: "0.2.0-beta.1", readPrefs: () => prefs.promise });
  const a = f.store.getState().hydrate();
  const b = f.store.getState().hydrate();
  assert.equal(f.reads, 1);
  prefs.resolve(null);
  await Promise.all([a, b]);
  assert.equal(f.store.getState().includePrereleases, true);
});

test("force checks share the active request and only offer official compatible assets", async () => {
  const list = deferred();
  const f = fixture({ fetchImpl: async (url) => url.endsWith("latest")
    ? { ok: false, status: 404 } : list.promise });
  const first = f.store.getState().check(true);
  await tick();
  const second = f.store.getState().check(true);
  let secondFinished = false;
  void second.then(() => { secondFinished = true; });
  await tick();
  assert.equal(secondFinished, false);
  list.resolve({ ok: true, json: async () => [githubRelease("0.2.0"), githubRelease("0.3.0", { assets: [] }), githubRelease("0.4.0-beta.1")] });
  assert.equal((await first).version, "0.2.0");
  assert.equal((await second).version, "0.2.0");
  assert.equal(f.fetches, 2);
  assert.equal(f.store.getState().lastChecked, null, "unfinished newer release bypasses cooldown");
  assert.equal(f.saved.checkedAt, 0);
});

test("optional latest endpoint failures do not discard a valid release list", async () => {
  const f = fixture({ fetchImpl: async (url) => {
    if (url.endsWith("latest")) throw new Error("network");
    return { ok: true, json: async () => [githubRelease("0.2.0")] };
  } });
  assert.equal((await f.store.getState().check(true)).version, "0.2.0");
});

test("a late GitHub result cannot replace the release currently downloading", async () => {
  const slow = deferred();
  let lists = 0;
  const f = fixture({ fetchImpl: async (url) => {
    if (url.endsWith("latest")) return { ok: false, status: 404 };
    if (++lists === 1) return { ok: true, json: async () => [githubRelease("0.2.0")] };
    return slow.promise;
  } });
  await f.store.getState().check(true);
  const check = f.store.getState().check(true);
  await tick();
  const download = f.store.getState().downloadAndInstall();
  await tick();
  slow.resolve({ ok: true, json: async () => [githubRelease("0.3.0")] });
  await check;
  assert.equal(f.store.getState().status, "downloading");
  assert.equal(f.store.getState().release.version, "0.2.0");
  f.store.getState().cancelDownload();
  f.downloads[0].cancel.resolve();
  f.downloads[0].transfer.resolve(null);
  await download;
});

test("corrupt cache and future timestamps cannot suppress update discovery", async () => {
  const f = fixture({ cached: { checkedAt: Date.now() + 86_400_000, includePrereleases: false,
    release: { version: "999", apkUrl: "https://github.com/axoletlabs/ordo/releases/download/v999/app.apk", apkSize: 100 } } });
  await f.store.getState().hydrate();
  assert.equal(f.store.getState().release, null);
  assert.equal(f.store.getState().lastChecked, null);
  assert.equal((await f.store.getState().check()).version, "0.2.0");
});

test("changing early-access preference invalidates a stale failed check", async () => {
  const slow = deferred();
  let lists = 0;
  const f = fixture({ cached: { checkedAt: 0, includePrereleases: true, release: null }, fetchImpl: async (url) => {
    if (url.endsWith("latest")) return { ok: false, status: 404 };
    if (++lists === 1) return slow.promise;
    return { ok: true, json: async () => [githubRelease("0.2.0-beta.2")] };
  } });
  const old = f.store.getState().check(true);
  const rejected = assert.rejects(old, /offline/);
  await tick();
  await f.store.getState().setIncludePrereleases(false);
  slow.reject(new Error("offline"));
  await rejected;
  assert.equal(f.store.getState().release, null);
  assert.equal(f.store.getState().includePrereleases, false);
  assert.equal(f.store.getState().error, null);
});

test("cancel then retry waits for old socket and file cleanup", async () => {
  const f = fixture();
  await f.store.getState().check(true);
  const first = f.store.getState().downloadAndInstall();
  await tick();
  assert.equal(f.downloads.length, 1);
  f.store.getState().cancelDownload();
  const second = f.store.getState().downloadAndInstall();
  await tick();
  assert.equal(f.downloads.length, 1);
  f.downloads[0].cancel.resolve();
  f.downloads[0].transfer.reject(new Error("cancelled"));
  await first;
  await tick();
  assert.equal(f.downloads.length, 2);
  const task = f.downloads[1];
  task.progress({ totalBytesWritten: 50, totalBytesExpectedToWrite: 100 });
  assert.equal(f.store.getState().progress, 0.5);
  f.files.set(task.uri, 100);
  task.transfer.resolve({ uri: task.uri, status: 200 });
  await second;
  assert.equal(f.store.getState().status, "downloaded");
  assert.equal(f.installed.length, 1);
  assert.equal(f.files.get(task.uri), 100);
});

test("HTTP errors and incomplete APKs never reach the installer", async () => {
  for (const [status, bytes] of [[403, 100], [200, 99]]) {
    const f = fixture();
    await f.store.getState().check(true);
    const download = f.store.getState().downloadAndInstall();
    const rejected = assert.rejects(download, /HTTP|incomplete/);
    await tick();
    const task = f.downloads[0];
    f.files.set(task.uri, bytes);
    task.transfer.resolve({ uri: task.uri, status });
    await rejected;
    assert.equal(f.installed.length, 0);
    assert.equal(f.files.has(task.uri), false);
    assert.equal(f.store.getState().status, "error");
  }
});

test("failed checks preserve valid offline downloads but drop evicted files", async () => {
  const f = fixture();
  await f.store.getState().check(true);
  const uri = "file:///cache/ordo-0.2.0.apk";
  f.store.setState({ downloadedUri: uri, status: "downloaded", progress: 1 });
  // Swap the global fetch used by the VM by using a second fixture with cached metadata.
  const cached = { checkedAt: 0, includePrereleases: false, release: f.store.getState().release };
  const offline = fixture({ cached, fetchImpl: async () => { throw new Error("offline"); } });
  offline.files.set(uri, 100);
  await offline.store.getState().hydrate();
  await assert.rejects(offline.store.getState().check(true), /offline/);
  assert.equal(offline.store.getState().status, "downloaded");
  offline.files.delete(uri);
  await assert.rejects(offline.store.getState().check(true), /offline/);
  assert.equal(offline.store.getState().downloadedUri, null);
  assert.equal(offline.store.getState().status, "available");
});
