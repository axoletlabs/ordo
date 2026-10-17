/** Reproducible source/interaction inventory; findings still need human review.
 * node apps/mobile/scripts/audit-inventory.mjs /tmp/opencode/ordo-inventory.json
 */
import { createHash } from "node:crypto";
import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";
const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const files = [];
async function scan(path) {
  for (const entry of await readdir(path, { withFileTypes: true })) {
    const filename = join(path, entry.name);
    if (entry.isDirectory()) await scan(filename);
    else if (/\.tsx?$/.test(entry.name)) {
      const source = await readFile(filename, "utf8");
      const parsed = ts.createSourceFile(filename, source, ts.ScriptTarget.Latest, true, filename.endsWith("tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
      const elements = {}, motion = [], interactions = [];
      const visit = (node) => {
        if (ts.isJsxOpeningElement(node) || ts.isJsxSelfClosingElement(node)) {
          const tag = node.tagName.getText(parsed);
          elements[tag] = (elements[tag] ?? 0) + 1;
          const handlers = node.attributes.properties.filter((attr) => ts.isJsxAttribute(attr) && /^on[A-Z]/.test(attr.name.getText(parsed))).map((attr) => attr.name.getText(parsed));
          if (handlers.length) interactions.push({ tag, line: parsed.getLineAndCharacterOfPosition(node.getStart()).line + 1, handlers });
        }
        if (ts.isCallExpression(node) && /^(withSpring|withTiming|withRepeat|useFrameCallback|requestAnimationFrame|setInterval|Animated\.(spring|timing|loop))$/.test(node.expression.getText(parsed))) {
          motion.push({ call: node.expression.getText(parsed), line: parsed.getLineAndCharacterOfPosition(node.getStart()).line + 1 });
        }
        ts.forEachChild(node, visit);
      };
      visit(parsed);
      files.push({ path: relative(root, filename), lines: source.split("\n").length, sha256: createHash("sha256").update(source).digest("hex"), elements, motion, interactions });
    }
  }
}
await scan(join(root, "app")); await scan(join(root, "src"));
const result = { scope: "All mobile app/ and src/ TypeScript files, not native binaries or dependency internals", files,
  totals: { files: files.length, routes: files.filter((file) => file.path.startsWith("app/")).length,
    lines: files.reduce((sum, file) => sum + file.lines, 0),
    interactions: files.reduce((sum, file) => sum + file.interactions.length, 0), motionCalls: files.reduce((sum, file) => sum + file.motion.length, 0) } };
const output = process.argv.slice(2).find((arg) => !arg.startsWith("--")) ?? "/tmp/opencode/ordo-audit-inventory.json";
if (process.argv.includes("--compact")) result.files = files.map(({ path, lines, sha256, motion, interactions }) => ({
  path, lines, sha256, interactions: interactions.length, motionCalls: motion.length,
}));
await mkdir(dirname(resolve(output)), { recursive: true });
await writeFile(output, JSON.stringify(result, null, 2));
console.log(JSON.stringify(result.totals));
