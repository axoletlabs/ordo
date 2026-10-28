/** Exercise tag edits with real TanStack mutations and cache helpers. */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');
const { QueryClient } = require('@tanstack/react-query');

const qc = new QueryClient({ defaultOptions: { mutations: { retry: false, gcTime: Infinity } } });
let request;
const mocks = {
  '@tanstack/react-query': { useQueryClient: () => qc },
  './use-session-mutation': {
    useSessionMutation: options => qc.getMutationCache().build(qc, options),
  },
  '../lib/api/tags': { tagsApi: { update: () => {
    request.started();
    return request.result;
  } } },
  '../lib/query-client': { queryClient: qc },
  '../lib/api/bookmarks': {},
  '../store/folder-tokens': {},
  '../lib/undoable-delete': {},
};
const modules = new Map();
function load(file) {
  if (modules.has(file)) return modules.get(file);
  const exports = {};
  modules.set(file, exports);
  const code = ts.transpileModule(fs.readFileSync(file, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  vm.runInNewContext(code, { exports, require: name => mocks[name] ?? (
    name.startsWith('.') ? load(path.resolve(path.dirname(file), `${name}.ts`)) : require(name)
  ) }, { filename: file });
  return exports;
}
const { useUpdateTag } = load(path.resolve(__dirname, '../src/hooks/use-tags.ts'));
const { qk } = load(path.resolve(__dirname, '../src/lib/api/query-keys.ts'));
const original = { id: 'tag-1', name: 'Test', color: 'blue', bookmarkCount: 1 };
const other = { id: 'tag-2', name: 'Test2', color: 'red', bookmarkCount: 1 };
const bookmark = {
  id: 'bookmark-1', title: 'Original title', createdAt: '2026-10-28T00:00:00.000Z',
  tags: [original], suggestedTags: [original, other], contentHtml: '<p>Article</p>',
};
const keys = [qk.tags(0), qk.tags(1), qk.bookmarks(null), qk.tagged([original.id]), qk.bookmark(bookmark.id)];
function seed() {
  qc.clear();
  for (const key of keys.slice(0, 2)) qc.setQueryData(key, [original, other]);
  for (const key of keys.slice(2, 4)) qc.setQueryData(key, { pages: [{ items: [bookmark] }], pageParams: [null] });
  qc.setQueryData(keys[4], bookmark);
  qc.setQueryData(qk.extractionProgress, { pending: 2 });
}
function begin(input) {
  let started;
  const ready = new Promise(resolve => { started = resolve; });
  request = { started };
  request.result = new Promise((resolve, reject) => { request.resolve = resolve; request.reject = reject; });
  const outcome = useUpdateTag().execute({ id: original.id, input });
  // Observe rejection immediately so the controlled API failure is handled.
  outcome.catch(() => {});
  return { ready, outcome };
}

(async () => {
  for (const message of ['A tag with this name already exists.', 'Network request failed']) {
    seed();
    const before = keys.map(key => qc.getQueryData(key));
    const { ready, outcome } = begin({ name: 'Test2', color: 'red' });
    await ready;
    keys.forEach((key, i) => assert.equal(qc.getQueryData(key), before[i], 'pending edits stay in the form'));
    qc.setQueryData(keys[4], current => ({ ...current, title: 'Concurrent edit' }));
    request.reject(new Error(message));
    await assert.rejects(outcome, { message });
    keys.slice(0, 4).forEach((key, i) => assert.equal(qc.getQueryData(key), before[i], 'rejected edits never change cached tags'));
    assert.equal(qc.getQueryData(keys[4]).title, 'Concurrent edit');
    assert.equal(qc.getQueryData(keys[4]).tags[0].name, 'Test');
  }

  seed();
  const { ready, outcome } = begin({ name: '  Zebra  ', color: 'green' });
  await ready;
  assert.equal(qc.getQueryData(keys[0])[0].name, 'Test', 'successful edits also wait for confirmation');
  request.resolve({ ...original, name: 'Zebra', color: 'green' });
  await outcome;
  for (const key of keys.slice(0, 2)) {
    const tags = qc.getQueryData(key);
    assert.equal(tags[0].id, other.id, 'confirmed rename reorders the catalogue');
    assert.equal(tags[1].name, 'Zebra', 'publish server-normalized name');
    assert.equal(tags[1].color, 'green');
  }
  for (const key of keys.slice(2)) {
    const data = qc.getQueryData(key);
    const item = data.pages ? data.pages[0].items[0] : data;
    for (const tag of [item.tags[0], item.suggestedTags[0]]) {
      assert.equal(tag.name, 'Zebra');
      assert.equal(tag.color, 'green');
    }
    assert.equal(item.suggestedTags[1].name, other.name);
    assert.equal(item.contentHtml, bookmark.contentHtml);
  }
  assert.equal(qc.getQueryData(qk.extractionProgress).pending, 2);
  qc.clear();
  console.log('PASS: rejected/pending tag edits stay stable; confirmed edits update catalogues and bookmark chips');
})().catch(error => { console.error(error); process.exitCode = 1; });
