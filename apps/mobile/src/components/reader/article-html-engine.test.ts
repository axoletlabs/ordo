import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { test } from "node:test";
import {
  collectTableRows,
  highlightIdCoveringRange,
  nodeTextContent,
  plainTextFromNode,
  splitTableHeader,
  type HtmlTableNode,
} from "./article-html-table.ts";

const { TRenderEngine } = createRequire(new URL("../../../package.json", import.meta.url))(
  "@native-html/transient-render-engine",
) as { TRenderEngine: new () => { buildTTree: (html: string) => HtmlTableNode } };

function textFromNode(node: HtmlTableNode): string {
  if (node.type === "text") return node.data ?? "";
  return (node.children ?? []).map(textFromNode).join("");
}

function findByTag(node: HtmlTableNode, tagName: string): HtmlTableNode | undefined {
  if (node.tagName === tagName) return node;
  for (const child of node.children ?? []) {
    const found = findByTag(child, tagName);
    if (found) return found;
  }
  return undefined;
}

test("TRE 12 table tree still flattens into labeled header/body rows", () => {
  const engine = new TRenderEngine();
  const tree = engine.buildTTree(`
    <table>
      <thead><tr><th>Function</th><th>Return</th></tr></thead>
      <tbody><tr><td>init</td><td>void</td></tr></tbody>
    </table>
  `);
  const table = findByTag(tree, "table");
  assert.ok(table);
  const { header, body } = splitTableHeader(collectTableRows(table));
  assert.deepEqual(header?.map(plainTextFromNode), ["Function", "Return"]);
  assert.equal(body.length, 1);
  assert.equal(plainTextFromNode(body[0][0]), "init");
});

test("TRE 12 keeps heading text and nested inline spaces", () => {
  const engine = new TRenderEngine();
  const tree = engine.buildTTree(`
    <h1>Title</h1>
    <p>Hello <em>world</em>.</p>
  `);
  const h1 = findByTag(tree, "h1");
  const p = findByTag(tree, "p");
  assert.equal(textFromNode(h1!).replace(/\s+/g, " ").trim(), "Title");
  assert.equal(textFromNode(p!), "Hello world.");
});

test("TRE keeps mark ids so a highlight selection can be removed", () => {
  const engine = new TRenderEngine();
  const tree = engine.buildTTree('<p>Hello <mark id="ordo-hl-h1">world</mark> today.</p>');
  const p = findByTag(tree, "p");
  assert.ok(p);
  const text = nodeTextContent(p);
  const start = text.indexOf("world");
  assert.ok(start >= 0);
  assert.equal(highlightIdCoveringRange(p, start, start + "world".length), "h1");
  assert.equal(highlightIdCoveringRange(p, 0, start + "world".length), null);
});
