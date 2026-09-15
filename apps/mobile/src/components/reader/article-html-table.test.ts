import assert from "node:assert/strict";
import { test } from "node:test";
import {
  collectTableRows,
  nodeTextContent,
  offsetFromLayout,
  plainTextFromNode,
  splitTableHeader,
  type HtmlTableNode,
} from "./article-html-table.ts";

function text(data: string): HtmlTableNode {
  return { type: "text", data };
}

function el(tagName: string, children: HtmlTableNode[] = []): HtmlTableNode {
  return { type: "block", tagName, children };
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

test("offsetFromLayout maps a press onto a character index", () => {
  const lines = [
    { text: "Hello ", x: 0, y: 0, width: 60, height: 20 },
    { text: "world", x: 0, y: 20, width: 50, height: 20 },
  ];
  assert.equal(offsetFromLayout(lines, 0, 5), 0);
  assert.equal(offsetFromLayout(lines, 25, 25), 6 + Math.round(0.5 * 5));
});
