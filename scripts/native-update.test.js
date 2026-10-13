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
  const prefix = version.includes("-preview") ? "ordo-preview" : "ordo";
  return { tag_name: `v${version}`, published_at: "2026-09-01T00:00:00Z", prerelease: version.includes("-"),
    assets: [{ name: `${prefix}-v${version}-arm64-v8a.apk`, state: "uploaded", size: 100,
      browser_download_url: `https://github.com/axoletlabs/ordo/releases/download/v${version}/${prefix}-v${version}-arm64-v8a.apk` }], ...extra };
}
function fixture({ version = "0.1.0", variant = "stable", channel = variant, cached = null, readPrefs, fetchImpl, readInfo, installImpl } = {}) {
  const files = new Map();
  const downloads = [];
  const installed = [];
  let saved = cached;
  let reads = 0;
  let fetches = 0;
  const mocks = {
    "react-native": { Platform: { OS: "android" } },
    "expo-constants": { nativeAppVersion: version },
    "expo-application": { applicationId: require("./release-policy.js").APP_VARIANTS[variant]?.package ?? "unknown" },
    "expo-device": { supportedCpuArchitectures: ["arm64-v8a"] },
    "expo-updates": { channel },
    "@ordo/shared": { APP_NAME: "ordo" },
    "expo-intent-launcher": { ResultCode: { Canceled: 0 }, startActivityAsync: async (_action, options) => { installed.push(options); return installImpl ? installImpl() : { resultCode: 0 }; } },
    "expo-file-system/legacy": {
      cacheDirectory: "file:///cache/",
      getInfoAsync: async (uri) => readInfo ? readInfo(uri) : ({ exists: files.has(uri), size: files.get(uri) }),
      getContentUriAsync: async (uri) => `content://${uri}`,
      deleteAsync: async (uri) => { files.delete(uri); },
      createDownloadResumable: (url, uri, _options, progress) => {
        const transfer = deferred();
        const cancel = deferred();
        const task = { url, uri, progress, transfer, cancel,
          cancelCalls: 0,
          downloadAsync: () => transfer.promise,
          cancelAsync: () => { task.cancelCalls += 1; return cancel.promise; } };
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
    const source = process.env.ORDO_NATIVE_UPDATE_SOURCE && file.endsWith("/store/native-update.ts")
      ? process.env.ORDO_NATIVE_UPDATE_SOURCE : file;
    const code = ts.transpileModule(readFileSync(source, "utf8"), {
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
      __DEV__: false, console, URL, AbortController, Date, Error, setTimeout, clearTimeout,
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

test("Development and unknown binaries never fetch or install published updates", async () => {
  for (const variant of ["development", "unknown"]) {
    const f = fixture({ variant });
    assert.equal(await f.store.getState().check(true), null);
    assert.equal(f.store.getState().status, "disabled");
    assert.equal(f.fetches, 0);
  }
});

test("concurrent hydration runs once and Preview has no switching preference", async () => {
  const prefs = deferred();
  const f = fixture({ variant: "preview", version: "0.2.0-preview.1", readPrefs: () => prefs.promise });
  const a = f.store.getState().hydrate();
  const b = f.store.getState().hydrate();
  assert.equal(f.reads, 1);
  prefs.resolve(null);
  await Promise.all([a, b]);
  assert.equal(f.store.getState().includePrereleases, undefined);
  assert.equal(f.store.getState().setIncludePrereleases, undefined);
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
  list.resolve({ ok: true, json: async () => [githubRelease("0.2.0"), githubRelease("0.3.0", { assets: [] }), githubRelease("0.4.0-preview.1")] });
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

test("Stable ignores saved early access; Preview ignores latest Stable and old opt-out", async () => {
  for (const variant of ["stable", "preview"]) {
    const f = fixture({ variant, cached: { checkedAt: Date.now(), includePrereleases: variant === "stable", release: null },
      fetchImpl: async (url) => ({ ok: true, json: async () => url.endsWith("latest") ? githubRelease("0.9.0")
        : [githubRelease("0.2.0"), githubRelease("0.3.0-preview.2")] }) });
    const release = await f.store.getState().check();
    assert.equal(release.version, variant === "stable" ? "0.9.0" : "0.3.0-preview.2");
    assert.equal(f.saved.variant, variant);
    assert.equal(f.saved.includePrereleases, undefined);
  }
});

test("native package identity wins over channel metadata", async () => {
  const f = fixture({ variant: "stable", channel: "preview", fetchImpl: async () => ({ ok: true,
    json: async () => [githubRelease("0.3.0-preview.1")] }) });
  assert.equal(await f.store.getState().check(true), null);
});

test("Preview downloads and installs its own APK even when Stable is newer", async () => {
  const f = fixture({ variant: "preview", version: "0.2.0-preview.1", fetchImpl: async (url) => ({ ok: true,
    json: async () => url.endsWith("latest") ? githubRelease("0.9.0") : [githubRelease("0.3.0-preview.2")] }) });
  assert.equal((await f.store.getState().check(true)).version, "0.3.0-preview.2");
  const download = f.store.getState().downloadAndInstall();
  await tick();
  const task = f.downloads[0];
  assert.match(task.url, /ordo-preview-v0\.3\.0-preview\.2-arm64-v8a\.apk$/);
  f.files.set(task.uri, 100);
  task.transfer.resolve({ uri: task.uri, status: 200 });
  await download;
  assert.equal(f.installed.length, 1);
});

test("wrong-variant cached APKs are removed and cannot reach the installer", async () => {
  const other = fixture({ variant: "preview", fetchImpl: async (url) => ({ ok: true,
    json: async () => url.endsWith("latest") ? githubRelease("0.4.0") : [githubRelease("0.3.0-preview.1")] }) });
  const release = await other.store.getState().check(true);
  const f = fixture({ cached: { variant: "stable", checkedAt: Date.now(), release } });
  await f.store.getState().hydrate();
  assert.equal(f.store.getState().release, null);
  assert.equal(f.store.getState().lastChecked, null);
  f.store.setState({ release });
  await assert.rejects(f.store.getState().downloadAndInstall(), /variant/);
  await f.store.getState().install();
  assert.equal(f.downloads.length, 0);
  assert.equal(f.installed.length, 0);
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
  const cached = { checkedAt: 0, variant: "stable", release: f.store.getState().release };
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

test("repeated download taps reserve the transfer before asynchronous file checks", async () => {
  const info = deferred();
  let hold = false;
  const f = fixture({ readInfo: () => hold ? info.promise : { exists: false } });
  await f.store.getState().check(true);
  hold = true;
  const first = f.store.getState().downloadAndInstall();
  const second = f.store.getState().downloadAndInstall();
  await tick();
  assert.equal(f.store.getState().status, "downloading", "reserve before the file check completes");
  assert.equal(f.store.getState().showProgress, true);
  info.resolve({ exists: false });
  await tick();
  assert.equal(f.downloads.length, 1);
  f.store.getState().cancelDownload();
  f.downloads[0].cancel.resolve();
  f.downloads[0].transfer.resolve(null);
  await Promise.all([first, second]);
});

test("dismiss during a download cancels the socket and ignores late progress", async () => {
  const f = fixture();
  await f.store.getState().check(true);
  const download = f.store.getState().downloadAndInstall();
  await tick();
  const task = f.downloads[0];
  f.store.getState().dismissDownload();
  assert.equal(task.cancelCalls, 1, "dismiss must actually stop the socket");
  task.progress({ totalBytesWritten: 75, totalBytesExpectedToWrite: 100 });
  assert.equal(f.store.getState().progress, 0);
  assert.equal(f.store.getState().showProgress, false);
  task.cancel.resolve();
  task.transfer.resolve(null);
  await download;
  await tick();
  assert.equal(f.store.getState().status, "available");
});

test("installer errors preserve the APK and allow another attempt", async () => {
  let attempts = 0;
  const f = fixture({ installImpl: async () => {
    if (++attempts === 1) throw new Error("permission denied: unknown source");
    return { resultCode: 0 };
  } });
  await f.store.getState().check(true);
  const download = f.store.getState().downloadAndInstall();
  const rejected = assert.rejects(download, /permission denied/);
  await tick();
  const task = f.downloads[0];
  f.files.set(task.uri, 100);
  task.transfer.resolve({ uri: task.uri, status: 200 });
  await rejected;
  assert.equal(f.store.getState().installing, false);
  assert.equal(f.store.getState().installPermissionLikely, true);
  assert.equal(f.files.get(task.uri), 100);
  await f.store.getState().install();
  assert.equal(f.installed.length, 2);
  assert.equal(f.store.getState().installing, false);
  assert.match(f.store.getState().error, /cancelled/);
});

test("storage read failures do not prevent online update discovery", async () => {
  const f = fixture({ readPrefs: async () => { throw new Error("storage unavailable"); } });
  assert.equal((await f.store.getState().check(true)).version, "0.2.0");
  assert.equal(f.store.getState().hydrated, true);
});
