const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const { resolve } = require("node:path");
const { test } = require("node:test");
const React = require("react");
const { createRoot } = require("react-dom/client");
const { JSDOM } = require("jsdom");
const ts = require("typescript");

test("theme context only broadcasts resolved palette or design-mode changes", async () => {
  const dom = new JSDOM("<!doctype html><div id='root'></div>");
  const previous = { window: globalThis.window, document: globalThis.document, act: globalThis.IS_REACT_ACT_ENVIRONMENT };
  globalThis.window = dom.window;
  globalThis.document = dom.window.document;
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  const state = { themeMode: "dark", amoled: false, expressive: true, materialYouColors: false, themeContrast: 0,
    systemScheme: "dark", deviceColors: { revision: 0 } };
  const paletteCache = new Map();
  let appearanceResets = 0, shadowBuilds = 0;
  const mocks = {
    react: React,
    "react/jsx-runtime": require("react/jsx-runtime"),
    "react-native": {
      Appearance: { setColorScheme: () => { appearanceResets++; } }, Platform: { OS: "web" },
      View: ({ children }) => React.createElement("div", null, children),
      useColorScheme: () => state.systemScheme,
    },
    "expo-status-bar": { StatusBar: () => null },
    "../store/settings": { useSettingsStore: selector => selector(state) },
    "./theme": {
      resolvePalette(mode, amoled, system, _seed, _expressive, contrast, device) {
        const resolved = mode === "system" ? system : mode;
        const key = `${resolved}:${amoled}:${contrast}:${JSON.stringify(device)}`;
        if (!paletteCache.has(key)) paletteCache.set(key, { mode: resolved, background: resolved === "dark" ? "#000000" : "#ffffff" });
        return paletteCache.get(key);
      },
      resolveShadows: () => { shadowBuilds++; return {}; },
    },
    "./device-colors": { useDeviceColors: () => state.deviceColors },
    "./pin-system-chrome": { pinWindowBackground: async () => {} },
    "./scrollbar": { scrollbarColors: () => ({ thumb: "#111111", track: "#222222" }), WEB_SCROLLBAR_CSS: "" },
    "./material-colors": { MATERIAL_ROLES: [] },
  };
  const filename = process.env.ORDO_THEME_PROVIDER_SOURCE ?? resolve(__dirname, "../src/theme/ThemeProvider.tsx");
  const { outputText } = ts.transpileModule(readFileSync(filename, "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true },
  });
  const mod = { exports: {} };
  new Function("require", "module", "exports", outputText)(name => {
    assert.ok(name in mocks, `Unexpected dependency: ${name}`);
    return mocks[name];
  }, mod, mod.exports);
  const { ThemeProvider, useTheme } = mod.exports;
  let renders = 0;
  let lastTheme;
  function Consumer() { renders++; lastTheme = useTheme(); return React.createElement("span", null, lastTheme.palette.mode); }
  const children = Array.from({ length: 64 }, (_, key) => React.createElement(Consumer, { key }));
  const root = createRoot(dom.window.document.getElementById("root"));
  const render = () => React.act(() => root.render(React.createElement(ThemeProvider, null, children)));
  try {
    await render();
    const initial = lastTheme;
    assert.equal(renders, 64);
    state.systemScheme = "light";
    await render();
    state.deviceColors = { revision: 1 };
    await render();
    state.systemScheme = "dark";
    await render();
    state.themeMode = "system";
    await render();
    assert.equal(renders, 64, "equivalent resolved schemes must not wake 64 consumers on four irrelevant updates");
    assert.equal(lastTheme, initial);
    assert.equal(shadowBuilds, 1);
    assert.equal(appearanceResets, 1, "actual OS appearance stays unforced");
    state.systemScheme = "light";
    await render();
    assert.equal(renders, 128);
    assert.equal(lastTheme.palette.mode, "light");
    state.expressive = false;
    await render();
    assert.equal(renders, 192);
    assert.equal(lastTheme.expressive, false);
    state.materialYouColors = true;
    await render();
    assert.equal(renders, 256, "enabling actual device colors still broadcasts");
    state.deviceColors = { revision: 2 };
    await render();
    assert.equal(renders, 320, "wallpaper changes broadcast while Material You is enabled");
  } finally {
    await React.act(() => root.unmount());
    dom.window.close();
    globalThis.window = previous.window;
    globalThis.document = previous.document;
    globalThis.IS_REACT_ACT_ENVIRONMENT = previous.act;
  }
});
