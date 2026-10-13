import assert from "node:assert/strict";
import { test } from "node:test";
import {
  bookmarkSearchRank,
  createBookmarkSearchMatcher,
  prepareBookmarkSearch,
  firstSearchHighlight,
  rankSearchResults,
  tokenizeSearchQuery,
  tokensAllowArticleText,
  withinOneEdit,
  type SearchableBookmark,
} from "./search.ts";

function bookmark(
  partial: Partial<SearchableBookmark> & Pick<SearchableBookmark, "title">,
): SearchableBookmark {
  return {
    id: partial.id ?? partial.title,
    url: partial.url ?? `https://example.com/${partial.id ?? "x"}`,
    domain: partial.domain ?? "example.com",
    description: partial.description ?? null,
    author: partial.author ?? null,
    tags: partial.tags ?? [],
    createdAt: partial.createdAt ?? "2026-01-01T00:00:00.000Z",
    contentText: partial.contentText ?? null,
    ...partial,
  };
}

test("tokenizeSearchQuery collapses space and lowercases", () => {
  assert.deepEqual(tokenizeSearchQuery("  SSL   Guide "), ["ssl", "guide"]);
});

test("Latin accents fold on both sides, including decomposed and uppercase queries", () => {
  assert.deepEqual(tokenizeSearchQuery("  CAFÉ   re\u0301sume\u0301 "), ["cafe", "resume"]);
  for (const title of ["Café résumé", "Cafe\u0301 re\u0301sume\u0301", "Cafe resume"]) {
    const item = bookmark({ title });
    prepareBookmarkSearch(item);
    for (const query of ["cafe resume", "CAFÉ RÉSUMÉ", "cafe\u0301 re\u0301sume\u0301"]) {
      assert.equal(createBookmarkSearchMatcher(query)(item).clause, "and");
      assert.equal(bookmarkSearchRank(item, query).matched, true);
    }
  }
});

test("accent-insensitive matching covers every field without enabling fuzzy search", () => {
  const fields: Array<[Partial<SearchableBookmark>, string]> = [
    [{ title: "Café guide" }, "title"],
    [{ domain: "café.example" }, "domain"],
    [{ url: "https://example.com/café" }, "url"],
    [{ tags: [{ id: "coffee", name: "Café" }] }, "tag"],
    [{ description: "Résumé writing" }, "description"],
    [{ author: "Renée" }, "description"],
    [{ contentText: "Résumé writing" }, "body"],
  ];
  for (const [fieldsForItem, field] of fields) {
    const query = field === "description" || field === "body"
      ? (fieldsForItem.author ? "renee" : "resume") : "cafe";
    const rank = bookmarkSearchRank(bookmark({ title: "Notes", ...fieldsForItem }), query);
    assert.equal(rank.matched, true, field);
    assert.equal(rank.field, field);
    assert.equal(rank.usedFuzzy, false);
  }
  assert.equal(bookmarkSearchRank(bookmark({ title: "Decafé" }), "cafe").matched, false);
  assert.equal(bookmarkSearchRank(bookmark({ title: "Café" }), "caef").matched, false);
  assert.equal(bookmarkSearchRank(bookmark({ title: "Café" }), "caef", { fuzzy: true }).matched, true);
  assert.equal(bookmarkSearchRank(bookmark({ title: "Notes", tags: [{ id: "coffee", name: "Café" }] }),
    "cafe", { omitTagIds: ["coffee"] }).matched, false);
});

test("folding preserves meaningful marks in non-Latin scripts", () => {
  for (const [title, other] of [["かな", "がな"], ["किताब", "कताब"], ["άλφα", "αλφα"]]) {
    for (const prefix of ["", "Notes: "]) {
      const item = bookmark({ title: `${prefix}${title}` });
      assert.equal(bookmarkSearchRank(item, title!).matched, true);
      assert.equal(bookmarkSearchRank(item, other!).matched, false);
    }
  }
});

test("accent-insensitive highlight spans refer to the original UTF-16 text", () => {
  for (const [text, query, selected] of [
    ["Café guide", "cafe", "Café"],
    ["☕ Cafe\u0301 guide", "CAFÉ", "Cafe\u0301"],
    ["🙂 Re\u0301sume\u0301 notes", "resume", "Re\u0301sume\u0301"],
    ["Cafe\u0301 next", "cafe next", "Cafe\u0301"],
    ["İstanbul guide", "istan", "İstan"],
    ["The İSTANBUL guide", "istan", "İSTAN"],
  ]) {
    const span = firstSearchHighlight(text!, query!);
    assert.ok(span, `${query} in ${text}`);
    assert.equal(text!.slice(span.start, span.end), selected);
  }
  const text = "The Cafe\u0301 guide";
  const fuzzy = firstSearchHighlight(text, "caef", true);
  assert.ok(fuzzy);
  assert.equal(text.slice(fuzzy.start, fuzzy.end), "Cafe\u0301");
});

test("metadata warming and short queries never read article bodies", () => {
  let reads = 0;
  const source = { ...bookmark({ title: "Material reading" }), get contentText() { reads++; return "secondary body content"; } };
  prepareBookmarkSearch(source);
  assert.equal(createBookmarkSearchMatcher("mat")(source).matched, true);
  assert.equal(createBookmarkSearchMatcher("absent", { allowSecondary: false })(source).matched, false);
  assert.equal(reads, 0);
});

test("secondary body indexing is lazy, cached, and follows immutable replacements", () => {
  let reads = 0;
  const source = { ...bookmark({ title: "Notes" }), get contentText() { reads++; return "secondary body content"; } };
  assert.equal(bookmarkSearchRank(source, "secondary").field, "body");
  assert.equal(bookmarkSearchRank(source, "content").matched, true);
  assert.equal(reads, 1);
  const updated = { ...source, contentText: "different article text" };
  assert.equal(bookmarkSearchRank(updated, "secondary").matched, false);
  assert.equal(bookmarkSearchRank(updated, "different").field, "body");
});

test("a primary or description hit need not tokenize a long body", () => {
  const source = { ...bookmark({ title: "Material", description: "description" }),
    get contentText(): string { throw new Error("Body should remain cold"); } };
  assert.equal(bookmarkSearchRank(source, "material").field, "title");
  assert.equal(bookmarkSearchRank(source, "description").field, "description");
});

test("pre-indexed queries retain ranking and follow immutable record/tag replacements", () => {
  const initial = bookmark({ title: "Reading notes", tags: [{ id: "design", name: "Design" }] });
  prepareBookmarkSearch(initial);
  const match = createBookmarkSearchMatcher("design");
  assert.deepEqual(match(initial), bookmarkSearchRank(initial, "design"));
  assert.equal(match(initial).field, "tag");
  const changed = { ...initial, title: "Design notes", tags: [] };
  assert.equal(match(changed).field, "title");
  assert.equal(createBookmarkSearchMatcher("reading")(changed).matched, false);
  assert.equal(createBookmarkSearchMatcher("design", { omitTagIds: ["design"] })(initial).matched, false);
});

test("hel prefixes hello/help/helpful and not shelf or Home", () => {
  const hello = bookmark({ id: "hello", title: "Hello world" });
  const help = bookmark({
    id: "help",
    title: "CraftingStore SSL Guide",
    domain: "help.craftingstore.net",
    url: "https://help.craftingstore.net/ssl",
  });
  const helpful = bookmark({ id: "helpful", title: "Helpful Guide" });
  const shelf = bookmark({ id: "shelf", title: "Bookshelf notes" });
  const home = bookmark({
    id: "home",
    title: "Home",
    domain: "ente.com",
    url: "https://ente.com",
    description: "Introduction to Ente: Products, Community and Support",
    contentText: "Need help with vaults and hello from the team.",
  });
  const ranked = rankSearchResults([home, shelf, help, hello, helpful], "hel");
  assert.deepEqual(new Set(ranked.map((item) => item.id)), new Set(["helpful", "hello", "help"]));
  assert.equal(ranked[ranked.length - 1]?.id, "help");
});

test("title starts-with outranks a later title word, which outranks domain", () => {
  const starts = bookmark({ id: "s", title: "Helpful Guide", createdAt: "2026-01-01T00:00:00.000Z" });
  const word = bookmark({ id: "w", title: "The Help docs", createdAt: "2026-03-01T00:00:00.000Z" });
  const domain = bookmark({
    id: "d",
    title: "SSL Guide",
    domain: "help.craftingstore.net",
    createdAt: "2026-04-01T00:00:00.000Z",
  });
  const ranked = rankSearchResults([domain, word, starts], "hel");
  assert.deepEqual(
    ranked.map((item) => item.id),
    ["s", "w", "d"],
  );
});

test("description and body wait for five letters and sort below primary hits", () => {
  const primary = bookmark({
    id: "title",
    title: "Vault backup",
    createdAt: "2026-01-01T00:00:00.000Z",
  });
  const body = bookmark({
    id: "home",
    title: "Home",
    domain: "ente.com",
    description: "Welcome to the vaults",
    contentText: "Welcome to the vaults",
    createdAt: "2026-06-01T00:00:00.000Z",
  });
  assert.equal(tokensAllowArticleText(["vaul"]), false);
  assert.deepEqual(
    rankSearchResults([primary, body], "vaul").map((item) => item.id),
    ["title"],
  );
  assert.deepEqual(
    rankSearchResults([body, primary], "vault").map((item) => item.id),
    ["title", "home"],
  );
});

test("multi-word AND hits sit above OR hits", () => {
  const both = bookmark({ id: "both", title: "CraftingStore SSL Guide" });
  const sslOnly = bookmark({ id: "ssl", title: "SSL certificates" });
  const guideOnly = bookmark({ id: "guide", title: "Style guide" });
  const ranked = rankSearchResults([guideOnly, sslOnly, both], "ssl guide");
  assert.deepEqual(
    ranked.map((item) => item.id),
    ["both", "ssl", "guide"],
  );
  assert.equal(bookmarkSearchRank(both, "ssl guide").clause, "and");
  assert.equal(bookmarkSearchRank(sslOnly, "ssl guide").clause, "or");
});

test("react.dev matches the domain even with a dotted token", () => {
  const docs = bookmark({
    id: "d",
    title: "Learn",
    domain: "react.dev",
    url: "https://react.dev/learn",
  });
  const other = bookmark({ id: "o", title: "Notes", domain: "example.com" });
  assert.deepEqual(
    rankSearchResults([other, docs], "react.dev").map((item) => item.id),
    ["d"],
  );
});

test("fuzzy is off by default and opt-in for one-edit typos", () => {
  const hello = bookmark({ id: "hello", title: "Hello world" });
  assert.deepEqual(
    rankSearchResults([hello], "helo").map((item) => item.id),
    [],
  );
  assert.deepEqual(
    rankSearchResults([hello], "helo", { fuzzy: true }).map((item) => item.id),
    ["hello"],
  );
  assert.equal(withinOneEdit("hello", "helo"), true);
  assert.equal(withinOneEdit("help", "hlep"), true);
  assert.equal(withinOneEdit("home", "hel"), false);
});

test("an omitted tag name cannot satisfy the query", () => {
  const shopping = { id: "shop", name: "Shopping List" };
  const hoodie = bookmark({
    id: "hoodie",
    title: "Shadowflex Hoodie",
    domain: "viralpickz.onshopbase.com",
    url: "https://viralpickz.onshopbase.com/hoodie",
    tags: [shopping],
  });
  const ranked = rankSearchResults([hoodie], "shop", { omitTagIds: ["shop"] });
  assert.deepEqual(
    ranked.map((item) => item.id),
    [],
  );
});

test("firstSearchHighlight marks the word prefix, not a mid-word run", () => {
  assert.deepEqual(firstSearchHighlight("Helpful Guide", "hel"), { start: 0, end: 3 });
  assert.deepEqual(firstSearchHighlight("The Help docs", "hel"), { start: 4, end: 7 });
  assert.equal(firstSearchHighlight("Bookshelf", "hel"), null);
});
