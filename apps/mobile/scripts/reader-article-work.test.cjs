/** Run: node --test apps/mobile/scripts/reader-article-work.test.cjs
 * Actual-source regression tests for reader article work: the real
 * ArticleHtml/article-highlight-ui/article-sections sources run with the real
 * React, the real @native-html/render engine and a stubbed react-native.
 *
 * Guards the split between engine-baked typography and render-time ink:
 *  - palette-only updates (reader theme, AMOLED, system scheme) must re-parse
 *    zero sections and must still restyle every tag's ink and surfaces;
 *  - typography changes (size, family) re-parse each section exactly once;
 *  - content edits re-parse only the sections whose HTML changed;
 *  - preference objects with unchanged values re-parse nothing.
 */
const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const { resolve, dirname } = require("node:path");
const { test } = require("node:test");
const ts = require("../../../node_modules/typescript");
const React = require("../../../node_modules/react");
const { createRoot } = require("../../../node_modules/react-dom/client");
const { JSDOM } = require("../../../node_modules/jsdom");

const sourceRoot = process.env.ORDO_CONTROL_SOURCE_ROOT ?? resolve(__dirname, "../src");
const dom = new JSDOM("<!doctype html><html><body><div id=root></div></body></html>", { pretendToBeVisual: true });
globalThis.window = dom.window;
globalThis.document = dom.window.document;
globalThis.navigator = dom.window.navigator;
globalThis.requestAnimationFrame = (cb) => dom.window.requestAnimationFrame(cb);
globalThis.cancelAnimationFrame = (id) => dom.window.cancelAnimationFrame(id);
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

/* ------------------------------ react-native stub ----------------------------- */

const flattenStyle = (style) => {
  if (style == null) return {};
  if (Array.isArray(style)) return Object.assign({}, ...style.map(flattenStyle));
  return style;
};

/** Host components that record their resolved style as an attribute, so tests
 * can assert the ink/surface the article actually applied per tag. */
function host(tag, styleAttr) {
  return React.forwardRef(function HostStub({ style, children, ...rest }, ref) {
    const domProps = { ref };
    for (const [key, value] of Object.entries(rest)) {
      if (key.startsWith("data-") || key.startsWith("aria-") || key === "className" || key === "id" || key === "role") {
        domProps[key] = value;
      }
    }
    domProps[styleAttr] = JSON.stringify(flattenStyle(style));
    return React.createElement(tag, domProps, children);
  });
}

const reactNative = {
  Platform: { OS: "web", select: (options) => options.web ?? options.default },
  Dimensions: { get: () => ({ width: 390, height: 844 }) },
  PixelRatio: { get: () => 2 },
  StyleSheet: { hairlineWidth: 0.5, create: (styles) => styles, flatten: flattenStyle, absoluteFill: {} },
  Text: host("span", "data-textstyle"),
  View: host("div", "data-viewstyle"),
  Image: host("img", "data-viewstyle"),
  Pressable: host("div", "data-viewstyle"),
  ActivityIndicator: () => null,
  Linking: { openURL: () => Promise.resolve() },
  Alert: { alert: () => {} },
  NativeEventEmitter: class { addListener() { return { remove() {} }; } removeListener() {} },
  NativeModules: {},
  I18nManager: { isRTL: false, doLeftAndRightSwapInRTL: true },
  findNodeHandle: () => null,
  useWindowDimensions: () => ({ width: 390, height: 844, fontScale: 1 }),
};

/* --------------------------------- theme stub --------------------------------- */

const palettes = {
  dark: {
    mode: "dark", onSurface: "#dark-onSurface", text: "#dark-text", textSecondary: "#dark-textSecondary",
    textTertiary: "#dark-textTertiary", accent: "#dark-accent", primary: "#dark-primary", border: "#dark-border",
    outlineVariant: "#dark-outlineVariant", surfaceContainerLow: "#dark-surfaceLow",
    surfaceContainerHighest: "#dark-surfaceHighest", tertiaryContainer: "#dark-highlight",
    onTertiaryContainer: "#dark-onHighlight", danger: "#dark-danger", onSurfaceVariant: "#dark-onSurfaceVariant",
  },
  light: {
    mode: "light", onSurface: "#light-onSurface", text: "#light-text", textSecondary: "#light-textSecondary",
    textTertiary: "#light-textTertiary", accent: "#light-accent", primary: "#light-primary", border: "#light-border",
    outlineVariant: "#light-outlineVariant", surfaceContainerLow: "#light-surfaceLow",
    surfaceContainerHighest: "#light-surfaceHighest", tertiaryContainer: "#light-highlight",
    onTertiaryContainer: "#light-onHighlight", danger: "#light-danger", onSurfaceVariant: "#light-onSurfaceVariant",
  },
};
const themeState = { palette: palettes.dark };

const stubs = {
  "react": React,
  "react-dom/client": { createRoot },
  "react-native": reactNative,
  "@bsky.app/react-native-uitextview": { UITextView: reactNative.Text },
  "../../theme/ThemeProvider": {
    useTheme: () => ({ palette: themeState.palette, expressive: false }),
    ThemeOverrideProvider: ({ children }) => children,
  },
  "../../hooks/use-animation-activity": {
    useAnimationActivity: () => true,
    useAnimationActivityEffect: (callback) => React.useEffect(() => callback(true), [callback]),
  },
  "../../hooks/use-scene-ready": { useSceneReady: () => true },
};

/* --------------------------- transpiled source loader -------------------------- */

const modules = new Map();
function resolveLocal(from, name) {
  for (const candidate of [name, `${name}.tsx`, `${name}.ts`, `${name}/index.ts`]) {
    const path = resolve(from, candidate);
    try { readFileSync(path); return path; } catch {}
  }
  throw new Error(`Cannot resolve ${name} from ${from}`);
}
function load(filename) {
  if (modules.has(filename)) return modules.get(filename).exports;
  const module = { exports: {} };
  modules.set(filename, module);
  const source = readFileSync(filename, "utf8");
  const { outputText } = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true },
  });
  const localRequire = (name) => {
    if (stubs[name]) return stubs[name];
    if (name === "react" || name === "react-dom/client") return stubs[name];
    if (name.startsWith(".")) return load(resolveLocal(dirname(filename), name));
    return require(name);
  };
  new Function("require", "module", "exports", outputText)(localRequire, module, module.exports);
  return module.exports;
}

/* --------------------- work counters over the real engine ---------------------- */

// Nested node_modules packages (the render engine, the uitextview shim)
// require("react-native") through Node's own resolver; route those to the
// stub as well so no real react-native source is ever parsed.
const nodeStubs = {
  "react-native": reactNative,
  "@bsky.app/react-native-uitextview": stubs["@bsky.app/react-native-uitextview"],
};
const { Module } = require("module");
const originalResolveFilename = Module._resolveFilename;
Module._resolveFilename = function patchedResolveFilename(request, ...args) {
  if (nodeStubs[request]) return `ordo-stub://${request}`;
  return originalResolveFilename.call(this, request, ...args);
};
for (const [request, exports_] of Object.entries(nodeStubs)) {
  require.cache[`ordo-stub://${request}`] = { id: `ordo-stub://${request}`, filename: `ordo-stub://${request}`, loaded: true, exports: exports_ };
}

const transientEngine = require("../../../node_modules/@native-html/transient-render-engine");
const work = { parses: 0, fromDoc: 0 };
const originalBuildTTree = transientEngine.TRenderEngine.prototype.buildTTree;
transientEngine.TRenderEngine.prototype.buildTTree = function wrappedBuildTTree(html, ...rest) {
  work.parses += 1;
  return originalBuildTTree.call(this, html, ...rest);
};
const originalBuildFromDoc = transientEngine.TRenderEngine.prototype.buildTTreeFromDoc;
transientEngine.TRenderEngine.prototype.buildTTreeFromDoc = function wrappedBuildFromDoc(document) {
  // The per-section translate pass (translate + hoist + collapse) — the work
  // that scales with article length and must not run for palette changes.
  work.parses += 1;
  work.fromDoc += 1;
  return originalBuildFromDoc.call(this, document);
};

const ArticleHtml = load(resolve(sourceRoot, "components/reader/ArticleHtml.tsx")).ArticleHtml;
const { prepareArticleSections } = load(resolve(sourceRoot, "components/reader/article-sections.ts"));

const workScheduler = {
  schedule: (run) => {
    // Deferred like the real idle scheduler: work runs outside the commit.
    const timer = setTimeout(() => run(), 0);
    return () => clearTimeout(timer);
  },
  scrolling() {}, resume() {}, dispose() {},
};
const paragraph = (text) => `<p>${text}</p>`;
const blocks = Array.from({ length: 24 }, (_, i) => `<h2>Section ${i + 1}</h2>${paragraph(`Body ${i + 1} with a <a href="https://example.test/link">link</a>, <strong>bold</strong> and <code>code()</code>.`)}`);
// One of every decorated tag so surface-color coverage is asserted too.
blocks.push(`<blockquote>Quoted passage with its own bar.</blockquote><pre>preformatted text</pre><hr><figure><figcaption>figure caption</figcaption></figure><ul><li>list item</li></ul><table><tr><th>head</th></tr><tr><td>cell</td></tr></table>`);
const articleHtml = blocks.join("");

function preferences(overrides = {}) {
  return { fontFamily: "sans", fontSize: "medium", lineSpacing: "default", theme: "dark", amoled: false, ...overrides };
}

async function flush(root, rounds = 40) {
  // ArticleSections mounts one section per scheduled transition; let each
  // deferred step run its timer, then flush the transition it scheduled.
  for (let index = 0; index < rounds; index++) {
    await new Promise((resolveTimer) => setTimeout(resolveTimer, 1));
    await React.act(async () => {
      root.render(rootElementHolder.current);
    });
  }
}
const rootElementHolder = { current: null };

function mountedStyles(selector, attr) {
  return [...document.querySelectorAll(selector)].map((node) => JSON.parse(node.getAttribute(attr) ?? "{}"));
}

async function mountArticle(props) {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  rootElementHolder.current = React.createElement(ArticleHtml, { workScheduler, contentWidth: 360, ...props });
  await React.act(async () => { root.render(rootElementHolder.current); });
  await flush(root);
  return {
    root,
    container,
    async rerender(props2) {
      rootElementHolder.current = React.createElement(ArticleHtml, { workScheduler, contentWidth: 360, ...props2 });
      await flush(root, 6);
    },
    async unmount() {
      await React.act(async () => { root.unmount(); });
      container.remove();
    },
  };
}

// The exact section count the reader's own splitter produces for the fixture.
const sectionCount = () => prepareArticleSections(articleHtml).sections.length;

test("initial mount parses every section once", async () => {
  work.parses = 0;
  const view = await mountArticle({ html: articleHtml, preferences: preferences() });
  assert.equal(work.parses, sectionCount());
  await view.unmount();
});

test("a palette-only change re-parses zero sections but restyles every tag", async () => {
  work.parses = 0;
  themeState.palette = palettes.dark;
  const view = await mountArticle({ html: articleHtml, preferences: preferences() });
    assert.equal(work.parses, sectionCount());

  const inkOf = (color) => mountedStyles(`[data-textstyle*="${color}"]`, "data-textstyle");
  for (const color of ["#dark-onSurface", "#dark-text", "#dark-accent"]) {
    assert.ok(inkOf(color).length > 0, `dark ink ${color} is applied at mount`);
  }

  work.parses = 0;
  themeState.palette = palettes.light;
  await view.rerender({ html: articleHtml, preferences: preferences() });
  assert.equal(work.parses, 0, "palette-only change must not re-parse any section");

  // Ink moved for every tag class: body, headings, links, code, and block
  // surfaces (quote bar, code/pre fills) all carry the light palette values.
  const textStyles = mountedStyles("span[data-textstyle]", "data-textstyle");
  const viewStyles = mountedStyles("div[data-viewstyle]", "data-viewstyle");
  const hasInk = (styles, key, value) => styles.some((style) => style[key] === value);
  assert.ok(hasInk(textStyles, "color", "#light-onSurface"), "body ink follows the palette");
  assert.ok(hasInk(textStyles, "color", "#light-text"), "heading/strong ink follows the palette");
  assert.ok(hasInk(textStyles, "color", "#light-accent"), "link ink follows the palette");
  assert.ok(hasInk(textStyles, "backgroundColor", "#light-surfaceLow"), "inline code surfaces follow the palette");
  assert.ok(hasInk(viewStyles, "borderLeftColor", "#light-accent"), "quote bar ink follows the palette");
  assert.ok(hasInk(viewStyles, "backgroundColor", "#light-surfaceLow"), "quote/pre surfaces follow the palette");
  for (const stale of ["#dark-onSurface", "#dark-text", "#dark-accent", "#dark-surfaceLow"]) {
    assert.ok(!hasInk(textStyles, "color", stale) && !hasInk(textStyles, "backgroundColor", stale) && !hasInk(viewStyles, "backgroundColor", stale) && !hasInk(viewStyles, "borderLeftColor", stale), `stale dark value ${stale} is gone`);
  }
  await view.unmount();
});

test("changing text size re-parses every section exactly once", async () => {
  themeState.palette = palettes.dark;
  work.parses = 0;
  const view = await mountArticle({ html: articleHtml, preferences: preferences() });
  work.parses = 0;
  await view.rerender({ html: articleHtml, preferences: preferences({ fontSize: "large" }) });
  assert.equal(work.parses, sectionCount(), "a size change re-parses each mounted section once");
  const textStyles = mountedStyles("span[data-textstyle]", "data-textstyle");
  assert.ok(textStyles.some((style) => style.fontSize === 19), "large body size is applied");
  await view.unmount();
});

test("changing typeface re-parses every section exactly once", async () => {
  themeState.palette = palettes.dark;
  work.parses = 0;
  const view = await mountArticle({ html: articleHtml, preferences: preferences() });
  work.parses = 0;
  await view.rerender({ html: articleHtml, preferences: preferences({ fontFamily: "serif" }) });
  assert.equal(work.parses, sectionCount(), "a family change re-parses each mounted section once");
  await view.unmount();
});

test("a preference object with unchanged values re-parses nothing", async () => {
  themeState.palette = palettes.dark;
  work.parses = 0;
  const view = await mountArticle({ html: articleHtml, preferences: preferences() });
  work.parses = 0;
  await view.rerender({ html: articleHtml, preferences: preferences() });
  assert.equal(work.parses, 0, "identity-only changes must not rebuild the engine");
  await view.unmount();
});

test("an html edit re-parses only the changed sections", async () => {
  themeState.palette = palettes.dark;
  work.parses = 0;
  const view = await mountArticle({ html: articleHtml, preferences: preferences() });
  work.parses = 0;
  // Append a paragraph to the final block: the trailing section absorbs it
  // (its HTML moves) while every earlier section keeps its DOM identity, so
  // exactly one section re-translates.
  const editedHtml = `${articleHtml}<p>One more paragraph at the end.</p>`;
  assert.ok(prepareArticleSections(editedHtml).sections.length >= sectionCount(), "an append never shrinks the section list");
  await view.rerender({ html: editedHtml, preferences: preferences() });
  assert.equal(work.parses, 1, "only the section whose HTML changed re-parses");
  await view.unmount();
});

/* ------------- media blocks: ink and surfaces in default-render paths ------------- */

const mediaHtml = [
  "<h2>Plain heading</h2><p>plain paragraph</p>",
  '<blockquote><p>quoted words</p><img src="https://example.test/i.png" alt="pic"></blockquote>',
  '<p>media paragraph <img src="https://example.test/i.png"> with <strong>bold</strong>, <b>bold2</b>, <code>code()</code>, <a href="https://example.test/x">link</a> and bare text.</p>',
  '<figure><img src="https://example.test/i.png"><figcaption>caption with <strong>bold</strong> and <code>code()</code> plus <img src="https://example.test/i2.png"> inline</figcaption></figure>',
  '<h2>heading with <strong>bold</strong>, <code>code()</code> and <img src="https://example.test/i.png"> inside</h2>',
  '<pre>code block with <img src="https://example.test/i.png"> inline</pre>',
].join("");

function textHosts() {
  return [...document.querySelectorAll("[data-textstyle]")].map((node) => ({
    text: node.textContent ?? "",
    style: JSON.parse(node.getAttribute("data-textstyle") ?? "{}"),
  }));
}
function viewHosts() {
  return [...document.querySelectorAll("[data-viewstyle]")].map((node) => JSON.parse(node.getAttribute("data-viewstyle") ?? "{}"));
}
const hostHas = (hosts, text, key, value) => hosts.some((host) => host.text.includes(text) && host.style[key] === value);

test("media blocks keep blockquote and pre surfaces with per-palette colors", async () => {
  themeState.palette = palettes.dark;
  const view = await mountArticle({ html: mediaHtml, preferences: preferences() });
  const darkViews = viewHosts();
  assert.ok(darkViews.some((style) => style.borderLeftColor === "#dark-accent" && style.backgroundColor === "#dark-surfaceLow"),
    "blockquote with img keeps its accent bar and tonal surface");
  assert.ok(darkViews.some((style) => style.backgroundColor === "#dark-surfaceLow" && !style.borderLeftColor),
    "pre with img keeps its tonal surface");

  work.parses = 0;
  themeState.palette = palettes.light;
  await view.rerender({ html: mediaHtml, preferences: preferences() });
  assert.equal(work.parses, 0, "a palette flip on media markup re-parses nothing");
  const lightViews = viewHosts();
  assert.ok(lightViews.some((style) => style.borderLeftColor === "#light-accent" && style.backgroundColor === "#light-surfaceLow"),
    "the quote bar follows the palette on media blocks");
  assert.ok(lightViews.every((style) => style.borderLeftColor !== "#dark-accent"), "dark quote bar is gone");
  await view.unmount();
});

test("inline tags in media paragraphs and captions keep their declared ink", async () => {
  themeState.palette = palettes.dark;
  const view = await mountArticle({ html: mediaHtml, preferences: preferences() });
  let hosts = textHosts();
  assert.ok(hostHas(hosts, "bold", "color", "#dark-text"), "strong in a media paragraph draws heading ink");
  assert.ok(hostHas(hosts, "bold2", "color", "#dark-text"), "b in a media paragraph draws heading ink");
  assert.ok(hosts.some((host) => host.text.includes("code()") && host.style.color === "#dark-text" && host.style.backgroundColor === "#dark-surfaceLow"),
    "code in a media paragraph draws its ink and tonal surface");
  assert.ok(hostHas(hosts, "link", "color", "#dark-accent"), "links in media paragraphs stay accent");
  assert.ok(hostHas(hosts, "and bare text.", "color", "#dark-onSurface"), "bare text in media paragraphs keeps body ink");
  // Figcaption and heading media branches: tagged content keeps its ink.
  assert.ok(hosts.filter((host) => host.text.includes("code()")).length >= 2, "code appears in caption and heading contexts");
  assert.ok(hosts.some((host) => host.text === "pic" && host.style.color === "#dark-onSurface"),
    "image alt text keeps the ink it would have inherited");

  work.parses = 0;
  themeState.palette = palettes.light;
  await view.rerender({ html: mediaHtml, preferences: preferences() });
  hosts = textHosts();
  assert.ok(hostHas(hosts, "bold", "color", "#light-text"), "strong ink follows the palette in media paths");
  assert.ok(hosts.some((host) => host.text.includes("code()") && host.style.color === "#light-text" && host.style.backgroundColor === "#light-surfaceLow"),
    "code ink and surface follow the palette in media paths");
  assert.ok(hostHas(hosts, "link", "color", "#light-accent"), "link ink follows the palette in media paths");
  assert.ok(hosts.some((host) => host.text === "pic" && host.style.color === "#light-onSurface"), "alt ink follows the palette");
  for (const stale of ["#dark-text", "#dark-accent", "#dark-surfaceLow"]) {
    assert.ok(!hosts.some((host) => host.style.color === stale || host.style.backgroundColor === stale), `stale dark value ${stale} is gone from media text`);
  }
  await view.unmount();
});
