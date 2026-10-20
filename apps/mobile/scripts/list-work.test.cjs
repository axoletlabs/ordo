/** Run with: node --test apps/mobile/scripts/list-work.test.cjs
 *
 * Guards the general list-work pass:
 *  - countUniquePageItems matches flattenPages(...).length for every page
 *    shape (retried first page, id-less rows, non-string ids, empty pages)
 *    while doing zero row pushes.
 *  - the canonical-ISO date fast path matches the old localeCompare order
 *    byte-for-byte; odd/legacy timestamps take the fallback untouched.
 *  - sortBookmarkPagesBy matches sortBookmarksBy(flattenPages(...)) for all
 *    sorts, without mutating pages or the caller's array.
 *  - before/after work counts and a small benchmark are printed for the
 *    parent session.
 */
const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const { dirname, resolve } = require("node:path");
const { test } = require("node:test");
const ts = require("typescript");

const SRC = resolve(__dirname, "../src");

function loadFile(filename) {
  const { outputText } = ts.transpileModule(readFileSync(filename, "utf8"), {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
      esModuleInterop: true,
    },
  });
  const module = { exports: {} };
  const localRequire = (name) => {
    if (!name.startsWith(".")) return require(name);
    const withExt = name.endsWith(".ts") ? name : `${name}.ts`;
    return loadFile(resolve(dirname(filename), withExt));
  };
  new Function("require", "module", "exports", outputText)(localRequire, module, module.exports);
  return module.exports;
}

const load = (relative) => loadFile(resolve(SRC, relative));
const queryKeys = load("lib/api/query-keys.ts");
const listSort = load("lib/list-sort.ts");
const controlsSource = readFileSync(resolve(SRC, "hooks/use-list-controls.ts"), "utf8");
const homeSource = readFileSync(resolve(SRC, "../app/(app)/(tabs)/index.tsx"), "utf8");
const folderSource = readFileSync(resolve(SRC, "../app/(app)/folder/[id].tsx"), "utf8");

const { flattenPages, countUniquePageItems } = queryKeys;
const { sortBookmarkPagesBy, sortBookmarksBy } = listSort;

const SORTS = ["newest", "oldest", "title", "titleDesc"];
const CANONICAL_ISO = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;
const ODD_DATES = [
  "2026-10-10T00:00:00Z",
  "2026-10-10T00:00:00.1Z",
  "2026-10-10T00:00:00.123456Z",
  "2026-10-10 00:00:00",
  "2026-10-10T00:00:00+02:00",
  "2026-10-10T00:00:00.000+02:00",
  "2026-10-10",
  "",
  "not-a-date",
  "2026-10-10T00:00:00.000z",
  "2026-1-1T00:00:00.000Z",
];

function rng(seed) {
  let state = seed >>> 0;
  return () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state / 4294967296;
  };
}

function pick(rand, values) {
  return values[Math.floor(rand() * values.length)];
}

function canonicalDate(rand, fixed) {
  if (fixed !== undefined) return fixed;
  const date = new Date(
    Date.UTC(
      1970 + Math.floor(rand() * 80),
      Math.floor(rand() * 12),
      1 + Math.floor(rand() * 28),
      Math.floor(rand() * 24),
      Math.floor(rand() * 60),
      Math.floor(rand() * 60),
      Math.floor(rand() * 1000),
    ),
  );
  return date.toISOString();
}

function bookmark(id, createdAt, title) {
  return { id, createdAt, title };
}

// Exact copies of the HEAD implementations used as the parity reference.
function itemId(item) {
  if (item == null || typeof item !== "object" || !("id" in item)) return undefined;
  const id = item.id;
  return typeof id === "string" ? id : undefined;
}

function legacyFlattenPages(pages) {
  const seen = new Set();
  const items = [];
  for (const page of pages) {
    for (const item of page.items) {
      const id = itemId(item);
      if (id != null) {
        if (seen.has(id)) continue;
        seen.add(id);
      }
      items.push(item);
    }
  }
  return items;
}

const legacyTitleCollator = new Intl.Collator(undefined, { sensitivity: "base" });

function legacySortBookmarksBy(bookmarks, sort) {
  return [...bookmarks].sort((a, b) => {
    if (sort === "title" || sort === "titleDesc") {
      const cmp = legacyTitleCollator.compare(a.title, b.title) || a.id.localeCompare(b.id);
      return sort === "title" ? cmp : -cmp;
    }
    const cmp = a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id);
    return sort === "oldest" ? cmp : -cmp;
  });
}

function randomPages(rand, opts = {}) {
  const pageCount = 1 + Math.floor(rand() * 5);
  const pages = [];
  const reusedIds = [];
  for (let p = 0; p < pageCount; p += 1) {
    const count = Math.floor(rand() * 13);
    const items = [];
    for (let i = 0; i < count; i += 1) {
      if (opts.bookmarks) {
        const id = `b${Math.floor(rand() * 40)}`;
        reusedIds.push(id);
        items.push(
          bookmark(
            id,
            opts.odd ? pick(rand, ODD_DATES) : canonicalDate(rand, opts.fixedDate),
            pick(rand, ["Zebra", "apple", "Apple", "Éclair", "eclair", "", "10 things", "2 things"]),
          ),
        );
        continue;
      }
      const kind = rand();
      if (kind < 0.16) {
        items.push(null);
      } else if (kind < 0.28) {
        items.push("scalar");
      } else if (kind < 0.4) {
        items.push({ id: Math.floor(rand() * 10) });
      } else if (kind < 0.5) {
        items.push({});
      } else if (kind < 0.58 && reusedIds.length) {
        items.push({ id: pick(rand, reusedIds) });
      } else {
        const id = `id-${Math.floor(rand() * 30)}`;
        reusedIds.push(id);
        items.push({ id });
      }
    }
    pages.push({ items });
  }
  // A retried null-cursor page concatenates the same rows a second time.
  if (rand() < 0.35) pages.push({ items: pages[0].items });
  return pages;
}

function randomBookmarks(rand, odd) {
  return Array.from({ length: Math.floor(rand() * 31) }, (_, index) =>
    bookmark(
      `b${Math.floor(rand() * 18)}`,
      odd ? pick(rand, ODD_DATES) : canonicalDate(rand),
      pick(rand, ["Zebra", "apple", "Apple", "Éclair", "eclair", "", "  spaced", "ßeta", "10 things", "2 things"]),
    ),
  );
}

function ids(rows) {
  return rows.map((row) => row.id);
}

function patchCounting(prototype, key, onCall) {
  const original = prototype[key];
  prototype[key] = function patched(...args) {
    return onCall(this, original, args);
  };
  return () => {
    prototype[key] = original;
  };
}

test("countUniquePageItems matches flattenPages(...).length and allocates no row array", () => {
  const rand = rng(0x1f00d);
  let totalRows = 0;
  for (let iteration = 0; iteration < 2000; iteration += 1) {
    const pages = randomPages(rand);
    const flat = flattenPages(pages);
    totalRows += flat.length;
    assert.equal(countUniquePageItems(pages), flat.length, `count parity at iteration ${iteration}`);
    assert.equal(countUniquePageItems(pages), legacyFlattenPages(pages).length);
  }

  assert.equal(countUniquePageItems([]), 0, "no pages");
  const b1 = bookmark("b1", "2026-10-10T00:00:00.000Z", "one");
  const b2 = bookmark("b2", "2026-10-10T00:00:00.000Z", "two");
  const b3 = bookmark("b3", "2026-10-10T00:00:00.000Z", "three");
  const retried = [
    { items: [b1, b2] },
    { items: [b2, b3] },
    { items: [] },
    { items: [b1, b2] },
  ];
  assert.equal(countUniquePageItems(retried), 3, "retried first page dedupes");
  assert.equal(flattenPages(retried).length, 3);
  const idless = [{ items: [{}, null, { id: 7 }, { id: "x" }, { id: "x" }] }];
  assert.equal(countUniquePageItems(idless), 4, "non-string and missing ids stay as fallback rows");
  assert.equal(flattenPages(idless).length, 4);

  const pages = randomPages(rng(99));
  let pushes = 0;
  const restore = patchCounting(Array.prototype, "push", (self, original, args) => {
    pushes += args.length;
    return original.apply(self, args);
  });
  let count;
  let flatPushes;
  try {
    count = countUniquePageItems(pages);
    flatPushes = pushes;
    flattenPages(pages);
  } finally {
    restore();
  }
  assert.equal(flatPushes, 0, "unique counting must not push rows into a flat array");
  assert.equal(pushes - flatPushes, flattenPages(pages).length, "flattenPages still pushes one row per result");
  assert.equal(count, flattenPages(pages).length);
  assert.ok(totalRows > 0);
});

test("randomized sort parity: sortBookmarksBy and fused pages match legacy order", () => {
  const rand = rng(0x5eed);
  for (let iteration = 0; iteration < 700; iteration += 1) {
    const odd = iteration % 3 === 0;
    const rows = randomBookmarks(rand, odd);
    const rowsBefore = rows.slice();
    for (const sort of SORTS) {
      const expected = ids(legacySortBookmarksBy(rows, sort));
      assert.deepEqual(ids(sortBookmarksBy(rows, sort)), expected, `${sort} direct parity`);
    }
    assert.deepEqual(rows, rowsBefore, "sortBookmarksBy must not mutate the caller's array");

    const pages = randomPages(rand, { bookmarks: true, odd });
    const beforePages = pages.map((page) => page.items.slice());
    for (const sort of SORTS) {
      const expectedPages = ids(legacySortBookmarksBy(legacyFlattenPages(pages), sort));
      const actual = sortBookmarkPagesBy(pages, sort);
      assert.deepEqual(ids(actual), expectedPages, `fused ${sort} page parity`);
      for (const page of pages) assert.notStrictEqual(actual, page.items);
    }
    assert.deepEqual(
      pages.map((page) => page.items),
      beforePages,
      "fused sort must not mutate page rows or their order",
    );
  }
});

test("canonical timestamps skip localeCompare, odd dates keep the legacy fallback", () => {
  const canonical = [
    bookmark("b2", "2026-10-10T00:00:00.000Z", "same"),
    bookmark("b10", "2026-10-10T00:00:00.000Z", "same"),
    bookmark("b1", "2026-10-10T00:00:00.000Z", "same"),
    bookmark("b3", "2026-10-09T23:59:59.999Z", "same"),
    bookmark("b4", "2026-10-10T00:00:00.001Z", "same"),
  ];
  for (const sort of SORTS) {
    assert.deepEqual(
      ids(sortBookmarksBy(canonical, sort)),
      ids(legacySortBookmarksBy(canonical, sort)),
      `canonical ${sort} order incl. id ties`,
    );
  }

  const mixed = [
    ...canonical.slice(0, 3),
    bookmark("b5", "2026-10-10T00:00:00+02:00", "same"),
    bookmark("b6", "2026-10-10 00:00:00", "same"),
    bookmark("b7", "2026-10-10T00:00:00Z", "same"),
    bookmark("b8", "", "same"),
  ];
  for (const sort of SORTS) {
    assert.deepEqual(
      ids(sortBookmarksBy(mixed, sort)),
      ids(legacySortBookmarksBy(mixed, sort)),
      `mixed/legacy ${sort} order`,
    );
  }

  const random = rng(0xc0ffee);
  for (let iteration = 0; iteration < 500; iteration += 1) {
    const odd = iteration % 2 === 0;
    const rows = randomBookmarks(random, odd);
    for (const sort of SORTS) {
      assert.deepEqual(ids(sortBookmarksBy(rows, sort)), ids(legacySortBookmarksBy(rows, sort)));
    }
  }

  const counts = countLocaleCompares(() => sortBookmarksBy(canonical, "newest"));
  const legacyCounts = countLocaleCompares(() => legacySortBookmarksBy(canonical, "newest"));
  assert.equal(counts.dates, 0, "canonical dates never reach localeCompare");
  assert.ok(legacyCounts.dates > 0, "legacy reference does use localeCompare for dates");
  assert.ok(counts.all <= legacyCounts.all);
  console.log(
    `canonical date localeCompare calls: legacy ${legacyCounts.dates} -> fused ${counts.dates}`,
  );
});

function countLocaleCompares(fn) {
  const counts = { all: 0, dates: 0 };
  const restore = patchCounting(String.prototype, "localeCompare", (self, original, args) => {
    counts.all += 1;
    if (CANONICAL_ISO.test(self) && typeof args[0] === "string" && CANONICAL_ISO.test(args[0])) {
      counts.dates += 1;
    }
    return original.apply(self, args);
  });
  try {
    fn();
  } finally {
    restore();
  }
  return counts;
}

test("fused page sort copies rows once; legacy composition copies twice", () => {
  const rand = rng(0xabc);
  const pages = [{ items: Array.from({ length: 160 }, (_, index) =>
    bookmark(`b${index}`, canonicalDate(rand), `Title ${index % 17}`)) }];
  let reads = 0;
  const original = Array.prototype[Symbol.iterator];
  Array.prototype[Symbol.iterator] = function countedIterator() {
    reads += this.length;
    return original.call(this);
  };
  let legacyReads;
  let fusedReads;
  try {
    legacyReads = reads;
    legacySortBookmarksBy(legacyFlattenPages(pages), "newest");
    legacyReads = reads - legacyReads;

    fusedReads = reads;
    sortBookmarkPagesBy(pages, "newest");
    fusedReads = reads - fusedReads;
  } finally {
    Array.prototype[Symbol.iterator] = original;
  }
  assert.equal(legacyReads - fusedReads, 160, "fused path skips the second row copy");
});

test("useListControls counts rows instead of flattening pages", () => {
  assert.equal(
    (controlsSource.match(/countUniquePageItems\(/g) ?? []).length,
    2,
    "before and after both count unique rows",
  );
  assert.doesNotMatch(controlsSource, /flattenPages/);
  assert.match(homeSource, /sortBookmarkPagesBy\(/);
  assert.doesNotMatch(homeSource, /sortBookmarksBy\(flattenPages/);
  assert.match(folderSource, /sortBookmarkPagesBy\(/);
  assert.doesNotMatch(folderSource, /sortBookmarksBy\(flattenPages/);
});

test("benchmark: count and sort work before/after", () => {
  const rand = rng(0xbeef);
  const rows = Array.from({ length: 1200 }, (_, index) =>
    bookmark(`b${index}`, canonicalDate(rand), `Title ${index % 53}`));
  const pages = [
    { items: rows.slice(0, 240) },
    { items: rows.slice(240, 480) },
    { items: rows.slice(480, 720) },
    { items: rows.slice(720, 960) },
    { items: rows.slice(960, 1200) },
  ];

  let sink = 0;
  const median = (values) => [...values].sort((a, b) => a - b)[Math.floor(values.length / 2)];
  const bench = (fn, iterations) => {
    for (let warmup = 0; warmup < 5; warmup += 1) sink += fn();
    const samples = [];
    for (let sample = 0; sample < 5; sample += 1) {
      const started = process.hrtime.bigint();
      for (let index = 0; index < iterations; index += 1) sink += fn();
      samples.push(Number(process.hrtime.bigint() - started) / 1e6 / iterations);
    }
    return median(samples);
  };

  const legacyCount = bench(() => legacyFlattenPages(pages).length, 200);
  const newCount = bench(() => countUniquePageItems(pages), 200);
  const legacyNewest = bench(() => legacySortBookmarksBy(legacyFlattenPages(pages), "newest").length, 40);
  const newNewest = bench(() => sortBookmarkPagesBy(pages, "newest").length, 40);
  const legacyTitle = bench(() => legacySortBookmarksBy(legacyFlattenPages(pages), "title").length, 40);
  const newTitle = bench(() => sortBookmarkPagesBy(pages, "title").length, 40);

  console.log(
    [
      "list-work benchmark (1200 rows, median ms/op)",
      `count unique: legacy flatten ${legacyCount.toFixed(3)} -> count ${newCount.toFixed(3)} (${(legacyCount / newCount).toFixed(2)}x)`,
      `newest sort:  legacy ${legacyNewest.toFixed(3)} -> fused ${newNewest.toFixed(3)} (${(legacyNewest / newNewest).toFixed(2)}x)`,
      `title sort:   legacy ${legacyTitle.toFixed(3)} -> fused ${newTitle.toFixed(3)} (${(legacyTitle / newTitle).toFixed(2)}x)`,
    ].join("\n"),
  );
  assert.ok(newCount > 0 && newNewest > 0 && newTitle > 0);
  assert.ok(sink > 0);
});
