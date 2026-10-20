/** Execute the real component with a small hook host, without native modules. */
const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const { resolve } = require("node:path");
const { test } = require("node:test");
const ts = require("typescript");
const sourceRoot = process.env.ORDO_PATTERN_SOURCE_ROOT ?? resolve(__dirname, "../src");

function setup() {
  const slots = [];
  let cursor = 0, constructions = 0, handlers;
  const react = {
    useState(initial) {
      const index = cursor++;
      if (!(index in slots)) slots[index] = typeof initial === "function" ? initial() : initial;
      return [slots[index], value => { slots[index] = typeof value === "function" ? value(slots[index]) : value; }];
    },
    useRef(initial) {
      const index = cursor++;
      if (!(index in slots)) slots[index] = { current: initial };
      return slots[index];
    },
    useMemo: fn => fn(),
  };
  react.default = react;
  const filename = resolve(sourceRoot, "components/bookmarks/PatternInput.tsx");
  const module = { exports: {} };
  const { outputText } = ts.transpileModule(readFileSync(filename, "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX },
  });
  const mocks = {
    react,
    "react/jsx-runtime": { jsx: (type, props) => ({ type, props }), jsxs: (type, props) => ({ type, props }) },
    "react-native": { Platform: { OS: "android" }, View: "View", StyleSheet: { create: x => x },
      PanResponder: { create: config => { constructions++; handlers = config; return { panHandlers: {} }; } } },
    "react-native-svg": { default: "Svg", Line: "Line" },
    "../../theme/ThemeProvider": { useTheme: () => ({ palette: {} }) },
    "../../theme/tokens": { radius: { full: 999 } },
    "../../lib/haptics": { haptics: { selection() {}, warning() {} } },
    "../../lib/pattern-input": loadPatternHelpers(),
  };
  new Function("require", "module", "exports", outputText)(name => mocks[name] ?? {}, module, module.exports);
  return {
    render(props) { cursor = 0; return module.exports.PatternInput(props); },
    constructions: () => constructions,
    handlers: () => handlers,
  };
}

function loadPatternHelpers() {
  const module = { exports: {} };
  const source = readFileSync(resolve(sourceRoot, "lib/pattern-input.ts"), "utf8");
  const { outputText } = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS } });
  new Function("module", "exports", outputText)(module, module.exports);
  return module.exports;
}

test("pattern drawing does not construct a new native responder on every pointer render", () => {
  const host = setup();
  const changes = [], completed = [];
  let value = [];
  const render = () => host.render({ value, onChange: next => { value = next; changes.push(next); }, onComplete: nodes => completed.push(nodes) });
  render();
  const handlers = host.handlers();
  assert.equal(handlers.onStartShouldSetPanResponder(), true);
  handlers.onPanResponderGrant({ nativeEvent: { pageX: 36, pageY: 36, locationX: 36, locationY: 36 } });
  render();
  for (let step = 1; step <= 90; step++) {
    handlers.onPanResponderMove({ nativeEvent: { pageX: 36 + step, pageY: 36 } });
    render();
  }
  for (const [pageX, pageY] of [[216, 36], [216, 126]]) {
    handlers.onPanResponderMove({ nativeEvent: { pageX, pageY } });
    render();
  }
  handlers.onPanResponderRelease(); render();
  assert.equal(host.constructions(), 1);
  assert.equal(host.handlers(), handlers);
  assert.deepEqual(completed, [[0, 1, 2, 5]]);
  assert.deepEqual(changes.at(-1), [0, 1, 2, 5]);
});

test("a retained pattern responder sees current disabled state and callbacks", () => {
  const host = setup();
  host.render({ value: [], onChange() { throw new Error("Old callback"); } });
  const handlers = host.handlers();
  host.render({ value: [], disabled: true, onChange() {} });
  assert.equal(handlers.onStartShouldSetPanResponder(), false);
  const current = [];
  host.render({ value: [], disabled: false, onChange: value => current.push(value) });
  handlers.onPanResponderGrant({ nativeEvent: { pageX: 36, pageY: 36, locationX: 36, locationY: 36 } });
  assert.deepEqual(current, [[], [0]]);
  assert.equal(host.constructions(), 1);
});
