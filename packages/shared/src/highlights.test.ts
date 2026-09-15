import assert from "node:assert/strict";
import { test } from "node:test";
import {
  applyHighlightsToHtml,
  canAnchorHighlight,
  findHighlightForSelection,
  findHighlightRange,
  highlightIdFromMark,
  highlightMarkId,
  htmlToPlainText,
  quoteFromBlock,
  quoteFromCaret,
  quoteFromRange,
  sentenceRange,
} from "./highlights.ts";

test("quoteFromRange trims ends and copies nearby context", () => {
  const quote = quoteFromRange("ab  hello world  cd", 4, 15);
  assert.deepEqual(quote, {
    exact: "hello world",
    prefix: "ab  ",
    suffix: "  cd",
  });
});

test("sentenceRange expands a caret to the surrounding sentence", () => {
  const text = "Hello world. Next one!";
  assert.deepEqual(sentenceRange(text, 2), { start: 0, end: 12 });
  assert.deepEqual(sentenceRange(text, 14), { start: 13, end: 22 });
  assert.deepEqual(sentenceRange("No punctuation here", 4), {
    start: 0,
    end: 19,
  });
});

test("quoteFromCaret lifts a pressed sentence onto article context", () => {
  const article = "First paragraph. Second has the word unique here.";
  const block = "Second has the word unique here.";
  const quote = quoteFromCaret(article, block, block.indexOf("unique"));
  assert.equal(quote?.exact, "Second has the word unique here.");
  assert.ok(quote?.prefix?.includes("paragraph."));
});

test("quoteFromBlock lifts a mid-article selection onto document context", () => {
  const article = "First paragraph. Second has the word unique here.";
  const block = "Second has the word unique here.";
  const start = block.indexOf("unique");
  const quote = quoteFromBlock(article, block, start, start + "unique".length);
  assert.equal(quote?.exact, "unique");
  assert.ok(quote?.prefix?.endsWith("word "));
  assert.ok(quote?.suffix?.startsWith(" here"));
});

test("htmlToPlainText joins blocks with a space and decodes entities", () => {
  assert.equal(
    htmlToPlainText("<p>Hello&nbsp;world.</p><p>Next &amp; last</p>"),
    "Hello\u00a0world. Next & last",
  );
});

test("wraps a unique quote across inline tags", () => {
  const html = "<p>Hello <em>world</em> today.</p>";
  const wrapped = applyHighlightsToHtml(html, [
    { id: "h1", exact: "lo wor", prefix: "Hel", suffix: "ld", href: null },
  ]);
  assert.equal(
    wrapped,
    '<p>Hel<mark id="ordo-hl-h1">lo </mark><em><mark id="ordo-hl-h1">wor</mark>ld</em> today.</p>',
  );
  assert.equal(highlightIdFromMark(highlightMarkId("h1")), "h1");
});

test("prefix disambiguates repeated quotes", () => {
  const html = "<p>the cat and the hat</p>";
  const wrapped = applyHighlightsToHtml(html, [
    { id: "h1", exact: "the", prefix: "and ", suffix: " hat", href: null },
  ]);
  assert.equal(wrapped, '<p>the cat and <mark id="ordo-hl-h1">the</mark> hat</p>');
});

test("reopens marks across block boundaries", () => {
  const html = "<p>Hello</p><p>world</p>";
  const wrapped = applyHighlightsToHtml(html, [
    { id: "h1", exact: "Hello world", prefix: "", suffix: "", href: null },
  ]);
  assert.equal(
    wrapped,
    '<p><mark id="ordo-hl-h1">Hello</mark></p><p><mark id="ordo-hl-h1">world</mark></p>',
  );
});

test("skips overlapping highlights and unmatched quotes", () => {
  const html = "<p>abcdef</p>";
  const wrapped = applyHighlightsToHtml(html, [
    { id: "a", exact: "bcd", prefix: "a", suffix: "ef", href: null },
    { id: "b", exact: "cde", prefix: "b", suffix: "f", href: null },
    { id: "c", exact: "missing", prefix: "", suffix: "", href: null },
  ]);
  assert.equal(wrapped, '<p>a<mark id="ordo-hl-a">bcd</mark>ef</p>');
  assert.equal(findHighlightRange(html, { exact: "missing" }), null);
});

test("finds the highlight that contains a selection", () => {
  const html = "<p>Hello world today.</p>";
  const highlights = [
    { id: "h1", exact: "world", prefix: "Hello ", suffix: " today", href: null },
    { id: "h2", exact: "Hello", prefix: "", suffix: " world", href: null },
  ];
  assert.equal(
    findHighlightForSelection(html, highlights, {
      exact: "world",
      prefix: "Hello ",
      suffix: " today",
    }),
    "h1",
  );
  assert.equal(
    findHighlightForSelection(html, highlights, {
      exact: "orl",
      prefix: "w",
      suffix: "d",
    }),
    "h1",
  );
  assert.equal(
    findHighlightForSelection(html, highlights, {
      exact: "Hello world",
      prefix: "",
      suffix: " today",
    }),
    null,
  );
});

test("falls back to wrapping a link when the quote moved", () => {
  const html = '<p>See <a href="https://example.com/x">the docs</a> now.</p>';
  const wrapped = applyHighlightsToHtml(html, [
    {
      id: "h1",
      exact: "old label",
      prefix: "",
      suffix: "",
      href: "https://example.com/x",
    },
  ]);
  assert.equal(
    wrapped,
    '<p>See <a href="https://example.com/x"><mark id="ordo-hl-h1">the docs</mark></a> now.</p>',
  );
  assert.equal(canAnchorHighlight(html, { exact: "nope", href: "https://example.com/x" }), true);
  assert.equal(canAnchorHighlight(html, { exact: "nope" }), false);
});
