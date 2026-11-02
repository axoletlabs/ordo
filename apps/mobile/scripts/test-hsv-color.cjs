/** Round-trip HSV/hex conversion used by the custom app-color picker. */
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const ts = require("typescript");

function load(file) {
  const exports = {};
  const code = ts.transpileModule(fs.readFileSync(file, "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  vm.runInNewContext(code, { exports, module: { exports } }, { filename: file });
  return exports;
}

const {
  clampHsv, hexToHsv, hexToRgb, hsvToHex, hsvToRgb, parseHexColor, hueHex,
} = load(path.resolve(__dirname, "../src/lib/hsv-color.ts"));

assert.equal(parseHexColor("#75A"), "#7755AA");
assert.equal(parseHexColor("7856a8"), "#7856A8");
assert.equal(parseHexColor("#006A60"), "#006A60");
assert.equal(parseHexColor("not a color"), null);
assert.equal(parseHexColor("#77AA"), null);

const teal = hexToHsv("#006A60");
assert.ok(teal);
assert.ok(Math.abs(teal.h - 174.3) < 0.5);
assert.equal(teal.s, 1);
assert.ok(Math.abs(teal.v - 106 / 255) < 1e-6);

for (const hex of ["#006A60", "#3568B4", "#7856A8", "#A84B78", "#B6533C", "#936B00", "#527A39", "#526574", "#FFFFFF", "#000000", "#FF0000", "#00FF00", "#0000FF"]) {
  const hsv = hexToHsv(hex);
  const rgb = hexToRgb(hex);
  const back = hsvToRgb(hsv);
  assert.ok(rgb && hsv);
  assert.ok(Math.abs(back.r - rgb.r) <= 1, `${hex} red ${back.r} vs ${rgb.r}`);
  assert.ok(Math.abs(back.g - rgb.g) <= 1, `${hex} green ${back.g} vs ${rgb.g}`);
  assert.ok(Math.abs(back.b - rgb.b) <= 1, `${hex} blue ${back.b} vs ${rgb.b}`);
}

assert.equal(hueHex(0), "#FF0000");
assert.equal(hueHex(120), "#00FF00");
assert.equal(hueHex(240), "#0000FF");
assert.equal(clampHsv({ h: 400, s: 2, v: -1 }).h, 40);
assert.equal(hsvToHex({ h: 0, s: 0, v: 1 }), "#FFFFFF");
assert.equal(parseHexColor(hsvToHex(hexToHsv("#75A"))), "#7755AA");

console.log("test-hsv-color: ok");
