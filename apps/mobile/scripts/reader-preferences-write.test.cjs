/** Run: node --test apps/mobile/scripts/reader-preferences-write.test.cjs
 * Actual-source test for the reader's account-synced preference writes with two
 * live useReaderPreferences subscriptions (the reader surface and the retained
 * controls panel). The real hook + optimistic mutation run against the real
 * React Query mutation cache and a stubbed auth API.
 *
 * Guards:
 *  - eight control presses enqueue exactly eight writes (no duplicate writes
 *    from the second subscription);
 *  - writes with the same mutation scope run one at a time;
 *  - an older server acknowledgement never replaces a newer optimistic choice.
 */
const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const { resolve, dirname } = require("node:path");
const { test } = require("node:test");
const ts = require("typescript");
const React = require("react");
const { createRoot } = require("react-dom/client");
const { JSDOM } = require("jsdom");
const { QueryClient, QueryClientProvider, useMutation } = require("@tanstack/react-query");

const sourceRoot = process.env.ORDO_CONTROL_SOURCE_ROOT ?? resolve(__dirname, "../src");
const dom = new JSDOM("<!doctype html><html><body></body></html>", { pretendToBeVisual: true });
globalThis.window = dom.window;
globalThis.document = dom.window.document;
globalThis.navigator = dom.window.navigator;
globalThis.requestAnimationFrame = (callback) => dom.window.requestAnimationFrame(callback);
globalThis.cancelAnimationFrame = (id) => dom.window.cancelAnimationFrame(id);
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const stamp = "2026-10-20T12:00:00Z";
const baseUser = {
  id: "reader-1", displayName: "Reader", email: "reader@example.test", emailVerified: true,
  hasAvatar: false, mfaEnabled: false, libraryEncrypted: false, canRenameInstance: false, createdAt: stamp,
  preferences: { fontFamily: "sans", fontSize: "medium", lineSpacing: "default", theme: "system", amoled: false },
};

/* --------------------------------- auth store -------------------------------- */

let authState = { user: baseUser, setUser: (next) => {
  authState = { ...authState, user: next };
  authListeners.forEach((notify) => notify());
} };
const authListeners = new Set();
function useAuthStore(selector) {
  const state = React.useSyncExternalStore(
    (notify) => { authListeners.add(notify); return () => authListeners.delete(notify); },
    () => authState,
    () => authState,
  );
  return selector ? selector(state) : state;
}
useAuthStore.getState = () => authState;

/* -------------------------------- auth writes -------------------------------- */

const writes = [];
const authApi = {
  updatePreferences(patch) {
    return new Promise((resolveWrite) => {
      writes.push({ patch, resolve: resolveWrite });
    });
  },
};
const queryClient = new QueryClient({ defaultOptions: { mutations: { retry: false } } });
const noop = () => {};

const stubs = {
  react: React,
  "@tanstack/react-query": { useMutation, useQueryClient: () => queryClient },
  "./use-session-mutation": { useSessionMutation: (options) => useMutation(options) },
  "../lib/query-client": { queryClient },
  "../lib/api/auth": { authApi },
  "../store/auth": { useAuthStore },
  "../store/folder-tokens": { useFolderTokenStore: (selector) => selector ? selector({}) : {} },
  "../lib/api/query-keys": { qk: new Proxy({}, { get: () => [] }) },
  "../lib/api/client": {
    ApiClientError: class ApiClientError extends Error {},
    cancelProactiveRefresh: noop,
    scheduleProactiveRefresh: noop,
  },
  "../lib/telemetry-policy": { countsAsSignInFailure: () => false },
  "../lib/telemetry": { noteSignInFailure: noop },
};

const modules = new Map();
function resolveLocal(from, name) {
  for (const candidate of [name, `${name}.tsx`, `${name}.ts`]) {
    const path = resolve(from, candidate);
    try { readFileSync(path); return path; } catch {}
  }
  throw new Error(`Cannot resolve ${name} from ${from}`);
}
function load(filename) {
  if (modules.has(filename)) return modules.get(filename).exports;
  const module = { exports: {} };
  modules.set(filename, module);
  const source = readFileSync(filename, "utf8");
  const { outputText } = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true },
  });
  const localRequire = (name) => {
    if (stubs[name]) return stubs[name];
    if (name === "react") return React;
    if (name.startsWith(".")) return load(resolveLocal(dirname(filename), name));
    return require(name);
  };
  new Function("require", "module", "exports", outputText)(localRequire, module, module.exports);
  return module.exports;
}

const { useReaderPreferences } = load(resolve(sourceRoot, "hooks/use-reader-preferences.ts"));

const patchList = [
  { fontFamily: "serif" },
  { fontSize: "large" },
  { lineSpacing: "relaxed" },
  { theme: "light" },
  { amoled: true },
  { fontSize: "xlarge" },
  { fontFamily: "jost" },
  { theme: "dark" },
];
const finalPreferences = {
  fontFamily: "jost", fontSize: "xlarge", lineSpacing: "relaxed", theme: "dark", amoled: true,
};

let writeHandler = null;
function ReaderSurface() {
  const { preferences } = useReaderPreferences();
  return React.createElement("span", { "data-surface": JSON.stringify(preferences) });
}
function ControlsPanel() {
  const { preferences, setPreferences } = useReaderPreferences();
  writeHandler = () => patchList.forEach((patch) => setPreferences(patch));
  return React.createElement("span", { "data-panel": JSON.stringify(preferences) });
}

const delay = (ms) => new Promise((resolveTimer) => setTimeout(resolveTimer, ms));
const flush = async () => { await React.act(async () => { await delay(0); }); };

test("two reader preference subscriptions keep eight presses as eight serialized writes", async () => {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  await React.act(async () => {
    root.render(
      React.createElement(QueryClientProvider, { client: queryClient },
        React.createElement(ReaderSurface),
        React.createElement(ControlsPanel)),
    );
  });

  await React.act(async () => { writeHandler(); });
  await flush();

  assert.equal(writes.length, 1, "the scoped mutation queue starts one write at a time");
  assert.deepEqual(authState.user.preferences, finalPreferences, "the last optimistic choice is visible immediately");

  const sent = [];
  let serverPreferences = { ...baseUser.preferences };
  for (let index = 0; index < patchList.length; index++) {
    const write = writes[index];
    assert.ok(write, `write ${index + 1} is queued`);
    sent.push(write.patch);
    assert.equal(writes.length, index + 1, `exactly one new write starts after acknowledge ${index + 1}`);
    await React.act(async () => {
      // The server applies queued writes in order, so its answer can trail the
      // newest optimistic press.
      serverPreferences = { ...serverPreferences, ...write.patch };
      write.resolve({ ...baseUser, preferences: serverPreferences });
      await delay(0);
    });
    await flush();
    if (index < patchList.length - 1) {
      assert.deepEqual(authState.user.preferences, finalPreferences,
        `acknowledgement ${index + 1} must not replace the newer optimistic choice`);
    }
  }

  assert.equal(writes.length, patchList.length, "eight presses produce eight writes, not sixteen");
  assert.deepEqual(sent, patchList, "writes keep the press order");
  assert.deepEqual(authState.user.preferences, finalPreferences, "the final server acknowledgement matches the last choice");
  await React.act(async () => { root.unmount(); });
  container.remove();
});
