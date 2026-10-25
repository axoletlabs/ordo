/** Cold native popup layout, before any onLayout callback can rescue sizing.
 * Render the real FloatingPanel tree, then lay it out using Yoga's native
 * defaults. Browser flexbox and tests that pre-supply a measured card height
 * both miss the flex:1 bootstrap collapse this regression guards against. */
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const React = require("react");
const { renderToStaticMarkup } = require("react-dom/server");
const { parseDocument } = require("htmlparser2");
const babel = require("@babel/core");

const sourcePath = process.argv[2] ?? path.join(__dirname, "../src/components/ui/FloatingPanel.tsx");
let viewport;
const flatten = style => Array.isArray(style) ? Object.assign({}, ...style.map(flatten)) : style ?? {};
const View = ({ children, style, testID, role }) => React.createElement("native-view", {
  "data-style": JSON.stringify(flatten(style)), "data-id": testID, "data-role": role,
}, children);
const pass = ({ children }) => children;
const Context = React.createContext(null);
const Header = () => React.createElement(View, { style: { height: 100, flexShrink: 0 }, testID: "fixture-header" });
const Actions = () => React.createElement(View, { style: { height: 64, flexShrink: 0 }, testID: "fixture-actions" });
const motion = { reducedMotion: false };
const palette = { surfaceContainerLow: "#eee", surfaceContainerHigh: "#ddd", overlay: "#0008" };
const stubs = {
  react: React,
  "react/jsx-runtime": require("react/jsx-runtime"),
  "react-native": {
    View, Pressable: pass, Platform: { OS: "android" },
    StyleSheet: { absoluteFill: { position: "absolute", top: 0, right: 0, bottom: 0, left: 0 }, create: x => x, flatten },
    useWindowDimensions: () => viewport, Keyboard: { metrics: () => null },
  },
  "react-native-reanimated": {
    __esModule: true, default: { View }, useSharedValue: value => ({ value }), useAnimatedStyle: fn => fn(),
  },
  "react-native-gesture-handler": {
    Gesture: { Pan: () => { const pan = new Proxy({}, { get: () => () => pan }); return pan; } }, GestureDetector: pass,
  },
  "react-native-svg": { __esModule: true, default: pass, Defs: pass, LinearGradient: pass, Rect: pass, Stop: pass },
  "react-native-safe-area-context": { useSafeAreaInsets: () => ({ top: 24, bottom: 24, left: 0, right: 0 }) },
  "overlay-host": { OverlayPortal: pass, useOverlayBlocked: () => false },
  ThemeProvider: { useTheme: () => ({ palette }) },
  "use-overlay-presence": { useOverlayPresence: () => ({ rendered: true, progress: { value: 0 }, spatial: { value: 0 } }) },
  "use-overlay-focus": { useOverlayFocus: () => ({ current: null }) },
  // Before layout, the real hook has no measured height and applies no size.
  "use-surface-size": { useSurfaceSize: () => ({}) },
  "panel-keyboard-layout": { panelKeyboardLift: () => 0 },
  "use-scrim-press": { useScrimPress: () => ({}) },
  "resize-owner": { ResizeOwnerContext: Context },
  "panel-title": { PanelTitleContext: Context },
  "panel-presence": { PanelPresenceContext: Context },
  "input-surface": { InputSurfaceContext: Context },
  "input-focus-scope": { InputFocusScopeContext: Context, useInputFocusScope: () => ({ active: false, ready: false }) },
  "material-motion": { useMaterialMotion: () => motion },
  tokens: { spacing: new Proxy({}, { get: (_, key) => Number(key) }), radius: {}, layout: { overlayMaxWidth: 560, overlayPadding: 24 } },
  PanelHeader: { PanelHeader: Header },
  SheetActionRow: { PanelActions: Actions },
  ThemedScrollView: { ThemedScrollView: props => React.createElement(View, props, props.children) },
  OverlayPageContent: { OverlayPageContent: View },
  "use-keyboard-visible": { dismissKeyboard() {} },
};
const code = babel.transformSync(fs.readFileSync(sourcePath, "utf8"), {
  filename: sourcePath, configFile: false, babelrc: false,
  presets: [[require.resolve("babel-preset-expo"), { disableImportExportTransform: false, worklets: false, reanimated: false }]],
}).code;
const exports_ = {};
vm.runInNewContext(`(function(require,exports){${code}\n})`, { setTimeout, clearTimeout })(name => {
  if (name.startsWith("@babel/runtime/")) return require(name);
  const stub = stubs[name] ?? stubs[name.split("/").at(-1)];
  if (stub) return stub;
  // Imported helpers not called during cold layout need no native runtime.
  if (name.endsWith("use-overlay-page")) return {};
  if (name.endsWith("PressableScale")) return { PressableScale: pass };
  throw new Error(`Unstubbed import: ${name}`);
}, exports_);

async function main() {
  const { default: Yoga } = await import("yoga-layout");
  let count = 0;
  for (const dimensions of [{ width: 412, height: 915 }, { width: 1280, height: 800 }, { width: 915, height: 412 }, { width: 412, height: 300 }]) {
    viewport = dimensions;
    for (const variant of ["form", "picker", "confirmation", "sheet"]) {
      const html = renderToStaticMarkup(React.createElement(exports_.FloatingPanel, {
        visible: true, onDismiss() {}, scrollBody: variant !== "picker",
        ...(variant === "sheet" ? { presentation: "bottom-sheet", sheetSizing: "adaptive" } : {}),
      }, React.createElement(Header), variant !== "confirmation" ? React.createElement(View, { style: { height: 120 } }) : null,
      React.createElement(Actions)));
      const boxes = new Map();
      function build(element, parent) {
        if (element.type !== "tag") return;
        const node = Yoga.Node.create();
        node.setFlexDirection(Yoga.FLEX_DIRECTION_COLUMN);
        node.setFlexShrink(0); // React Native defaults, unlike browser flexbox.
        parent.insertChild(node, parent.getChildCount());
        const style = JSON.parse(element.attribs["data-style"] ?? "{}");
        for (const [key, method] of Object.entries({ width: "setWidth", height: "setHeight", minWidth: "setMinWidth", minHeight: "setMinHeight", maxWidth: "setMaxWidth", maxHeight: "setMaxHeight", flex: "setFlex", flexGrow: "setFlexGrow", flexShrink: "setFlexShrink" })) {
          if (typeof style[key] === "number") node[method](style[key]);
        }
        for (const [key, edge] of Object.entries({ "": Yoga.EDGE_ALL, Top: Yoga.EDGE_TOP, Right: Yoga.EDGE_RIGHT, Bottom: Yoga.EDGE_BOTTOM, Left: Yoga.EDGE_LEFT, Horizontal: Yoga.EDGE_HORIZONTAL, Vertical: Yoga.EDGE_VERTICAL })) {
          if (typeof style[`padding${key}`] === "number") node.setPadding(edge, style[`padding${key}`]);
          if (typeof style[`margin${key}`] === "number") node.setMargin(edge, style[`margin${key}`]);
        }
        if (style.position === "absolute") node.setPositionType(Yoga.POSITION_TYPE_ABSOLUTE);
        for (const [key, edge] of Object.entries({ top: Yoga.EDGE_TOP, right: Yoga.EDGE_RIGHT, bottom: Yoga.EDGE_BOTTOM, left: Yoga.EDGE_LEFT })) {
          if (typeof style[key] === "number") node.setPosition(edge, style[key]);
        }
        if (style.alignItems === "center") node.setAlignItems(Yoga.ALIGN_CENTER);
        if (style.justifyContent === "center") node.setJustifyContent(Yoga.JUSTIFY_CENTER);
        if (style.justifyContent === "flex-end") node.setJustifyContent(Yoga.JUSTIFY_FLEX_END);
        if (style.overflow === "hidden") node.setOverflow(Yoga.OVERFLOW_HIDDEN);
        if (element.attribs["data-id"]) boxes.set(element.attribs["data-id"], node);
        if (element.attribs["data-role"] === "dialog") boxes.set("dialog", node);
        for (const child of element.children ?? []) build(child, node);
      }
      const root = Yoga.Node.create();
      root.setWidth(dimensions.width); root.setHeight(dimensions.height);
      for (const child of parseDocument(html).children) build(child, root);
      root.calculateLayout(dimensions.width, dimensions.height, Yoga.DIRECTION_LTR);
      const card = boxes.get("dialog");
      const top = node => node.getComputedTop() + (node.getParent() ? top(node.getParent()) : 0);
      assert.ok(card.getComputedHeight() > 200, `${variant} ${dimensions.width}×${dimensions.height}: cold popup collapsed to ${card.getComputedHeight()}dp`);
      assert.ok(card.getComputedHeight() <= dimensions.height, `${variant}: popup exceeds viewport`);
      const actions = boxes.get("fixture-actions");
      // Very short sheets intentionally scroll their entire chrome/body.
      const sheetScrollsAll = variant === "sheet" && Math.min(dimensions.height * 0.9, dimensions.height - 40) < 280;
      if (!sheetScrollsAll) assert.ok(top(actions) + actions.getComputedHeight() <= top(card) + card.getComputedHeight() + 1,
        `${variant} ${dimensions.width}×${dimensions.height}: actions at ${top(actions) + actions.getComputedHeight()} fall outside card ending at ${top(card) + card.getComputedHeight()}`);
      const body = boxes.get(variant === "sheet" ? "material-sheet-body" : "material-dialog-body");
      assert.ok(body.getComputedHeight() > 0, `${variant}: no initial body viewport`);
      root.freeRecursive(); count++;
    }
  }
  console.log(`Native popup bootstrap: ${count} Yoga layouts passed before measurement callbacks.`);
}
main().catch(error => { console.error(error); process.exitCode = 1; });
