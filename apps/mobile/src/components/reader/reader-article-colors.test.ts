import assert from "node:assert/strict";
import { test } from "node:test";
import { createRequire } from "node:module";
import type { TNode } from "@native-html/transient-render-engine";
import { argbFromHex, Contrast, lstarFromArgb } from "@material/material-color-utilities";
import { materialColorRoles } from "../../theme/material-colors.ts";
import { readerArticleColors, READER_IGNORED_INLINE_STYLES } from "./reader-article-colors.ts";

const { TRenderEngine } = createRequire(import.meta.url)("@native-html/transient-render-engine") as typeof import("@native-html/transient-render-engine");

function ratio(ink: string, surface: string) {
  return Contrast.ratioOfTones(lstarFromArgb(argbFromHex(ink)), lstarFromArgb(argbFromHex(surface)));
}

test("reader ignores source colors/typography but retains semantic links and emphasis", () => {
  const engine = new TRenderEngine({ cssProcessorConfig: { inlinePropertiesBlacklist: READER_IGNORED_INLINE_STYLES }, stylesConfig: {
    baseStyle: { color: "#e1e3df", fontSize: 17, lineHeight: 28 },
    tagsStyles: { a: { color: "#80d5c7", textDecorationLine: "underline" }, strong: { fontWeight: "700" } },
  } });
  const tree = engine.buildTTree('<p><span style="color: #ffffff; background-color: #ffffff; font-size: 80px; line-height: 3px">Source text</span> <strong><a href="https://example.test">A link</a></strong></p>');
  const textNodes: TNode[] = [];
  function walk(node: TNode) {
    if (node.type === "text") textNodes.push(node);
    else for (const child of node.children) walk(child);
  }
  walk(tree);
  const source = textNodes.find(node => node.type === "text" && node.data === "Source text")!;
  assert.equal(source.getNativeStyles().color, "#e1e3df");
  assert.equal(source.getNativeStyles().fontSize, 17);
  assert.equal(source.getNativeStyles().lineHeight, 28);
  assert.equal(source.getNativeStyles().backgroundColor, undefined);
  const link = textNodes.find(node => node.type === "text" && node.data === "A link")!;
  assert.equal(link.getNativeStyles().color, "#80d5c7");
  assert.equal(link.getNativeStyles().textDecorationLine, "underline");
  assert.equal(link.getNativeStyles().fontWeight, "700");
});
for (const seed of ["#006A60", "#6750A4", "#005AC1"]) for (const dark of [false, true]) for (const contrast of [0, 0.5, 1] as const) {
  test(`Reader roles ${seed}, ${dark ? "dark" : "light"}, contrast ${contrast}`, () => {
    const palette = materialColorRoles(seed, dark, false, contrast);
    const colors = readerArticleColors(palette);
    for (const surface of [palette.surface, colors.block, colors.selection, ...(dark ? ["#000000"] : [])]) {
      for (const ink of [colors.body, colors.supporting, colors.link]) {
        assert.ok(ratio(ink, surface) >= 4.45, `${ink} on ${surface}: ${ratio(ink, surface)}`);
      }
    }
    assert.ok(ratio(colors.onHighlight, colors.highlight) >= 4.45);
    assert.ok(ratio(colors.body, colors.selection) >= 4.45);
  });
}
