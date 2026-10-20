/** Run: node --test apps/server/scripts/cooperative-rank.test.cjs
 * Parity suite for the server-only cooperative ranking helper
 * (src/bookmarks/cooperative-rank.ts) against the shared synchronous
 * rankSearchResults from @ordo/shared, plus chunking/yield behavior:
 *   - identical output objects, order, filtering, and pagination inputs for
 *     empty/short/long/fuzzy/omitted-tag/secondary-field queries
 *   - identical date/id tie-break semantics (including missing id)
 *   - per-row prepare invoked exactly once per row, in order
 *   - bounded synchronous chunks actually yield to the event loop
 *   - mapCooperative preserves order and propagates errors
 */
const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const { resolve } = require("node:path");
const { performance } = require("node:perf_hooks");
const { AsyncLocalStorage } = require("node:async_hooks");
const { test } = require("node:test");
const ts = require("../../../node_modules/typescript");
const shared = require("@ordo/shared");

function load(path) {
  const { outputText } = ts.transpileModule(readFileSync(resolve(__dirname, "../src", path), "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  });
  const module = { exports: {} };
  const requireModule = (name) => require(name);
  new Function("require", "module", "exports", outputText)(requireModule, module, module.exports);
  return module.exports;
}

const { mapCooperative, rankSearchResultsCooperative } = load("bookmarks/cooperative-rank.ts");
const { rankSearchResults } = shared;

// ---------- deterministic corpus ----------
function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const WORDS = [
  "kubernetes", "cluster", "notes", "recipe", "kitchen", "paper", "study",
  "garden", "engine", "café", "naïve", "resume", "alpha", "omega", "delta",
  "quick", "brown", "fox", "jumps", "lazy", "dog", "go", "run", "set",
];
const DOMAINS = ["example.com", "docs.io", "café.net", "plain.org", "dev.dev"];

function makeCorpus(size, seed) {
  const rand = mulberry32(seed);
  const pick = (arr) => arr[Math.floor(rand() * arr.length)];
  const word = () => pick(WORDS);
  const items = [];
  for (let i = 0; i < size; i++) {
    const title = `${word()} ${word()} ${i % 7}`;
    const id = rand() < 0.03 ? undefined : `id-${(i * 2654435761) % 9973}-${i}`;
    const nTags = Math.floor(rand() * 3);
    const tags = [];
    for (let t = 0; t < nTags; t++) tags.push({ id: `tag-${t}`, name: `${word()}` });
    const withBody = rand() < 0.5;
    items.push({
      id,
      title,
      url: `https://${pick(DOMAINS)}/${word()}/${i}`,
      domain: pick(DOMAINS),
      description: rand() < 0.6 ? `${word()} ${word()} description ${i}` : null,
      author: rand() < 0.4 ? `${word()} author` : null,
      tags,
      createdAt: new Date(Date.UTC(2024, (i * 7) % 12, (i % 28) + 1)).toISOString(),
      contentText: withBody
        ? `${word()} ${word()} body text ${word()} ${word()} ${word()} ${word()}`
        : null,
    });
  }
  // deliberate date collisions for tie-break coverage
  for (const item of items.slice(0, 40)) item.createdAt = items[0].createdAt;
  return items;
}

const corpus = makeCorpus(420, 1234);
const identity = (row) => row;

// ---------- parity ----------
const QUERY_CASES = [
  "",
  "   ",
  "\t",
  "a",
  "go",
  "run set",
  "kubernetes",
  "kubernetes cluster",
  "kubernetes clustr",
  "kubernetzs",
  "café",
  "cafe",
  "naïve",
  "alpha omega delta",
  "quick brown fox",
  "description",
  "author",
  "tag-",
  "!!!",
  "a-b",
  "body",
  "text body garden",   // multi-token, body-only AND hits
  "xyzzyplugh",
  "example.com",
  "dev.dev notes",
];

async function assertParity(rows, query, opts, label) {
  const expected = rankSearchResults(rows, query, opts);
  const actual = await rankSearchResultsCooperative(rows, query, opts, identity);
  assert.ok(
    Array.isArray(expected) === Array.isArray(actual),
    `${label}: array-ness`,
  );
  assert.strictEqual(actual.length, expected.length, `${label}: length`);
  for (let i = 0; i < expected.length; i++) {
    assert.strictEqual(actual[i], expected[i], `${label}: item ${i} identity/order`);
  }
}

test("parity: randomized corpus across query shapes, fuzzy, and omitted tags", async () => {
  const omit = ["tag-0", "tag-1"];
  const omitSet = new Set(omit);
  const variants = [
    { label: "plain", opts: {} },
    { label: "fuzzy", opts: { fuzzy: true } },
    { label: "omit-array", opts: { omitTagIds: omit } },
    { label: "omit-set", opts: { omitTagIds: omitSet } },
    { label: "omit+fuzzy", opts: { omitTagIds: omit, fuzzy: true } },
    { label: "secondary-on", opts: { allowSecondary: true } },
    { label: "secondary-off", opts: { allowSecondary: false } },
  ];
  for (const query of QUERY_CASES) {
    for (const v of variants) {
      await assertParity(corpus, query, v.opts, `q="${query}" ${v.label}`);
    }
  }
});

test("parity: shuffled input order (stability + tie-breaks under both orders)", async () => {
  const rand = mulberry32(99);
  const shuffled = [...corpus];
  for (let i = shuffled.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
  }
  for (const query of ["", "kubernetes cluster", "cafe", "go", "kubernetzs"]) {
    for (const opts of [{}, { fuzzy: true }]) {
      await assertParity(shuffled, query, opts, `shuffled q="${query}"`);
    }
  }
});

test("parity: targeted secondary-field and fuzzy gating cases", async () => {
  const rows = [
    {
      id: "body-only", title: "Alpha Notes", url: "https://a.com/x", domain: "a.com",
      description: null, author: null, tags: [], createdAt: "2024-05-01T00:00:00Z",
      contentText: "kubernetes cluster fundamentals explained",
    },
    {
      id: "tag-hit", title: "Unrelated", url: "https://b.com/y", domain: "b.com",
      description: null, author: null, tags: [{ id: "t9", name: "kubernetes" }],
      createdAt: "2024-05-02T00:00:00Z", contentText: null,
    },
    {
      id: "fuzzy-near", title: "kubernetes basics", url: "https://c.com/z", domain: "c.com",
      description: null, author: null, tags: [], createdAt: "2024-05-03T00:00:00Z",
      contentText: null,
    },
  ];
  await assertParity(rows, "kubernetes", {}, "body-enabled single token");
  await assertParity(rows, "kubernetzs", { fuzzy: true }, "fuzzy on");
  await assertParity(rows, "kubernetzs", { fuzzy: false }, "fuzzy off");
  await assertParity(rows, "go", {}, "short token secondary gate");
  await assertParity(rows, "kubernetes", { omitTagIds: ["t9"] }, "omitted tag drops tag-only hit");
  await assertParity(rows, "", {}, "empty query keeps all rows");
});

test("tie-break: date desc then id asc, title fallback when id missing", async () => {
  const mk = (id, createdAt, title) => ({
    id, title, url: "https://t.io/a", domain: "t.io", description: null,
    author: null, tags: [], createdAt, contentText: null,
  });
  const rows = [
    mk("b", "2024-01-01T00:00:00Z", "same"),
    mk("a", "2024-01-01T00:00:00Z", "same"),
    mk("c", "2025-01-01T00:00:00Z", "same"),
    { ...mk(undefined, "2024-01-01T00:00:00Z", "aaa"), id: undefined },
    { ...mk(undefined, "2024-01-01T00:00:00Z", "zzz"), id: undefined },
  ];
  await assertParity(rows, "", {}, "empty-query sort order");
  await assertParity(rows, "same", {}, "equal-rank tie-break order");
});

test("empty input and prepare-pass-through", async () => {
  await assertParity([], "kubernetes", {}, "empty rows");
  const seen = [];
  const rows = corpus.slice(0, 25);
  await rankSearchResultsCooperative(rows, "notes", {}, (row) => {
    seen.push(row);
    return row;
  });
  assert.strictEqual(seen.length, rows.length, "prepare called once per row");
  assert.deepEqual(
    seen.map((r) => r.id ?? r.title),
    rows.map((r) => r.id ?? r.title),
    "prepare called in row order",
  );
});

// ---------- chunking / scheduling ----------
function busyWait(ms) {
  const end = performance.now() + ms;
  while (performance.now() < end) {
    /* spin */
  }
}

test("cooperative ranking yields to the event loop between chunks", async () => {
  const rows = makeCorpus(60, 7).map((row, i) => ({
    ...row,
    title: i % 2 === 0 ? "needle target" : row.title,
  }));
  let pings = 0;
  let counting = true;
  const ping = () => {
    if (!counting) return;
    pings += 1;
    setImmediate(ping);
  };
  setImmediate(ping);
  let out;
  try {
    out = await rankSearchResultsCooperative(
      rows,
      "needle",
      {},
      (row) => {
        busyWait(2); // ~120ms total ≫ one 6ms chunk
        return row;
      },
    );
  } finally {
    counting = false; // A failing helper must not leave a self-rescheduling loop.
  }
  assert.deepEqual(out, rankSearchResults(rows, "needle", {}), "same membership and exact order across chunk boundaries");
  assert.ok(pings >= 5, `expected several event-loop yields, saw ${pings}`);
});

test("cooperative ranking makes progress even when single rows exceed the budget", async () => {
  const rows = makeCorpus(6, 11);
  const out = await rankSearchResultsCooperative(
    rows,
    "",
    {},
    (row) => {
      busyWait(15); // one row > CHUNK_BUDGET_MS
      return row;
    },
  );
  assert.strictEqual(out.length, rows.length, "all rows processed");
});

test("mapCooperative preserves order and rejects on error", async () => {
  const rows = [1, 2, 3, 4, 5];
  const out = await mapCooperative(rows, (n, i) => n * 10 + i);
  assert.deepEqual(out, [10, 21, 32, 43, 54]);
  const boom = new Error("row 3");
  await assert.rejects(
    mapCooperative(rows, (n) => {
      if (n === 3) throw boom;
      return n;
    }),
    (err) => err === boom,
  );
});

test("concurrent chunks preserve separate request-local contexts", async () => {
  const storage = new AsyncLocalStorage();
  const rows = Array.from({ length: 60 }, (_, index) => index);
  let yielded = false;
  setImmediate(() => { yielded = true; });
  const owners = ["request-one", "request-two"];
  const out = await Promise.all(owners.map(owner => storage.run(owner, () => mapCooperative(rows, row => {
    busyWait(0.3);
    assert.equal(storage.getStore(), owner, "yielding must retain each request's crypto context");
    return `${owner}:${row}`;
  }))));
  assert.equal(yielded, true);
  for (let index = 0; index < owners.length; index++) {
    assert.deepEqual(out[index], rows.map(row => `${owners[index]}:${row}`));
  }
});
