/** Run with: node --test apps/mobile/scripts/tag-update.test.cjs */
const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const { resolve, dirname } = require("node:path");
const { test } = require("node:test");
const ts = require("typescript");
const reactQuery = require("@tanstack/react-query");

// Exercise the actual mutation callbacks and cache walkers with a real QueryClient,
// without loading native storage/network modules or mounting a native renderer.
function setup() {
  const qc = new reactQuery.QueryClient({ defaultOptions: { queries: { gcTime: Infinity } } });
  const modules = new Map();
  function load(filename) {
    if (modules.has(filename)) return modules.get(filename).exports;
    const source = readFileSync(filename, "utf8");
    const { outputText } = ts.transpileModule(source, {
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
    });
    const mod = { exports: {} };
    modules.set(filename, mod);
    const localRequire = (name) => {
      if (name === "@tanstack/react-query") return {
        ...reactQuery, useQueryClient: () => qc, useMutation: (options) => options,
      };
      if (/api\/(tags|bookmarks)$|query-client$|folder-tokens$|undoable-delete$/.test(name)) return {};
      if (name.startsWith(".")) return load(resolve(dirname(filename), `${name}.ts`));
      return require(name);
    };
    new Function("require", "module", "exports", outputText)(localRequire, mod, mod.exports);
    return mod.exports;
  }
  const { qk } = load(resolve(__dirname, "../src/lib/api/query-keys.ts"));
  const { useUpdateTag } = load(resolve(__dirname, "../src/hooks/use-tags.ts"));
  const existing = { id: "test", name: "Test", color: "blue", bookmarkCount: 2 };
  const original = { id: "test3", name: "Test3", color: "red", bookmarkCount: 2 };
  const bookmark = {
    id: "bookmark", createdAt: "2026-10-18", updatedAt: "2026-10-18",
    title: "DeepSWE", isRead: false, tags: [existing, original], suggestedTags: [original],
  };
  const keys = [qk.bookmarks(null, "newest"), qk.search("Test3"), qk.tagged([original.id]), qk.libraryIndex(0)];
  for (const key of keys) qc.setQueryData(key, {
    pages: [{ items: [bookmark], nextCursor: null, hasMore: false }], pageParams: [null],
  });
  qc.setQueryData(qk.bookmark(bookmark.id), { ...bookmark, contentHtml: "<p>Keep article</p>" });
  qc.setQueryData(qk.extractionProgress, { pending: 1 });
  qc.setQueryData(qk.reminders, []);
  for (const revision of [0, 1]) qc.setQueryData(qk.tags(revision), [existing, original]);
  const rows = () => [...keys.map((key) => qc.getQueryData(key).pages[0].items[0]), qc.getQueryData(qk.bookmark(bookmark.id))];
  const variables = { id: original.id, input: { name: "Test", color: "blue" } };
  return { qc, qk, mutation: useUpdateTag(), original, existing, keys, rows, variables };
}

test("rejected duplicate rename restores assigned and suggested tags in every bookmark cache", async () => {
  const s = setup();
  const context = await s.mutation.onMutate(s.variables);
  for (const row of s.rows()) assert.equal(row.tags[1].name, "Test");
  s.mutation.onError(new Error("A tag with this name already exists."), s.variables, context);
  for (const row of s.rows()) {
    assert.deepEqual(row.tags, [s.existing, s.original]);
    assert.deepEqual(row.suggestedTags, [s.original]);
  }
  for (const revision of [0, 1]) assert.deepEqual(s.qc.getQueryData(s.qk.tags(revision)), [s.existing, s.original]);
  assert.equal(s.qc.getQueryData(s.qk.bookmark("bookmark")).contentHtml, "<p>Keep article</p>");
  assert.deepEqual(s.qc.getQueryData(s.qk.extractionProgress), { pending: 1 });
});

test("failed recolor also restores metadata when no tag catalogue is cached", async () => {
  const s = setup();
  s.qc.removeQueries({ queryKey: ["tags"] });
  const variables = { id: s.original.id, input: { color: "green" } };
  const context = await s.mutation.onMutate(variables);
  s.mutation.onError(new Error("Offline"), variables, context);
  for (const row of s.rows()) assert.deepEqual(row.tags[1], s.original);
});

test("rollback preserves concurrent read, assignment, suggestion, and other-tag edits", async () => {
  const s = setup();
  const context = await s.mutation.onMutate(s.variables);
  const key = s.qk.bookmark("bookmark");
  s.qc.setQueryData(key, (row) => ({
    ...row, isRead: true, title: "New title", suggestedTags: [],
    tags: row.tags.map((tag) => tag.id === s.existing.id ? { ...tag, name: "Other edit" } : tag),
  }));
  s.qc.setQueryData(s.qk.tags(0), (tags) => [...tags.map((tag) => tag.id === s.existing.id ? { ...tag, name: "Other edit" } : tag),
    { id: "new", name: "New tag", color: "green", bookmarkCount: 0 }]);
  s.mutation.onError(new Error("Conflict"), s.variables, context);
  const row = s.qc.getQueryData(key);
  assert.equal(row.isRead, true);
  assert.equal(row.title, "New title");
  assert.equal(row.tags[0].name, "Other edit");
  assert.deepEqual(row.tags[1], s.original);
  assert.deepEqual(row.suggestedTags, []);
  assert.equal(s.qc.getQueryData(s.qk.tags(0))[0].name, "Other edit");
  assert.equal(s.qc.getQueryData(s.qk.tags(0))[2].id, "new");
});

test("rollback does not overwrite a newer change to the same tag", async () => {
  const s = setup();
  const context = await s.mutation.onMutate(s.variables);
  const key = s.qk.bookmark("bookmark");
  s.qc.setQueryData(key, (row) => ({ ...row, tags: row.tags.map((tag) =>
    tag.id === s.original.id ? { ...tag, name: "Newer name", color: "green" } : tag) }));
  s.mutation.onError(new Error("Conflict"), s.variables, context);
  assert.equal(s.qc.getQueryData(key).tags[1].name, "Newer name");
  assert.equal(s.qc.getQueryData(key).tags[1].color, "green");
});

test("successful updates reconcile server metadata into lists, search index, and reader", async () => {
  const s = setup();
  await s.mutation.onMutate(s.variables);
  const updated = { ...s.original, name: "Canonical name", color: "green" };
  s.mutation.onSuccess(updated, s.variables);
  for (const row of s.rows()) {
    assert.equal(row.tags[1].name, updated.name);
    assert.equal(row.tags[1].color, updated.color);
    assert.equal(row.suggestedTags[0].name, updated.name);
  }
  for (const revision of [0, 1]) assert.deepEqual(s.qc.getQueryData(s.qk.tags(revision)), [updated, s.existing]);
});

test("in-flight reads are cancelled before the optimistic edit", async () => {
  const s = setup();
  let cancelled = false;
  const pending = s.qc.fetchQuery({
    queryKey: s.qk.tags(0),
    queryFn: ({ signal }) => new Promise((resolve) => {
      signal.addEventListener("abort", () => { cancelled = true; resolve([s.existing, s.original]); });
    }),
  }).catch(() => {});
  await s.mutation.onMutate(s.variables);
  assert.equal(cancelled, true);
  await pending;
  assert.equal(s.qc.getQueryData(s.qk.tags(0))[1].name, "Test");
});
