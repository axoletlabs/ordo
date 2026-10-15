import assert from "node:assert/strict";
import { test } from "node:test";
import { isTag, type ChildNode } from "domhandler";
import { ARTICLE_SECTION_BLOCKS, prepareArticleSections, reuseArticleSections } from "./article-sections.ts";

function elements(nodes: ChildNode[], name: string): ChildNode[] {
  return nodes.flatMap(node => isTag(node) ? [...(node.name === name ? [node] : []), ...elements(node.children, name)] : []);
}
function text(nodes: ChildNode[]): string {
  return nodes.map(node => node.type === "text" ? node.data : "children" in node ? text(node.children) : "").join("");
}

test("book-length nested articles preserve every paragraph in bounded sections", () => {
  const paragraphs = Array.from({ length: 1200 }, (_, index) => `<p>Paragraph ${index}: <strong>keep &amp; read</strong>.</p>`);
  const { sections } = prepareArticleSections(`<div><article>${paragraphs.join("")}</article></div>`);
  assert.equal(sections.length, Math.ceil(paragraphs.length / ARTICLE_SECTION_BLOCKS));
  assert.equal(sections.reduce((sum, section) => sum + elements(section.dom.children, "p").length, 0), 1200);
  for (const section of sections) assert.ok(elements(section.dom.children, "p").length <= ARTICLE_SECTION_BLOCKS);
  assert.equal(sections.map(section => text(section.dom.children)).join(""),
    paragraphs.map((_, index) => `Paragraph ${index}: keep & read.`).join(""));
});

test("generated heading IDs are globally unique and avoid source IDs", () => {
  const { sections, headings } = prepareArticleSections(`<h2 id="ordo-heading-0">Source &amp; title</h2>${"<h2>Repeated</h2><p>Text</p>".repeat(30)}`);
  assert.equal(headings.length, 31);
  assert.equal(new Set(headings.map(heading => heading.id)).size, 31);
  assert.equal(headings[0]?.text, "Source & title");
  assert.deepEqual(sections.flatMap(section => elements(section.dom.children, "h2")).map(node => isTag(node) ? node.attribs.id : null), headings.map(heading => heading.id));
});

test("lists, tables, styled containers, media, links and highlights retain their structure", () => {
  const html = '<div style="padding:8px"><p>Styled</p></div><ol start="7"><li>Seven</li><li>Eight</li></ol><table><tr><td>Cell</td></tr></table><p><a href="https://example.test/?a=1&amp;b=2"><mark id="ordo-hl-saved">Keep</mark></a><img src="https://example.test/image.png"></p>';
  const { sections } = prepareArticleSections(html);
  const nodes = sections.flatMap(section => section.dom.children);
  assert.equal(elements(nodes, "li").length, 2);
  assert.equal(elements(nodes, "td").length, 1);
  assert.equal(elements(nodes, "mark").length, 1);
  assert.equal(elements(nodes, "img").length, 1);
  const ol = elements(nodes, "ol")[0];
  assert.ok(ol && isTag(ol));
  assert.equal(ol.attribs.start, "7");
});

test("empty documents are safe and DOM parent/sibling links remain consistent", () => {
  assert.deepEqual(prepareArticleSections("").sections, []);
  const { sections } = prepareArticleSections(`<div>${"<p>A</p><p>B</p>".repeat(20)}</div>`);
  const verify = (parent: { children: ChildNode[] }) => parent.children.forEach((node, index) => {
    assert.equal(node.parent, parent);
    assert.equal(node.prev, parent.children[index - 1] ?? null);
    assert.equal(node.next, parent.children[index + 1] ?? null);
    if ("children" in node) verify(node);
  });
  sections.forEach(section => verify(section.dom));
});

test("highlight edits retain unchanged section sources", () => {
  const html = Array.from({ length: 80 }, (_, index) => `<p>Paragraph ${index}</p>`).join("");
  const previous = prepareArticleSections(html).sections;
  const next = prepareArticleSections(html.replace("Paragraph 50", '<mark id="ordo-hl-one">Paragraph 50</mark>')).sections;
  const reused = reuseArticleSections(previous, next);
  assert.equal(reused.filter((section, index) => section !== previous[index]).length, 1);
});

test("highlight markup cannot shift the text-size section boundaries", () => {
  const html = Array.from({ length: 200 }, (_, index) => `<p>Paragraph ${index}: ${"Reading ".repeat(90)}</p>`).join("");
  const previous = prepareArticleSections(html).sections;
  const next = prepareArticleSections(html.replace("Paragraph 5", '<mark id="ordo-hl-one">Paragraph 5</mark>')).sections;
  assert.equal(next.length, previous.length);
  const reused = reuseArticleSections(previous, next);
  assert.equal(reused.filter((section, index) => section !== previous[index]).length, 1);
});
