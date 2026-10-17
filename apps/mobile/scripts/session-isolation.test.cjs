/** Actual API client and TanStack mutation lifecycles with held network responses. */
const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const { resolve, dirname } = require("node:path");
const { createRequire } = require("node:module");
const { test } = require("node:test");
const ts = require("typescript");
const nativeRequire = createRequire(resolve(__dirname, "../package.json"));
const { QueryClient, MutationObserver } = nativeRequire("@tanstack/react-query");
const tick = () => new Promise(setImmediate);
function fixture() {
  const modules = new Map();
  const authListeners = new Set(), settingsListeners = new Set(), storage = new Map();
  let server = "http://127.0.0.1:8301", writes = 0, clears = 0, unavailable = 0;
  const auth = { sessionGeneration: 1, status: "authenticated", user: { id: "a" }, accessExpiresAt: 0,
    tokens: { accessToken: "a-access", refreshToken: "a-refresh" },
    setTokens(tokens) { writes++; auth.tokens = tokens; }, clear() { clears++; auth.sessionGeneration++; auth.user = null; } };
  const mocks = { "expo-device": { DeviceType: {}, deviceName: "Audit" } };
  const mock = (path, exports) => modules.set(resolve(__dirname, "../src", path), { exports });
  mock("store/auth.ts", { useAuthStore: { getState: () => auth, subscribe(fn) { authListeners.add(fn); return () => authListeners.delete(fn); } } });
  mock("store/settings.ts", { useSettingsStore: { getState: () => ({ serverUrl: server }), subscribe(fn) { settingsListeners.add(fn); return () => settingsListeners.delete(fn); } } });
  mock("store/folder-tokens.ts", { useFolderTokenStore: { getState: () => ({ liveTokens: () => [], get: () => undefined, clearAll: async () => {} }) } });
  mock("lib/server-availability.ts", { reportServerUnreachable() { unavailable++; } });
  mock("lib/telemetry.ts", { noteServerError() {}, noteTimeout() {} });
  function load(path) {
    const filename = resolve(__dirname, "../src", path);
    if (modules.has(filename)) return modules.get(filename).exports;
    const mod = { exports: {} }; modules.set(filename, mod);
    const { outputText } = ts.transpileModule(readFileSync(filename, "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } });
    new Function("require", "module", "exports", outputText)((name) => name.startsWith(".") ? load(resolve(dirname(filename), `${name}.ts`)) : mocks[name] ?? nativeRequire(name), mod, mod.exports);
    return mod.exports;
  }
  const client = load("lib/api/client.ts");
  return { ...client, options: load("lib/session-mutation.ts").sessionMutationOptions, load, mock, storage, mocks,
    switchAccount(host = "http://127.0.0.1:8302") { server = host; auth.sessionGeneration++; auth.user = { id: "b" }; auth.tokens = { accessToken: "b-access", refreshToken: "b-refresh" }; authListeners.forEach((fn) => fn()); settingsListeners.forEach((fn) => fn()); },
    counts: () => ({ writes, clears, unavailable }), auth };
}
const reply = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

for (const rejected of [false, true]) test(`late ${rejected ? "rejected" : "successful"} refresh cannot replace/clear the next session`, async () => {
  const f = fixture(); let finish;
  const previous = global.fetch; global.fetch = () => new Promise((resolve) => { finish = resolve; });
  try {
    const pending = f.ensureFreshAccessToken(); await tick(); f.switchAccount();
    finish(rejected ? reply({ error: { code: "session_revoked" } }, 401) : reply({ tokens: { accessToken: "old", refreshToken: "old", expiresIn: 3600 } }));
    assert.equal(await pending, "superseded");
    assert.equal(f.auth.tokens.accessToken, "b-access");
    assert.deepEqual(f.counts(), { writes: 0, clears: 0, unavailable: 0 });
  } finally { global.fetch = previous; f.cancelProactiveRefresh(); }
});

test("old unauthorized requests never replay or refresh against the new server", async () => {
  const f = fixture(); let finish; const sent = [];
  const previous = global.fetch; global.fetch = (url) => { sent.push(url); return new Promise((resolve) => { finish = resolve; }); };
  try {
    const pending = f.api.patch("/api/bookmarks/shared-id", { readProgress: 0.5 });
    const rejected = assert.rejects(pending, { name: "SessionChangedError" });
    await tick(); f.switchAccount(); finish(reply({ error: { code: "unauthorized" } }, 401)); await rejected;
    assert.deepEqual(sent, ["http://127.0.0.1:8301/api/bookmarks/shared-id"]);
    assert.equal(f.counts().clears, 0);
  } finally { global.fetch = previous; f.cancelProactiveRefresh(); }
});

for (const rejected of [false, true]) test(`late ${rejected ? "rejected" : "successful"} refresh cannot overwrite a newer Quick Save rotation`, async () => {
  const f = fixture(); let finish; const previous = global.fetch;
  global.fetch = () => new Promise((resolve) => { finish = resolve; });
  try {
    const pending = f.ensureFreshAccessToken(); await tick();
    f.auth.tokens = { accessToken: "sidecar-access", refreshToken: "sidecar-refresh" };
    finish(rejected ? reply({ error: { code: "session_revoked" } }, 401) : reply({ tokens: { accessToken: "old", refreshToken: "old", expiresIn: 3600 } }));
    assert.equal(await pending, "ok");
    assert.equal(f.auth.tokens.accessToken, "sidecar-access");
    assert.deepEqual(f.counts(), { writes: 0, clears: 0, unavailable: 0 });
  } finally { global.fetch = previous; f.cancelProactiveRefresh(); }
});

test("a new account starts its own refresh instead of joining the old account's flight", async () => {
  const f = fixture(); const responses = [], sent = [];
  const previous = global.fetch; global.fetch = (url) => { sent.push(url); return new Promise((resolve) => responses.push(resolve)); };
  try {
    const a = f.ensureFreshAccessToken(); await tick(); f.switchAccount(); const b = f.ensureFreshAccessToken(); await tick();
    assert.deepEqual(sent, ["http://127.0.0.1:8301/api/auth/refresh", "http://127.0.0.1:8302/api/auth/refresh"]);
    responses[0](reply({ tokens: { accessToken: "old", expiresIn: 3600 } })); assert.equal(await a, "superseded");
    responses[1](reply({ tokens: { accessToken: "b-new", refreshToken: "b-new", expiresIn: 3600 } })); assert.equal(await b, "ok");
    assert.equal(f.auth.tokens.accessToken, "b-new"); assert.equal(f.counts().writes, 1);
  } finally { global.fetch = previous; f.cancelProactiveRefresh(); }
});

test("late successful responses and network failures do not affect the next account", async () => {
  for (const failure of [false, true]) {
    const f = fixture(); let finish, fail; const previous = global.fetch;
    global.fetch = () => new Promise((resolve, reject) => { finish = resolve; fail = reject; });
    try {
      const pending = f.api.get("/api/folders"); const rejected = assert.rejects(pending, { name: "SessionChangedError" });
      await tick(); f.switchAccount("http://127.0.0.1:8301");
      if (failure) fail(new TypeError("offline")); else finish(reply([{ name: "Private account A" }]));
      await rejected; assert.deepEqual(f.counts(), { writes: 0, clears: 0, unavailable: 0 });
    } finally { global.fetch = previous; f.cancelProactiveRefresh(); }
  }
});

for (const failure of [false, true]) test(`late mutation ${failure ? "rollback" : "success"} cannot republish into the next account`, async () => {
  const f = fixture(), qc = new QueryClient({ defaultOptions: { mutations: { gcTime: 0 } } });
  let finish, fail, success = 0, rollback = 0, settled = 0;
  const observer = new MutationObserver(qc, f.options({ mutationFn: () => new Promise((resolve, reject) => { finish = resolve; fail = reject; }),
    onSuccess() { success++; qc.setQueryData(["private"], "old"); }, onError() { rollback++; qc.setQueryData(["private"], "old"); }, onSettled() { settled++; } }));
  const pending = observer.mutate(); const outcome = assert.rejects(pending, failure ? /offline/ : { name: "SessionChangedError" });
  await tick(); f.switchAccount(); qc.clear(); qc.setQueryData(["private"], "new");
  if (failure) fail(new Error("offline")); else finish("old"); await outcome;
  assert.equal(qc.getQueryData(["private"]), "new"); assert.deepEqual([success, rollback, settled], [0, 0, 0]); qc.clear();
});

test("serialized mutations queued before sign-out never send with the next account", async () => {
  const f = fixture(), qc = new QueryClient({ defaultOptions: { mutations: { gcTime: 0 } } });
  let finish, sends = 0;
  const options = f.options({ scope: { id: "serial" }, mutationFn: () => { sends++; return new Promise((resolve) => { finish = resolve; }); } });
  const a = new MutationObserver(qc, options), b = new MutationObserver(qc, options);
  const first = a.mutate(); const firstRejected = assert.rejects(first, { name: "SessionChangedError" });
  await tick(); const second = b.mutate(); const rejected = assert.rejects(second, { name: "SessionChangedError" });
  await tick(); f.switchAccount(); finish("done"); await firstRejected; await rejected;
  assert.equal(sends, 1); qc.clear();
});

test("offline failures retain the current session and successful retries still work", async () => {
  const f = fixture(), previous = global.fetch;
  global.fetch = async () => { throw new TypeError("offline"); };
  try {
    await assert.rejects(f.api.get("/api/folders"), { code: "network_error" });
    assert.equal(await f.ensureFreshAccessToken(), "unreachable");
    assert.equal(f.counts().clears, 0); assert.equal(f.auth.tokens.accessToken, "a-access");
    global.fetch = async () => reply([{ id: "folder-a" }]);
    assert.deepEqual(await f.api.get("/api/folders"), [{ id: "folder-a" }]);
  } finally { global.fetch = previous; f.cancelProactiveRefresh(); }
});

function cacheFixture() {
  const f = fixture(), qc = new QueryClient({ defaultOptions: { queries: { gcTime: 0 } } });
  f.mocks["react-native"] = { Platform: { OS: "web" }, AppState: { addEventListener: () => ({ remove() {} }) } };
  f.mocks["react-native-mmkv"] = { createMMKV: () => ({ getString: (key) => f.storage.get(key), set: (key, value) => f.storage.set(key, value), remove: (key) => f.storage.delete(key), clearAll: () => f.storage.clear() }) };
  f.mock("lib/query-client.ts", { queryClient: qc });
  f.mock("lib/api/bookmarks.ts", { bookmarksApi: {} });
  f.mock("lib/api/folders.ts", { fetchFoldersNormalized: () => {} });
  f.mock("lib/api/server.ts", { serverApi: {} });
  f.mock("lib/undoable-delete.ts", { resumePendingDeletes() {} });
  return { ...f, qc, cache: f.load("lib/query-cache.ts"), persist: f.load("lib/query-persist.ts") };
}

test("account switching synchronously removes shared query data and old snapshots", () => {
  const f = cacheFixture(), release = f.cache.installSessionCacheIsolation();
  f.qc.setQueryData(["private"], "account a"); f.storage.set("old-snapshot", "private");
  f.switchAccount("http://127.0.0.1:8301");
  assert.equal(f.qc.getQueryData(["private"]), undefined); assert.equal(f.storage.size, 0);
  release(); f.qc.clear();
});

test("a snapshot restoration already awaiting storage cannot hydrate the next account", async () => {
  const f = cacheFixture(), release = f.cache.installSessionCacheIsolation();
  const source = new QueryClient({ defaultOptions: { queries: { gcTime: 0 } } });
  source.setQueryData(["folders"], [{ id: "old", name: "Private account A" }]);
  const { dehydrate } = nativeRequire("@tanstack/react-query");
  const key = f.persist.queryCacheStorageKey("a", "http://127.0.0.1:8301");
  f.storage.set(key, JSON.stringify({ timestamp: Date.now(), buster: f.persist.QUERY_CACHE_BUSTER, clientState: dehydrate(source) }));
  const restoring = f.cache.restoreQueryPersistence("a", "http://127.0.0.1:8301");
  f.switchAccount(); f.qc.setQueryData(["folders"], [{ id: "b", name: "Account B" }]);
  await restoring;
  assert.deepEqual(f.qc.getQueryData(["folders"]), [{ id: "b", name: "Account B" }]);
  release(); f.cache.stopQueryPersistence(); source.clear(); f.qc.clear();
});
