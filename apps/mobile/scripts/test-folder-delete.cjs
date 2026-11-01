/** Replay the recordings' folder delete/keep/Undo sequences with real query caches. */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');
const { QueryClient, dehydrate } = require('@tanstack/react-query');

const sourceRoot = path.resolve(__dirname, '../src');
const folder = { id: 'test', name: 'test', bookmarkCount: 3, unreadCount: 3,
  createdAt: '2026-10-31T00:00:00.000Z', protected: false };
const bookmarks = ['DeepSWE', 'The Grug Brained Developer', 'github.com'].map((title, i) => ({
  id: `bookmark-${i}`, title, url: `https://example.test/${i}`, folderId: folder.id,
  createdAt: `2026-10-31T00:00:0${i}.000Z`, updatedAt: '2026-10-31T00:00:00.000Z',
  tags: [], suggestedTags: [], isRead: false, remindAt: null,
}));
const page = items => ({ pages: [{ items, nextCursor: null, hasMore: false }], pageParams: [null] });
const rows = (qc, key) => qc.getQueryData(key)?.pages.flatMap(page => page.items) ?? [];

function harness({ pickerOnly = false, protectedFolder = false, unlocked = false } = {}) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: Infinity } } });
  const journal = [];
  const requests = [];
  const errors = [];
  let deleteResult;
  let deleteError;
  const mocks = {
    './query-client': { queryClient: qc },
    '../components/ui/toast-store': { toast: { success: () => 'toast', dismiss() {}, error: e => errors.push(e) } },
    './haptics': { haptics: { success() {} } },
    './error-message': { errorMessage: e => e.message },
    './api/client': { ApiClientError: class extends Error {
      constructor(status, body) { super(body.message); this.status = status; this.code = body.code; }
    } },
    './api/bookmarks': { bookmarksApi: { remove: async id => requests.push({ id }) } },
    './api/tags': { tagsApi: {} },
    './api/folders': { foldersApi: {
      deleteWithKeeps: async (id, keepIds) => {
        requests.push({ id, keepIds });
        if (deleteError) throw deleteError;
        return deleteResult ?? { keptIds: keepIds, keptBookmarks: keepIds.length, deletedBookmarks: 3 - keepIds.length };
      },
      remove: async id => requests.push({ id }),
    } },
    '../store/folder-tokens': { useFolderTokenStore: { getState: () => ({ get: () => unlocked ? 'token' : null, clear() {} }) } },
    './session-scope': { captureSessionScope: () => ({}), isSessionScopeCurrent: () => true, assertSessionScope() {} },
    './delete-journal': {
      deleteJournalKey: () => 'session', readDeleteIntents: () => journal,
      recordDeleteIntent: input => {
        const intent = { ...input, id: `delete-${journal.length}` };
        journal.push(intent);
        return { key: 'session', intent };
      },
      forgetDeleteIntent: (_key, id) => { const index = journal.findIndex(intent => intent.id === id); if (index >= 0) journal.splice(index, 1); },
    },
  };
  const modules = new Map();
  function load(file) {
    if (modules.has(file)) return modules.get(file);
    const exports = {};
    modules.set(file, exports);
    const code = ts.transpileModule(fs.readFileSync(file, 'utf8'), {
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
    }).outputText;
    vm.runInNewContext(code, { exports, setTimeout, clearTimeout, require: name => mocks[name] ?? (
      name.startsWith('.') ? load(path.resolve(path.dirname(file), `${name}.ts`)) : require(name)
    ) }, { filename: file });
    return exports;
  }
  const { qk } = load(path.join(sourceRoot, 'lib/api/query-keys.ts'));
  const api = load(path.join(sourceRoot, 'lib/undoable-delete.ts'));
  const cache = load(path.join(sourceRoot, 'lib/cache-helpers.ts'));
  const persistence = load(path.join(sourceRoot, 'lib/query-persist.ts'));
  const target = { ...folder, protected: protectedFolder };
  const rootKey = qk.bookmarks(null, 'newest');
  const folderKey = qk.bookmarks(folder.id, 'newest');
  qc.setQueryData(qk.folders, [target]);
  qc.setQueryData(rootKey, page([]));
  qc.setQueryData(folderKey, page(pickerOnly ? [] : bookmarks));
  qc.setQueryData(['bookmarks', 'folder-options', folder.id, 0], bookmarks);
  if (!pickerOnly) {
    qc.setQueryData(qk.libraryIndex(0), page(bookmarks));
    qc.setQueryData(qk.bookmark(bookmarks[0].id), { ...bookmarks[0], contentHtml: '<p>Article</p>', highlights: [] });
  }
  return { qc, qk, rootKey, folderKey, target, requests, journal, errors, ...api, ...cache, ...persistence,
    setResult: value => { deleteResult = value; }, setError: error => { deleteError = error; },
    remove: (ids, options = {}) => api.deleteUndoable({ folders: [target], keepIds: ids, showToast: false, ...options }),
  };
}

const tests = [];
const test = (name, run) => tests.push({ name, run });
const flush = async () => { for (let i = 0; i < 6; i++) await new Promise(resolve => setImmediate(resolve)); };

for (const count of [1, 2, 3]) test(`keep ${count} of 3 visible immediately and Undo restores all 3`, () => {
  const h = harness();
  const action = h.remove(bookmarks.slice(0, count).map(b => b.id));
  assert.equal(rows(h.qc, h.rootKey).length, count, 'kept bookmarks must not vanish during Undo');
  assert.equal(h.requests.length, 0, 'Undo window must defer server deletion');
  assert.equal(h.qc.getQueryData(h.qk.folders).length, 0);
  action.undo();
  assert.equal(rows(h.qc, h.rootKey).length, 0, 'Undo removes provisional root membership');
  assert.equal(rows(h.qc, h.folderKey).length, 3);
  assert.equal(h.qc.getQueryData(h.qk.folders)[0].bookmarkCount, 3);
  assert.equal(h.journal.length, 0);
  h.qc.clear();
});

test('background refetch cannot hide kept rows or resurrect discarded rows', () => {
  const h = harness();
  const action = h.remove([bookmarks[0].id]);
  h.qc.setQueryData(h.rootKey, page([]));
  h.qc.setQueryData(h.qk.libraryIndex(0), page(bookmarks));
  assert.equal(rows(h.qc, h.rootKey).length, 1);
  assert.equal(rows(h.qc, h.qk.libraryIndex(0)).length, 1);
  action.undo();
  h.qc.clear();
});

test('keeps loaded only by the picker are visible without opening their folder', () => {
  const h = harness({ pickerOnly: true });
  const action = h.remove([bookmarks[0].id]);
  assert.equal(rows(h.qc, h.rootKey)[0]?.id, bookmarks[0].id);
  action.undo();
  h.qc.clear();
});

test('a new root query opened during Undo receives keeps with their real source folder', () => {
  const h = harness();
  const action = h.remove([bookmarks[0].id]);
  const rootKey = h.qk.bookmarks(null, 'title');
  h.qc.setQueryData(rootKey, page([]));
  assert.equal(rows(h.qc, rootKey)[0]?.id, bookmarks[0].id);
  assert.equal(rows(h.qc, rootKey)[0]?.folderId, folder.id, 'source remains accurate until the server confirms');
  action.undo();
  assert.equal(rows(h.qc, rootKey).length, 0);
  h.qc.clear();
});

test('editing a visible keep during Undo retains the edit and the reader body', () => {
  const h = harness();
  const action = h.remove([bookmarks[0].id]);
  h.qc.setQueryData(h.qk.bookmark(bookmarks[0].id), current => ({ ...current,
    title: 'Updated while Undo was available', updatedAt: '2026-10-31T01:00:00.000Z' }));
  action.undo();
  const restored = rows(h.qc, h.folderKey).find(row => row.id === bookmarks[0].id);
  assert.equal(restored.title, 'Updated while Undo was available');
  assert.equal('contentHtml' in restored, false, 'reader bodies stay out of restored lists');
  assert.equal(h.qc.getQueryData(h.qk.bookmark(bookmarks[0].id)).contentHtml, '<p>Article</p>');
  h.qc.clear();
});

test('provisional keeps never copy reader bodies into list rows or disk snapshots', () => {
  const h = harness({ protectedFolder: true, unlocked: true });
  const action = h.remove([bookmarks[0].id]);
  const rootRows = rows(h.qc, h.rootKey);
  assert.equal(rootRows.length, 1);
  assert.equal('contentHtml' in rootRows[0], false);
  assert.equal('highlights' in rootRows[0], false);
  const snapshot = h.sanitizePersistedClient({ timestamp: Date.now(), buster: 'test', clientState: dehydrate(h.qc) });
  const storedRoot = snapshot.clientState.queries.find(query => JSON.stringify(query.queryKey) === JSON.stringify(h.rootKey));
  assert.equal(storedRoot.state.data.pages[0].items.length, 0, 'unconfirmed source-folder rows stay in memory');
  assert.equal(rows(h.qc, h.rootKey).length, 1, 'sanitizing disk data must not change the live UI');
  action.undo();
  h.qc.clear();
});

test('moving a keep during Undo does not pull it back to the deleted folder', () => {
  const h = harness();
  const action = h.remove([bookmarks[0].id]);
  h.moveBookmarksInCache(h.qc, [{ ...bookmarks[0], folderId: 'another-folder', updatedAt: '2026-10-31T01:00:00.000Z' }]);
  h.qc.setQueryData(h.rootKey, page([]));
  assert.equal(rows(h.qc, h.rootKey).length, 0);
  action.undo();
  assert.equal(rows(h.qc, h.folderKey).length, 2);
  assert.equal(h.qc.getQueryData(h.qk.bookmark(bookmarks[0].id)).folderId, 'another-folder');
  h.qc.clear();
});

test('ordinary folder deletion still hides all rows and Undo restores them', () => {
  const h = harness();
  const action = h.remove([]);
  assert.equal(rows(h.qc, h.rootKey).length, 0);
  assert.equal(rows(h.qc, h.qk.libraryIndex(0)).length, 0);
  action.undo();
  assert.equal(rows(h.qc, h.folderKey).length, 3);
  assert.equal(rows(h.qc, h.qk.libraryIndex(0)).length, 3);
  h.qc.clear();
});

test('an explicit delete of a visible keep is not resurrected by folder Undo', () => {
  const h = harness();
  const action = h.remove([bookmarks[0].id]);
  const bookmarkDelete = h.deleteUndoable({ bookmarks: [bookmarks[0]], showToast: false });
  assert.equal(rows(h.qc, h.rootKey).length, 0);
  action.undo();
  assert.equal(rows(h.qc, h.folderKey).length, 2);
  bookmarkDelete.undo();
  assert.equal(rows(h.qc, h.folderKey).length, 3);
  h.qc.clear();
});

test('commit uses the atomic endpoint and retains exactly the server-confirmed keeps', async () => {
  const h = harness();
  h.remove([bookmarks[0].id, bookmarks[1].id]).commit();
  await flush();
  assert.equal(h.requests.length, 1);
  assert.equal(h.requests[0].keepIds.join(','), `${bookmarks[0].id},${bookmarks[1].id}`);
  assert.equal(rows(h.qc, h.rootKey).length, 2);
  assert.ok(rows(h.qc, h.rootKey).every(row => row.folderId === null));
  assert.equal(h.collectCachedBookmarks(h.qc).length, 2, 'closed picker must not retain cascaded bookmarks for search');
  const snapshot = h.sanitizePersistedClient({ timestamp: Date.now(), buster: 'test', clientState: dehydrate(h.qc) });
  const storedRoot = snapshot.clientState.queries.find(query => JSON.stringify(query.queryKey) === JSON.stringify(h.rootKey));
  assert.equal(storedRoot.state.data.pages[0].items.length, 2, 'confirmed unfiled keeps can persist normally');
  assert.ok(storedRoot.state.data.pages[0].items.every(row => !('contentHtml' in row)));
  assert.equal(h.journal.length, 0);
  h.qc.clear();
});

test('a keep moved elsewhere on another device is not claimed as preserved', async () => {
  const h = harness();
  h.setResult({ keptIds: [bookmarks[0].id], keptBookmarks: 1, deletedBookmarks: 1 });
  h.remove([bookmarks[0].id, bookmarks[1].id]).commit();
  await flush();
  assert.equal(rows(h.qc, h.rootKey).map(row => row.id).join(','), bookmarks[0].id);
  h.qc.clear();
});

test('network failure retains visible keeps and the durable retry', async () => {
  const h = harness();
  h.setError(new Error('Network request failed'));
  h.remove([bookmarks[0].id]).commit();
  await flush();
  assert.equal(h.journal.length, 1);
  assert.equal(rows(h.qc, h.rootKey).length, 1);
  h.setError(null);
  h.resumePendingDeletes();
  await flush();
  assert.equal(h.journal.length, 0);
  assert.equal(rows(h.qc, h.rootKey)[0]?.folderId, null);
  h.qc.clear();
});

test('a locked folder cannot disappear or send a delete request', () => {
  const h = harness({ protectedFolder: true });
  h.remove([bookmarks[0].id]).commit();
  assert.equal(h.journal.length, 0);
  assert.equal(h.qc.getQueryData(h.qk.folders).length, 1);
  assert.equal(h.requests.length, 0);
  assert.equal(h.errors.length, 1);
  h.qc.clear();
});

(async () => {
  let failures = 0;
  for (const { name, run } of tests) {
    try { await run(); console.log(`PASS: ${name}`); }
    catch (error) { failures++; console.error(`FAIL: ${name}\n${error.stack}`); }
  }
  console.log(`${tests.length - failures}/${tests.length} folder deletion regressions passed`);
  process.exitCode = failures ? 1 : 0;
})().catch(error => { console.error(error); process.exitCode = 1; });
