/** Coverage guard: every route and every JSX occurrence enters the source ledger.
 * This is source coverage, not a claim that fixtures emulate every device state. */
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import ts from "typescript";

const inventory = JSON.parse(execFileSync(process.execPath, [new URL("./ui-inventory.mjs", import.meta.url).pathname], { maxBuffer: 8 * 1024 * 1024 }));
const smoke = readFileSync(new URL("./material-ui-smoke.mjs", import.meta.url), "utf8");
const source = ts.createSourceFile("smoke.mjs", smoke, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
const routes = new Set();
ts.forEachChild(source, node => {
  if (!ts.isVariableStatement(node)) return;
  for (const declaration of node.declarationList.declarations) {
    if (!["authRoutes", "appRoutes"].includes(declaration.name.getText(source))) continue;
    for (const route of declaration.initializer.elements) routes.add(route.text.split("?")[0]);
  }
});
test("every screen route is exercised by the full light/dark, Standard/Expressive, portrait/wide suite", () => {
  const screens = inventory.files.filter(file => file.file.startsWith("app/") && !file.file.endsWith("_layout.tsx"));
  for (const screen of screens) {
    const route = screen.file.replace(/^app\//, "").replace(/\([^/]+\)\//g, "").replace(/\.tsx$/, "").replace(/(^|\/)index$/, "")
      .replace(/\[id\]/, screen.file.includes("folder/") ? "collection" : screen.file.includes("reader/") ? "article" : "design");
    assert.ok(routes.has(route), `${screen.file}: missing route fixture ${route}`);
  }
  assert.equal(screens.length, routes.size);
});
test("the ledger covers all UI occurrences, including conditional controls and raw boundaries", () => {
  assert.ok(inventory.summary.files > 0 && inventory.summary.jsxOccurrences > 0);
  assert.equal(inventory.summary.jsxOccurrences, inventory.files.reduce((sum, file) => sum + file.elements.length, 0));
  const allowedRawBoundaries = new Set(["Input.tsx", "OtpInput.tsx", "PressableScale.tsx", "ListPressable.tsx", "ContextMenu.tsx", "FloatingPanel.tsx"]);
  for (const file of inventory.files) for (const element of file.elements) {
    if (!["Pressable", "TouchableOpacity", "TextInput"].includes(element.tag)) continue;
    assert.ok(allowedRawBoundaries.has(file.file.split("/").at(-1)), `${file.file}:${element.line}: raw control needs a motion review`);
  }
});

test("shape-aware controls keep an implementation across design modes and use physical spring targets", () => {
  for (const file of inventory.files) for (const element of file.elements) {
    if (element.tag !== "PressableScale" || !element.props.shape) continue;
    assert.ok(!element.props.shape.includes("radius.full"), `${file.file}:${element.line}: a full-radius silhouette is not a physical spring target`);
    assert.ok(!element.props.shape.includes("undefined") || element.props.animated,
      `${file.file}:${element.line}: conditional shape controls need a stable animated implementation`);
  }
});
