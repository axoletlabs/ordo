import assert from "node:assert/strict";
import { test } from "node:test";
import {
  bookmarkSearchRank,
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
