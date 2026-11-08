/** Execute native geometry worklets at intermediate and interrupted expansion.
 * Check relationships between actual outputs: field extent, text inset, action
 * width, and row spacing must agree without an Android rendering runtime. */
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const React = require("react");
const { renderToStaticMarkup } = require("react-dom/server");
const babel = require("@babel/core");

let progress, sample, fontScale, grouped, expressive;
let effects = [], slots = [], slotIndex = 0, positionWorklets = [], usePersistentSlots = false;
const View = ({ children, style }) => React.createElement("native-view", {
  "data-style": JSON.stringify(style),
}, children);
const stubs = {
  react: { ...React, useLayoutEffect: fn => effects.push(fn) },
  "react/jsx-runtime": require("react/jsx-runtime"),
  "react-native": {
    Platform: { OS: "android", select: values => values.android ?? values.default },
    View, TextInput: View, StyleSheet: { create: x => x },
    useWindowDimensions: () => ({ fontScale }),
  },
  "react-native-reanimated": {
    __esModule: true, default: { createAnimatedComponent: x => x, View },
    useSharedValue(value) {
      if (!usePersistentSlots) return { value: grouped ? 1 - progress : progress };
      const index = slotIndex++;
      return slots[index] ?? (slots[index] = { value });
    },
    useDerivedValue: fn => ({ get value() { return fn(); } }),
    useAnimatedStyle(fn) { positionWorklets.push(fn); return fn(); },
    interpolateColor: (x, _, colors) => colors[x < 0.5 ? 0 : 1],
    runOnUI: fn => fn,
    withSpring: value => value,
  },
  Text: { Text: View },
  ThemeProvider: { useTheme: () => ({ palette: { surface: "#fafafa", surfaceContainerHighest: "#ddd" } }) },
  "material-motion": { useMaterialMotion: () => ({ expressive, spatial: {}, reducedMotion: false }) },
  "input-surface": { InputSurfaceContext: React.createContext(null) },
  tokens: { radius: { sm: 8 }, spacing: {}, fontSize: { md: 16 } },
};
function load(relativePath, extraExports = "") {
  const source = path.resolve(__dirname, "../src", relativePath);
  const { code } = babel.transformSync(fs.readFileSync(source, "utf8") + extraExports, {
    filename: source, compact: false, configFile: false, babelrc: false,
    presets: [[require.resolve("babel-preset-expo"), {
      disableImportExportTransform: false, worklets: false, reanimated: false,
    }]],
  });
  const exported = {};
  vm.runInNewContext(`(function(require,exports){${code}\n})`, { setTimeout, clearTimeout })(name => {
    if (name.startsWith("@babel/runtime/")) return require(name);
    return stubs[name] ?? stubs[name.split("/").at(-1)] ?? {};
  }, exported);
  return exported;
}
const input = load("components/ui/Input.tsx",
  "\nexport { NativeInputDensity as NativeDensityForTest, DensityContext as DensityForTest };");
const close = (a, b) => assert.ok(Math.abs(a - b) < 1e-8, `${a} != ${b}`);
function Probe() {
  sample = React.useContext(input.DensityForTest);
  return React.createElement(input.ExpandingInputAccessory, null, React.createElement(View));
}
let count = 0;
for (fontScale of [1, 1.5, 2]) for (expressive of [false, true]) for (grouped of [false, true]) {
  for (progress of [0, 0.05, 0.25, 0.5, 0.75, 0.95, 1]) {
    effects = [];
    const html = renderToStaticMarkup(React.createElement(input.InputExpansionContext.Provider,
      { value: grouped ? { value: progress } : null },
      React.createElement(input.NativeDensityForTest, {
        compact: progress < 0.5, invalid: false, paddingRight: 104, compactPaddingRight: 56,
      }, React.createElement(Probe))));
    close(sample.input.paddingRight - 56, sample.accessory.width);
    close(sample.box.minHeight, sample.input.lineHeight * fontScale + sample.input.paddingTop + sample.input.paddingBottom);
    const metrics = input.inputDensityMetrics(fontScale);
    close(sample.container.paddingTop + sample.box.minHeight + sample.container.paddingBottom,
      metrics.compact + metrics.extra * progress);
    assert.ok(sample.accessory.opacity >= 0 && sample.accessory.opacity <= 1);
    if (progress <= 0.6) close(sample.accessory.opacity, 0);
    if (progress === 1) close(sample.accessory.opacity, 1);
    assert.equal(sample.icon.overflow, undefined);
    assert.ok(!html.includes("hidden"), "Accessory glyph must not be sliced by its slot");
    assert.ok(html.includes("&quot;width&quot;:48"), "Keep the actual action at its full size");
    if (!expressive) close(sample.box.borderRadius, 8);
    count++;
  }
}
console.log(`Native field density: ${count} intermediate geometries passed.`);

// Render the actual native group repeatedly while retaining its UI shared
// values. Interrupt each spring at a fractional phase, then retarget focus.
// Previously row position and field extent had independent spring histories.
usePersistentSlots = true;
stubs.Input = input;
const { NativeLayoutForTest } = load("components/bookmarks/BookmarkLinkField.tsx",
  "\nexport { NativeLinkLayout as NativeLayoutForTest };");
const expansions = [];
function FieldProbe({ index }) {
  expansions[index] = React.useContext(input.InputExpansionContext);
  return React.createElement(View);
}
count = 0;
for (fontScale of [1, 1.5, 2]) for (expressive of [false, true]) {
  slots = [];
  const { compact, compactBody, expandedBody, extra } = input.inputDensityMetrics(fontScale);
  for (const activeIndex of [2, 0, 1, 2, 0, 2, 1, 0]) {
    slotIndex = 0;
    effects = [];
    positionWorklets = [];
    renderToStaticMarkup(React.createElement(NativeLayoutForTest, {
      activeIndex,
      fields: [0, 1, 2].map(index => React.createElement(FieldProbe, { key: index, index })),
    }, React.createElement(View)));
    effects.forEach(fn => fn());
    // The group owns one phase; changing it updates every derived row value.
    for (const phase of [0, 0.1, 0.35, 0.7]) {
      slots[3].value = phase;
      const weights = expansions.map(value => value.value);
      close(weights.reduce((sum, value) => sum + value, 0), 1);
      const tops = positionWorklets.slice(0, 3).map(fn => fn().transform[0].translateY);
      for (let index = 1; index < 3; index++) {
        const previous = weights[index - 1];
        const previousBody = compactBody + (expandedBody - compactBody) * previous;
        const previousTopPadding = 8 + (8 * fontScale - 8) * previous;
        const nextTopPadding = 8 + (8 * fontScale - 8) * weights[index];
        const gap = tops[index] + nextTopPadding - (tops[index - 1] + previousTopPadding + previousBody);
        assert.ok(gap >= 8 - 1e-8, `Overlapping fields during interrupted focus: ${gap}dp`);
      }
      close(tops[2] + compact + extra * weights[2], compact * 3 + extra);
      count++;
    }
  }
}
console.log(`Native field handoff: ${count} interrupted group geometries passed.`);
