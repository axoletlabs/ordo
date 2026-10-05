/** Enumerate every JSX occurrence and literal label, including conditional UI.
 * This is a source inventory, NOT an automated declaration of M3 compliance.
 * pnpm audit:inventory > /tmp/opencode/ordo-ui-inventory.json
 */
import { readdir, readFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";
import path from "node:path";
import ts from "typescript";

const root = fileURLToPath(new URL("../", import.meta.url));
async function files(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const nested = await Promise.all(entries.map(entry => entry.isDirectory() ? files(path.join(directory, entry.name))
    : entry.name.endsWith(".tsx") ? [path.join(directory, entry.name)] : []));
  return nested.flat().sort();
}
const inventory = [];
const labelProperty = /^(label|title|subtitle|placeholder|accessibilityLabel|accessibilityHint|helper|message|confirmLabel|cancelLabel|description)$/;
for (const file of [...await files(path.join(root, "app")), ...await files(path.join(root, "src/components"))]) {
  const text = await readFile(file, "utf8");
  const source = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const elements = [], labels = [], reviewFlags = [];
  function visit(node) {
    const line = source.getLineAndCharacterOfPosition(node.getStart(source)).line + 1;
    if (ts.isJsxOpeningElement(node) || ts.isJsxSelfClosingElement(node)) {
      const tag = node.tagName.getText(source);
      const props = Object.fromEntries(node.attributes.properties.map((prop, index) => ts.isJsxAttribute(prop)
        ? [prop.name.getText(source), prop.initializer?.getText(source) ?? "true"] : [`spread-${index}`, prop.getText(source)]));
      elements.push({ tag, line, props });
      if (["Pressable", "TouchableOpacity", "TextInput"].includes(tag)) reviewFlags.push({ line, reason: `Raw ${tag}: verify primitive/boundary exception` });
      if (tag === "Input" && !props.label && props.variant !== '"search"') reviewFlags.push({ line, reason: "Field needs a persistent label or documented search exception" });
      if (tag === "Segmented" && !props.accessibilityLabel) reviewFlags.push({ line, reason: "Selection group needs an accessible name" });
    }
    if (ts.isJsxText(node) && node.text.trim()) labels.push({ line, value: node.text.trim().replace(/\s+/g, " ") });
    if (ts.isJsxAttribute(node) && labelProperty.test(node.name.getText(source))) {
      labels.push({ line, attribute: node.name.getText(source), value: node.initializer?.getText(source) ?? "true" });
    }
    if (ts.isPropertyAssignment(node) && labelProperty.test(node.name.getText(source).replace(/^['"]|['"]$/g, ""))) {
      labels.push({ line, property: node.name.getText(source), value: node.initializer.getText(source) });
    }
    ts.forEachChild(node, visit);
  }
  visit(source);
  inventory.push({ file: path.relative(root, file), sha256: createHash("sha256").update(text).digest("hex"),
    elements, labels, reviewFlags });
}
console.log(JSON.stringify({ kind: "source inventory; conditional/runtime states require separate verification",
  summary: { files: inventory.length, routesAndLayouts: inventory.filter(item => item.file.startsWith("app/")).length,
    jsxOccurrences: inventory.reduce((sum, item) => sum + item.elements.length, 0),
    labelOccurrences: inventory.reduce((sum, item) => sum + item.labels.length, 0),
    reviewFlags: inventory.reduce((sum, item) => sum + item.reviewFlags.length, 0) }, files: inventory }, null, 2));
