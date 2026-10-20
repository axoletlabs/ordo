/** Run with: node --test apps/mobile/scripts/library-search-cache-path.test.cjs
 *
 * Audit finding 2 — cachedItems' localItems dependency bypassed the 150ms
 * cache-write coalescer. The visible library list is itself the
 * `["bookmarks", null, sort]` query, so every optimistic write changed
 * homeItems immediately (collect+compile) and then repeated the identical
 * work ~150ms later when the coalesced cacheRevision landed: two recomputes
 * per burst for one result.
 *
 * These tests execute the REAL useLibrarySearch on a real React host
 * (react-dom + jsdom, hoisted into node_modules via @ordo/server) with a real
 * QueryClient. The harness mounts the same home-list query shape the library
 * screen uses and derives localItems from its pages exactly like
 * app/(app)/(tabs)/index.tsx does, proving the list is cache-backed.
 * compileSearchResults and collectCachedBookmarks are counted through the
 * actual sources (passthrough wrappers over the real exports).
 *
 * Pass ORDO_LIBRARY_SEARCH_SOURCE=/path/to/use-library-search.ts to run the
 * same assertions against another copy of the hook (e.g. the pre-fix source
 * extracted with `git show HEAD:apps/mobile/src/hooks/use-library-search.ts`)
 * and compare the logged counts.
 */
const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const { resolve, dirname } = require("node:path");
const { test } = require("node:test");
const ts = require("typescript");
const reactQuery = require("@tanstack/react-query");
const React = require("react");
const { createRoot } = require("react-dom/client");
const { JSDOM } = require("jsdom");

const dom = new JSDOM("<!doctype html><html><body></body></html>", { pretendToBeVisual: true });
globalThis.window = dom.window;
globalThis.document = dom.window.document;
try {
  Object.defineProperty(globalThis, "navigator", { value: dom.window.navigator, configurable: true, writable: true });
} catch { /* Node's own navigator global is not reconfigurable; React DOM works without it. */ }
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const { act, createElement } = React;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const srcHooks = resolve(__dirname, "../src/hooks");
const srcLib = resolve(__dirname, "../src/lib");
const hookSource = process.env.ORDO_LIBRARY_SEARCH_SOURCE ?? resolve(srcHooks, "use-library-search.ts");

const HOME_SORT = "newest";
const PROTECTED_FOLDER = "vault";
const PUBLIC_FOLDER = "pub";

function bookmark(id, folderId, extra = {}) {
  return {
    id,
    title: `Example ${id}`,
    url: `https://example.com/${id}`,
    domain: "example.com",
    description: null,
    createdAt: `2026-10-${(10 + Number(id.replace(/\D/g, "")) % 20).toString().padStart(2, "0")}T00:00:00Z`,
    updatedAt: `2026-10-${(10 + Number(id.replace(/\D/g, "")) % 20).toString().padStart(2, "0")}T00:00:00Z`,
    isRead: false,
    tags: [],
    suggestedTags: [],
    folderId,
    fetchStatus: "ok",
    contentKind: "web",
    remindAt: null,
    ...extra,
  };
}

const homeRows = () => [bookmark("b1", null, { isRead: false }), bookmark("b2", null, { isRead: true })];
const vaultRows = () => [bookmark("p1", PROTECTED_FOLDER)];
const publicRows = () => [bookmark("p2", PUBLIC_FOLDER)];
const catalogueRows = () => [bookmark("c1", null, { isRead: true, title: "Catalogue Example" })];
const paged = (items) => ({ pages: [{ items, nextCursor: null, hasMore: false }], pageParams: [null] });

function patchRow(data, id, patch) {
  return {
    ...data,
    pages: data.pages.map((page, index) => index === 0
      ? { ...page, items: page.items.map((b) => (b.id === id ? { ...b, ...patch } : b)) }
      : page),
  };
}

function setup() {
  const qc = new reactQuery.QueryClient({
    defaultOptions: { queries: { gcTime: Infinity, staleTime: Infinity, retry: false } },
  });
  const apiCalls = { list: 0, search: 0 };
  const api = {
    async list() { apiCalls.list++; return { items: homeRows(), nextCursor: null, hasMore: false }; },
    async search() { apiCalls.search++; return { items: [], nextCursor: null, hasMore: false }; },
    async listTagged() { return { items: [], nextCursor: null, hasMore: false }; },
  };

  // Real zustand store so accessRevision subscription/re-render semantics match production.
  const { create } = require("zustand");
  const tokens = new Map();
  const folderTokens = create((set) => ({
    accessRevision: 0,
    get: (id) => tokens.get(id) ?? null,
    unlock: (id, token) => { tokens.set(id, token); set((s) => ({ accessRevision: s.accessRevision + 1 })); },
    lockFolder: (id) => { tokens.delete(id); set((s) => ({ accessRevision: s.accessRevision + 1 })); },
  }));

  const modules = new Map();
  let qkExports;
  const stubs = {
    "expo-router": {
      useRouter: () => ({ setParams: () => {} }),
      useLocalSearchParams: () => ({}),
      useFocusEffect: () => {},
    },
    "react-native": { AppState: { currentState: "active", addEventListener: () => ({ remove: () => {} }) } },
    "../lib/api/bookmarks": { bookmarksApi: api },
    "../store/folder-tokens": { useFolderTokenStore: folderTokens },
    // Faithful copy of the real useInfiniteSearch: same key shape (so the
    // hook's subscription correctly skips its own search pages) and same api call.
    "./use-bookmarks": {
      useInfiniteSearch: (q, opts = {}) => {
        const term = q.trim();
        const tagIds = opts.tagIds ?? [], folderIds = opts.folderIds ?? [], unfiled = opts.unfiled ?? false;
        const unread = opts.unread ?? "all", fuzzy = opts.fuzzy ?? false, reminder = opts.reminder ?? "all";
        return reactQuery.useInfiniteQuery({
          queryKey: qkExports.search(term, tagIds, unread, folderIds, unfiled, fuzzy, reminder),
          queryFn: ({ pageParam }) => api.search(term, pageParam),
          initialPageParam: null,
          getNextPageParam: (page) => (page.hasMore && page.nextCursor ? page.nextCursor : undefined),
          enabled: opts.enabled ?? true,
        });
      },
    },
    "./use-refresh-feedback": { useRefreshFeedback: () => ({ refreshing: false, start: () => false, finish: () => {} }) },
    "../components/ui/toast-store": { toast: { error: () => {} } },
    "../lib/error-message": { errorMessage: (e) => String(e?.message ?? e) },
  };

  function load(filename, base = dirname(filename)) {
    if (modules.has(filename)) return modules.get(filename).exports;
    const source = readFileSync(filename, "utf8");
    const { outputText } = ts.transpileModule(source, {
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
    });
    const mod = { exports: {} };
    modules.set(filename, mod);
    const localRequire = (name) => {
      if (name in stubs) return stubs[name];
      if (name.startsWith(".")) {
        const withExt = name.endsWith(".ts") ? name : `${name}.ts`;
        return load(resolve(base, withExt));
      }
      return require(name);
    };
    new Function("require", "module", "exports", outputText)(localRequire, mod, mod.exports);
    return mod.exports;
  }

  const queryKeys = load(resolve(srcLib, "api/query-keys.ts"));
  qkExports = queryKeys.qk;
  const { sortBookmarksBy } = load(resolve(srcLib, "list-sort.ts"));
  const { flattenPages } = queryKeys;
  const searchBookmarks = load(resolve(srcLib, "search-bookmarks.ts"));
  const cacheHelpers = load(resolve(srcLib, "cache-helpers.ts"));
  const { useLibrarySearch } = load(hookSource, srcHooks);

  // Count calls through the actual sources (exports are read at call time).
  const counts = { compile: 0, collect: 0 };
  const realCompile = searchBookmarks.compileSearchResults;
  searchBookmarks.compileSearchResults = (...args) => { counts.compile++; return realCompile(...args); };
  const realCollect = cacheHelpers.collectCachedBookmarks;
  cacheHelpers.collectCachedBookmarks = (client) => { counts.collect++; return realCollect(client); };

  const HOME_KEY = qkExports.bookmarks(null, HOME_SORT);
  const VAULT_KEY = qkExports.bookmarks(PROTECTED_FOLDER, HOME_SORT);
  const INDEX_KEY = qkExports.libraryIndex(0);
  qc.setQueryData(HOME_KEY, paged(homeRows()));
  qc.setQueryData(VAULT_KEY, paged(vaultRows()));
  qc.setQueryData(qkExports.bookmarks(PUBLIC_FOLDER, HOME_SORT), paged(publicRows()));
  qc.setQueryData(INDEX_KEY, paged(catalogueRows()));

  const capture = { current: null };
  const folders = [
    { id: PUBLIC_FOLDER, name: "Public", protected: false, createdAt: "2026-10-01", bookmarkCount: 1, unreadCount: 1, icon: null, pinned: false },
    { id: PROTECTED_FOLDER, name: "Vault", protected: true, createdAt: "2026-10-01", bookmarkCount: 1, unreadCount: 1, icon: null, pinned: false },
  ];

  function Host({ localItems }) {
    capture.current = useLibrarySearch(localItems, folders);
    return null;
  }
  function Harness() {
    const home = reactQuery.useInfiniteQuery({
      queryKey: HOME_KEY,
      queryFn: ({ pageParam }) => api.list({ cursor: pageParam }),
      initialPageParam: null,
      getNextPageParam: (page) => (page.hasMore && page.nextCursor ? page.nextCursor : undefined),
    });
    // Mirrors index.tsx: localItems derive solely from the home query's cache.
    const localItems = React.useMemo(
      () => sortBookmarksBy(flattenPages(home.data?.pages ?? []), HOME_SORT),
      [home.data],
    );
    return createElement(Host, { localItems });
  }

  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  const render = () => act(() => { root.render(createElement(reactQuery.QueryClientProvider, { client: qc }, createElement(Harness))); });
  const snapshot = () => ({ ...counts });
  const resultIds = () => (capture.current?.items ?? []).map((b) => b.id);

  return {
    qc, api, apiCalls, counts, capture, folderTokens, render, snapshot, resultIds,
    HOME_KEY, VAULT_KEY, INDEX_KEY, keys: qkExports, filters: searchBookmarks.EMPTY_SEARCH_FILTERS,
    async unmount() { await act(async () => { root.unmount(); }); container.remove(); qc.clear(); },
  };
}

/** Activate a text search and let every debounce, fetch, and React's
 * act-deferred observer flush settle: under IS_REACT_ACT_ENVIRONMENT queued
 * updates only flush at act boundaries, so settle in rounds until quiet. */
async function activateSearch(s, query = "example") {
  s.render();
  await act(async () => { s.capture.current.setQuery(query); });
  let last = -1;
  for (let round = 0; round < 6; round++) {
    await act(async () => { await sleep(120); });
    const total = s.counts.collect + s.counts.compile;
    if (total === last) break;
    last = total;
  }
}

test("activation compiles the full cached catalogue immediately, respecting folder privacy", async (t) => {
  const s = setup();
  t.after(() => s.unmount());
  await activateSearch(s);
  // Cached matches were already complete on the activation render — no 150ms wait.
  const ids = s.resultIds();
  assert.ok(ids.includes("b1") && ids.includes("b2"), "home rows match");
  assert.ok(ids.includes("p2"), "public folder row outside the visible list matches");
  assert.ok(ids.includes("c1"), "catalogue-only row matches");
  assert.ok(!ids.includes("p1"), "locked-folder row stays hidden");
  assert.ok(s.counts.collect >= 1 && s.counts.compile >= 1);
  console.log(`[activation] collect=${s.counts.collect} compile=${s.counts.compile} ids=${ids.join(",")}`);
});

test("optimistic home write recomputes exactly once, via the coalescer (the audit fix)", async (t) => {
  const s = setup();
  t.after(() => s.unmount());
  await activateSearch(s);
  const before = s.snapshot();
  // The optimistic half of useToggleRead: patch the home list in the cache.
  await act(async () => {
    s.qc.setQueryData(s.HOME_KEY, (data) => patchRow(data, "b1", { isRead: true }));
    await sleep(10); // let the home observer re-render; still far from the 150ms deadline
  });
  const immediate = s.snapshot();
  assert.equal(immediate.collect - before.collect, 0, "no re-collect before the coalesce deadline");
  assert.equal(immediate.compile - before.compile, 0, "no re-compile before the coalesce deadline");
  await act(async () => { await sleep(250); });
  const settled = s.snapshot();
  assert.equal(settled.collect - before.collect, 1, "exactly one coalesced collect per burst");
  assert.equal(settled.compile - before.compile, 1, "exactly one coalesced compile per burst");
  const b1 = s.capture.current.items.find((b) => b.id === "b1");
  assert.equal(b1.isRead, true, "the written row is fresh in the results within the bound");
  console.log(`[audit] before={collect:${before.collect},compile:${before.compile}} ` +
    `immediateΔ={collect:${immediate.collect - before.collect},compile:${immediate.compile - before.compile}} ` +
    `totalΔ={collect:${settled.collect - before.collect},compile:${settled.compile - before.compile}}`);
});

test("new local rows become searchable within the 150ms bound", async (t) => {
  const s = setup();
  t.after(() => s.unmount());
  await activateSearch(s);
  const before = s.snapshot();
  await act(async () => {
    // insertCreatedBookmark's optimistic half: prepend to the home list.
    s.qc.setQueryData(s.HOME_KEY, (data) => ({
      ...data,
      pages: data.pages.map((page, i) => i === 0
        ? { ...page, items: [bookmark("fresh", null, { title: "Example fresh" }), ...page.items] }
        : page),
    }));
  });
  await act(async () => { await sleep(220); });
  assert.ok(s.resultIds().includes("fresh"), "new row searchable after the coalesced flush");
  const after = s.snapshot();
  assert.equal(after.collect - before.collect, 1, "one collect for one write");
  assert.equal(after.compile - before.compile, 1, "one compile for one write");
  console.log(`[fresh row] Δcollect=${after.collect - before.collect} Δcompile=${after.compile - before.compile} ids=${s.resultIds().join(",")}`);
});

test("folder unlock and lock update results immediately without any cache write", async (t) => {
  const s = setup();
  t.after(() => s.unmount());
  await activateSearch(s);
  assert.ok(!s.resultIds().includes("p1"));
  const before = s.snapshot();
  await act(async () => { s.folderTokens.getState().unlock(PROTECTED_FOLDER, "token"); });
  assert.ok(s.resultIds().includes("p1"), "unlocked row appears without waiting for the coalescer");
  await act(async () => { s.folderTokens.getState().lockFolder(PROTECTED_FOLDER); });
  assert.ok(!s.resultIds().includes("p1"), "locked row disappears without waiting for the coalescer");
  const after = s.snapshot();
  assert.equal(after.collect - before.collect, 2, "two immediate recomputes for two access changes");
  console.log(`[locks] Δcollect=${after.collect - before.collect} for unlock+lock, no cache writes`);
});

test("the hook's own search-page cache writes do not trigger a re-collect", async (t) => {
  const s = setup();
  t.after(() => s.unmount());
  await activateSearch(s);
  const before = s.snapshot();
  const searchKey = s.keys.search("example", [], "all", [], false, false, "all");
  await act(async () => { s.qc.setQueryData(searchKey, paged([bookmark("srv1", null, { title: "Example server" })])); });
  await act(async () => { await sleep(250); });
  const after = s.snapshot();
  assert.equal(after.collect - before.collect, 0, "search pages are skipped by the subscription");
  console.log(`[search writes] Δcollect=${after.collect - before.collect}`);
});

test("write bursts share one deadline and flush inside the bound (no starvation)", async (t) => {
  const s = setup();
  t.after(() => s.unmount());
  await activateSearch(s);
  const before = s.snapshot();
  await act(async () => {
    s.qc.setQueryData(s.VAULT_KEY, (data) => patchRow(data, "p1", { title: "Example p1" }));
    await sleep(60); // second write inside the first write's window
    s.qc.setQueryData(s.INDEX_KEY, (data) => patchRow(data, "c1", { description: "r" }));
    await sleep(120); // 180ms after the first write: past the shared 150ms deadline
  });
  const after = s.snapshot();
  assert.equal(after.collect - before.collect, 1, "burst collapsed into exactly one flush");
  assert.equal(after.compile - before.compile, 1);
  console.log(`[burst] Δcollect=${after.collect - before.collect} Δcompile=${after.compile - before.compile}`);
});

test("scope-only search (filters, no text) activates over the cached catalogue", async (t) => {
  const s = setup();
  t.after(() => s.unmount());
  s.render();
  await act(async () => { s.capture.current.setFilters({ ...s.filters, status: "unread" }); });
  const ids = s.resultIds();
  assert.ok(ids.includes("b1") && ids.includes("p2"), "unread cached rows appear immediately");
  assert.ok(!ids.includes("b2") && !ids.includes("c1"), "read rows are filtered out");
  assert.ok(!ids.includes("p1"), "locked rows stay private");
  console.log(`[scope only] collect=${s.counts.collect} compile=${s.counts.compile} ids=${ids.join(",")}`);
});
