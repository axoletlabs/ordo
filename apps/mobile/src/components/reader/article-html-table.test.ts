import assert from "node:assert/strict";
import { test } from "node:test";
import {
  collectTableRows,
  highlightIdCoveringRange,
  hrefCoveringRange,
  nodeTextContent,
  offsetFromLayout,
  plainTextFromNode,
  splitTableHeader,
  type HtmlTableNode,
} from "./article-html-table.ts";

function text(data: string): HtmlTableNode {
  return { type: "text", data };
}

function el(
  tagName: string,
  children: HtmlTableNode[] = [],
  attributes?: Record<string, string>,
): HtmlTableNode {
  return { type: "block", tagName, children, attributes };
}

test("collects header and body rows through thead/tbody wrappers", () => {
  const table = el("table", [
    el("thead", [
      el("tr", [el("th", [text("Function")]), el("th", [text("Return")])]),
    ]),
    el("tbody", [
      el("tr", [el("td", [text("init")]), el("td", [text("void")])]),
      el("tr", [el("td", [text("get")]), el("td", [text("Player")])]),
    ]),
  ]);
  const rows = collectTableRows(table);
  assert.equal(rows.length, 3);
  const { header, body } = splitTableHeader(rows);
  assert.deepEqual(header?.map(plainTextFromNode), ["Function", "Return"]);
  assert.equal(body.length, 2);
  assert.equal(plainTextFromNode(body[0][0]), "init");
});

test("tables without th stay as body rows", () => {
  const table = el("table", [
    el("tr", [el("td", [text("left")]), el("td", [text("right")])]),
  ]);
  const { header, body } = splitTableHeader(collectTableRows(table));
  assert.equal(header, null);
  assert.equal(body.length, 1);
});

test("plain text joins br-separated code cells", () => {
  const cell = el("td", [
    el("code", [text("callback")]),
    { type: "block", tagName: "br", children: [] },
    el("code", [text("duration = 20")]),
  ]);
  assert.equal(plainTextFromNode(cell), "callback\nduration = 20");
});

test("nodeTextContent keeps inner spaces for native selection offsets", () => {
  const paragraph = el("p", [text("Hello "), el("em", [text("world")])]);
  assert.equal(nodeTextContent(paragraph), "Hello world");
});

test("hrefCoveringRange is set only when the selection sits inside one link", () => {
  const paragraph = el("p", [
    text("See "),
    el("a", [text("docs")], { href: "https://example.com/docs" }),
    text(" here"),
  ]);
  assert.equal(hrefCoveringRange(paragraph, 4, 8), "https://example.com/docs");
  assert.equal(hrefCoveringRange(paragraph, 0, 8), null);
  assert.equal(hrefCoveringRange(paragraph, 0, 3), null);
  assert.equal(hrefCoveringRange(paragraph, 9, 13), null);
});

test("highlightIdCoveringRange is set only when the selection sits inside one mark", () => {
  const paragraph = el("p", [
    text("Hello "),
    el("mark", [text("world")], { id: "ordo-hl-h1" }),
    text(" today"),
  ]);
  assert.equal(highlightIdCoveringRange(paragraph, 6, 11), "h1");
  assert.equal(highlightIdCoveringRange(paragraph, 7, 10), "h1");
  assert.equal(highlightIdCoveringRange(paragraph, 0, 11), null);
  assert.equal(highlightIdCoveringRange(paragraph, 0, 5), null);
});

test("highlightIdCoveringRange keeps one id split across nested tags", () => {
  const paragraph = el("p", [
    text("Hel"),
    el("mark", [text("lo ")], { id: "ordo-hl-h1" }),
    el("em", [el("mark", [text("wor")], { id: "ordo-hl-h1" }), text("ld")]),
  ]);
  assert.equal(highlightIdCoveringRange(paragraph, 3, 9), "h1");
  assert.equal(highlightIdCoveringRange(paragraph, 3, 11), null);
});

test("highlightIdCoveringRange reads a flattened TRE mark text node", () => {
  const paragraph = el("p", [
    text("Hello "),
    { type: "text", tagName: "mark", data: "world", attributes: { id: "ordo-hl-h1" } },
    text(" today"),
  ]);
  assert.equal(highlightIdCoveringRange(paragraph, 6, 11), "h1");
  assert.equal(highlightIdCoveringRange(paragraph, 0, 11), null);
});

test("offsetFromLayout maps a press onto a character index", () => {
  const lines = [
    { text: "Hello ", x: 0, y: 0, width: 60, height: 20 },
    { text: "world", x: 0, y: 20, width: 50, height: 20 },
  ];
  assert.equal(offsetFromLayout(lines, 0, 5), 0);
  assert.equal(offsetFromLayout(lines, 25, 25), 6 + Math.round(0.5 * 5));
});
