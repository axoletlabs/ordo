const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const { resolve } = require("node:path");
const { test } = require("node:test");
const ts = require("typescript");
const React = require("react");
const { createRoot } = require("react-dom/client");
const { JSDOM } = require("jsdom");

const dom = new JSDOM("<!doctype html><html><body></body></html>");
globalThis.window = dom.window;
globalThis.document = dom.window.document;
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
const state = { panel: null, scrollResets: 0 };
const View = ({ children }) => React.createElement("div", null, children);
const List = React.forwardRef(function List({ data, renderItem }, ref) {
  React.useImperativeHandle(ref, () => ({ scrollToOffset: () => state.scrollResets++ }), []);
  return React.createElement("div", null, data.map((item, index) => React.createElement(React.Fragment, { key: item.id }, renderItem({ item, index }))));
});
const stubs = {
  react: React,
  "react/jsx-runtime": require("react/jsx-runtime"),
  "react-native": { FlatList: List, Platform: { OS: "web" }, StyleSheet: { create: value => value }, View,
    useWindowDimensions: () => ({ height: 844 }) },
  "react-native-safe-area-context": { useSafeAreaInsets: () => ({ top: 0, bottom: 0 }) },
  "../ui/FAB": { FAB: ({ onPress }) => React.createElement("button", { onClick: onPress }, "Contents"), FABLayer: View },
  "../ui/FloatingPanel": { FloatingPanel: (props) => {
    state.panel = props;
    return props.visible || props.keepMounted ? React.createElement("div", { role: "dialog" }, props.children) : null;
  } },
  "../ui/PanelHeader": { PanelHeader: () => null },
  "../ui/ListPressable": { ListPressable: ({ onPress, children }) => React.createElement("button", { onClick: onPress }, children) },
  "../ui/Text": { Text: ({ children }) => React.createElement("span", null, children) },
  "../ui/ThemedScrollView": { ThemedScrollView: View },
  "../../theme/ThemeProvider": { useTheme: () => ({ expressive: false, palette: {} }) },
  "../../theme/list-shape": { listCorners: () => ({}), listPosition: () => "middle" },
  "../../theme/tokens": { layout: { maxReaderWidth: 720 }, radius: { xs: 4 }, spacing: new Proxy({}, { get: (_, key) => Number(key) }) },
  "../../hooks/use-animation-activity": { useAnimationActivity: () => true },
};
const source = readFileSync(resolve(__dirname, "../src/components/reader/ReaderContents.tsx"), "utf8");
const { outputText } = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true },
});
const mod = { exports: {} };
new Function("require", "module", "exports", outputText)((name) => {
  if (stubs[name]) return stubs[name];
  throw new Error(`Unexpected import: ${name}`);
}, mod, mod.exports);
const { ReaderContents } = mod.exports;

test("contents navigation starts with exit, not after the closing animation", async (t) => {
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  const ref = React.createRef();
  const selected = [];
  await React.act(async () => root.render(React.createElement(ReaderContents, {
    ref, headings: [{ id: "one", text: "One", level: 2 }], onSelect: id => selected.push(id),
    sceneWidth: 390, expansion: {}, workScheduler: { schedule: () => () => {} },
  })));
  t.after(async () => { await React.act(async () => root.unmount()); container.remove(); });
  await React.act(async () => ref.current.open());
  await React.act(async () => [...container.querySelectorAll("button")].find(node => node.textContent === "One").click());
  assert.equal(state.panel.visible, false);
  assert.deepEqual(selected, [], "selection waits for the committed exit handoff");
  await React.act(async () => state.panel.onExiting());
  assert.deepEqual(selected, ["one"], "navigation starts immediately as the sheet exits");
  await React.act(async () => { state.panel.onExiting(); state.panel.onExited(); });
  assert.deepEqual(selected, ["one"], "exit completion must not navigate twice");
  assert.equal(state.scrollResets, 1, "list position resets only after exit");

  await React.act(async () => ref.current.open());
  await React.act(async () => [...container.querySelectorAll("button")].find(node => node.textContent === "One").click());
  await React.act(async () => ref.current.open());
  await React.act(async () => state.panel.onExiting());
  assert.deepEqual(selected, ["one"], "reopening cancels a superseded navigation");
});
