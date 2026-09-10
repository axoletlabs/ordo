import assert from "node:assert/strict";
import { test } from "node:test";
import type { BookmarkDto } from "@ordo/shared";
import {
  compileSearchResults,
  firstSearchHighlight,
  reuseSearchResults,
  sanitizeRouteParam,
  searchFiltersActive,
  type SearchFilters,
} from "./search-bookmarks.ts";

function bookmark(partial: Partial<BookmarkDto> & Pick<BookmarkDto, "id" | "title">): BookmarkDto {
  return {
    folderId: null,
    url: `https://example.com/${partial.id}`,
    description: null,
    domain: "example.com",
    contentText: null,
    contentMarkdown: null,
    fetchStatus: "ok",
    extractionReason: null,
    contentKind: "article",
    contentKindOverride: null,
    extractionVersion: 1,
    author: null,
    publishedAt: null,
    readingTimeMinutes: 3,
    readProgress: 0,
    completedAt: null,
    isRead: false,
    tags: [],
    suggestedTags: [],
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    ...partial,
  };
}

const none: SearchFilters = { tagIds: [], status: "all", kind: "all" };

test("sanitizeRouteParam treats Expo's stringified undefined as empty", () => {
  assert.equal(sanitizeRouteParam("undefined"), "");
  assert.equal(sanitizeRouteParam("null"), "");
  assert.equal(sanitizeRouteParam(undefined), "");
  assert.equal(sanitizeRouteParam(["undefined"]), "");
  assert.equal(sanitizeRouteParam("react"), "react");
  assert.equal(sanitizeRouteParam(["hooks"]), "hooks");
});

test("title matches outrank URL matches as the query changes", () => {
  const titleHit = bookmark({ id: "t", title: "React Query", createdAt: "2026-01-01T00:00:00.000Z" });
  const urlHit = bookmark({
    id: "u",
    title: "Notes",
    url: "https://example.com/react",
    createdAt: "2026-02-01T00:00:00.000Z",
  });
  const ranked = compileSearchResults({
    query: "react",
    filters: none,
    serverItems: [urlHit, titleHit],
    cachedItems: [],
    serverMatchesQuery: true,
  });
  assert.deepEqual(
    ranked.map((item) => item.id),
    ["t", "u"],
  );
});

test("domain and tag names are searchable from the cache", () => {
  const byDomain = bookmark({ id: "d", title: "Docs", domain: "react.dev" });
  const byTag = bookmark({
    id: "g",
    title: "Brew",
    tags: [{ id: "tag-1", name: "espresso", color: "amber" }],
  });
  const domainHits = compileSearchResults({
    query: "react.dev",
    filters: none,
    serverItems: [],
    cachedItems: [byDomain, byTag],
    serverMatchesQuery: true,
  });
  const tagHits = compileSearchResults({
    query: "espresso",
    filters: none,
    serverItems: [],
    cachedItems: [byDomain, byTag],
    serverMatchesQuery: true,
  });
  assert.deepEqual(
    domainHits.map((item) => item.id),
    ["d"],
  );
  assert.deepEqual(
    tagHits.map((item) => item.id),
    ["g"],
  );
});

test("multi-word queries require every token", () => {
  const both = bookmark({ id: "both", title: "React Native animation" });
  const one = bookmark({ id: "one", title: "React Query" });
  const ranked = compileSearchResults({
    query: "react native",
    filters: none,
    serverItems: [],
    cachedItems: [both, one],
    serverMatchesQuery: true,
  });
  assert.deepEqual(
    ranked.map((item) => item.id),
    ["both"],
  );
});

test("stale server rows drop while a longer query is in flight", () => {
  const keep = bookmark({ id: "keep", title: "React Native" });
  const drop = bookmark({ id: "drop", title: "React Query" });
  const ranked = compileSearchResults({
    query: "react native",
    filters: none,
    serverItems: [keep, drop],
    cachedItems: [],
    serverMatchesQuery: false,
  });
  assert.deepEqual(
    ranked.map((item) => item.id),
    ["keep"],
  );
});

test("unread and article filters hide non-matching rows", () => {
  const unreadArticle = bookmark({
    id: "a",
    title: "React",
    isRead: false,
    contentKind: "article",
    fetchStatus: "ok",
  });
  const readWeb = bookmark({
    id: "w",
    title: "React",
    isRead: true,
    contentKind: "web",
    fetchStatus: "unsupported",
  });
  const unread = compileSearchResults({
    query: "react",
    filters: { tagIds: [], status: "unread", kind: "all" },
    serverItems: [unreadArticle, readWeb],
    cachedItems: [],
    serverMatchesQuery: true,
  });
  assert.deepEqual(
    unread.map((item) => item.id),
    ["a"],
  );
  const articles = compileSearchResults({
    query: "react",
    filters: { tagIds: [], status: "all", kind: "article" },
    serverItems: [unreadArticle, readWeb],
    cachedItems: [],
    serverMatchesQuery: true,
  });
  assert.deepEqual(
    articles.map((item) => item.id),
    ["a"],
  );
});

test("searchFiltersActive ignores the empty default", () => {
  assert.equal(searchFiltersActive({ tagIds: [], status: "all", kind: "all" }), false);
  assert.equal(searchFiltersActive({ tagIds: ["x"], status: "all", kind: "all" }), true);
  assert.equal(searchFiltersActive({ tagIds: [], status: "unread", kind: "all" }), true);
});

test("matching is a substring, not fuzzy", () => {
  const react = bookmark({ id: "r", title: "React Query" });
  const hits = compileSearchResults({
    query: "ract",
    filters: none,
    serverItems: [],
    cachedItems: [react],
    serverMatchesQuery: true,
  });
  assert.deepEqual(
    hits.map((item) => item.id),
    [],
  );
  const prefix = compileSearchResults({
    query: "reac",
    filters: none,
    serverItems: [],
    cachedItems: [react],
    serverMatchesQuery: true,
  });
  assert.deepEqual(
    prefix.map((item) => item.id),
    ["r"],
  );
});

test("firstSearchHighlight marks the first token in the title", () => {
  assert.deepEqual(firstSearchHighlight("React Query", "reac"), { start: 0, end: 4 });
  assert.equal(firstSearchHighlight("React Query", "query")?.start, 6);
  assert.equal(firstSearchHighlight("React Query", "zzz"), null);
});

test("short queries only match title, URL, domain, and tags", () => {
  const viral = bookmark({
    id: "viral",
    title: "Shadowflex Hoodie",
    domain: "viralpickz.onshopbase.com",
    url: "https://viralpickz.onshopbase.com/hoodie",
    contentKind: "web",
    fetchStatus: "unsupported",
  });
  const visualDesc = bookmark({
    id: "mc",
    title: "Minecraft DAT Editor",
    description: "Visual editor for Minecraft NBT files",
    contentKind: "article",
    fetchStatus: "ok",
  });
  const bodyOnly = bookmark({
    id: "home",
    title: "Home",
    domain: "ente.com",
    url: "https://ente.com",
    description: "Every product overview",
    contentKind: "article",
    fetchStatus: "ok",
  });
  const hits = compileSearchResults({
    query: "v",
    filters: none,
    serverItems: [viral, visualDesc, bodyOnly],
    cachedItems: [viral, visualDesc, bodyOnly],
    serverMatchesQuery: true,
  });
  assert.deepEqual(
    hits.map((item) => item.id),
    ["viral"],
  );
});

test("an active tag filter's own name does not satisfy the typed query", () => {
  const shopping = { id: "shop", name: "Shopping List", color: "coral" };
  const hoodie = bookmark({
    id: "hoodie",
    title: "Shadowflex Hoodie",
    domain: "viralpickz.onshopbase.com",
    url: "https://viralpickz.onshopbase.com/hoodie",
    contentKind: "web",
    fetchStatus: "unsupported",
    tags: [shopping],
  });
  const notepad = bookmark({
    id: "pad",
    title: "Notepad Duo",
    domain: "rodanotes.com",
    url: "https://rodanotes.com/notepad-duo",
    description: "Lined notebook for lists",
    contentKind: "web",
    fetchStatus: "unsupported",
    tags: [shopping],
  });
  const hits = compileSearchResults({
    query: "l",
    filters: { tagIds: ["shop"], status: "all", kind: "all" },
    serverItems: [hoodie, notepad],
    cachedItems: [hoodie, notepad],
    serverMatchesQuery: true,
  });
  assert.deepEqual(
    hits.map((item) => item.id),
    ["hoodie"],
  );
});

test("other tags still match text while a tag filter is on", () => {
  const shopping = { id: "shop", name: "Shopping List", color: "coral" };
  const sale = { id: "sale", name: "Sale", color: "green" };
  const notepad = bookmark({
    id: "pad",
    title: "Notepad Duo",
    domain: "rodanotes.com",
    url: "https://rodanotes.com/notepad-duo",
    tags: [shopping, sale],
  });
  const hits = compileSearchResults({
    query: "sale",
    filters: { tagIds: ["shop"], status: "all", kind: "all" },
    serverItems: [],
    cachedItems: [notepad],
    serverMatchesQuery: false,
  });
  assert.deepEqual(
    hits.map((item) => item.id),
    ["pad"],
  );
});

test("text and tag filters are AND, even on a stale tag-only server page", () => {
  const taggedHit = bookmark({
    id: "hit",
    title: "Morning brew",
    tags: [{ id: "espresso", name: "espresso", color: "amber" }],
  });
  const taggedMiss = bookmark({
    id: "miss",
    title: "Zebra recipes",
    tags: [{ id: "espresso", name: "espresso", color: "amber" }],
  });
  const untaggedHit = bookmark({
    id: "other",
    title: "Morning notes",
    tags: [],
  });
  const hits = compileSearchResults({
    query: "morning",
    filters: { tagIds: ["espresso"], status: "all", kind: "all" },
    serverItems: [taggedHit, taggedMiss],
    cachedItems: [taggedHit, taggedMiss, untaggedHit],
    serverMatchesQuery: false,
  });
  assert.deepEqual(
    hits.map((item) => item.id),
    ["hit"],
  );
});

test("a fresh server hit that only matched article text is kept if filters pass", () => {
  const bodyOnly = bookmark({
    id: "body",
    title: "Diary",
    tags: [{ id: "espresso", name: "espresso", color: "amber" }],
  });
  const hits = compileSearchResults({
    query: "morning",
    filters: { tagIds: ["espresso"], status: "all", kind: "all" },
    serverItems: [bodyOnly],
    cachedItems: [],
    serverMatchesQuery: true,
  });
  assert.deepEqual(
    hits.map((item) => item.id),
    ["body"],
  );
});

test("body-only server hits still have to pass the active filters", () => {
  const bodyOnly = bookmark({
    id: "body",
    title: "Diary",
    tags: [],
  });
  const hits = compileSearchResults({
    query: "morning",
    filters: { tagIds: ["espresso"], status: "all", kind: "all" },
    serverItems: [bodyOnly],
    cachedItems: [],
    serverMatchesQuery: true,
  });
  assert.deepEqual(
    hits.map((item) => item.id),
    [],
  );
});

test("compileSearchResults does not throw on incomplete cache rows", () => {
  const broken = {
    id: "x",
    title: "Inbox",
    url: "",
    domain: "",
    description: null,
    tags: undefined,
    createdAt: undefined,
  } as unknown as BookmarkDto;
  assert.doesNotThrow(() => {
    compileSearchResults({
      query: "in",
      filters: none,
      serverItems: [],
      cachedItems: [broken],
      serverMatchesQuery: false,
    });
  });
});

test("compileSearchResults ignores null tag entries in the haystack", () => {
  const broken = bookmark({
    id: "nt",
    title: "Inbox",
    tags: [null as unknown as BookmarkDto["tags"][number]],
  });
  assert.doesNotThrow(() => {
    compileSearchResults({
      query: "in",
      filters: none,
      serverItems: [],
      cachedItems: [broken],
      serverMatchesQuery: false,
    });
  });
});

test("reuseSearchResults keeps the same array when order is unchanged", () => {
  const first = bookmark({ id: "a", title: "Morning" });
  const compiled = [first];
  const again = [bookmark({ id: "a", title: "Morning" })];
  const kept = reuseSearchResults(compiled, again);
  assert.equal(kept, compiled);
  const reordered = reuseSearchResults(compiled, [
    bookmark({ id: "b", title: "Other" }),
    first,
  ]);
  assert.notEqual(reordered, compiled);
});
