/** Reader font readiness subscriptions: the article subscribes only to the
 * family it draws, preview families in the controls sheet load in the
 * background, and switching families keeps the previous face until the next
 * one is ready. The real theme/fonts.ts runs against a minimal hooks host and a
 * deferred expo-font mock. Run with:
 *   node --test apps/mobile/scripts/reader-fonts.test.cjs */
const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const { resolve, dirname } = require("node:path");
const { test } = require("node:test");
const ts = require("typescript");
const sourceRoot = process.env.ORDO_CONTROL_SOURCE_ROOT ?? resolve(__dirname, "../src");

const depsEqual = (a, b) => Boolean(a && b && a.length === b.length && a.every((value, index) => Object.is(value, b[index])));

// The real module calls one shared `react` object; hooks dispatch to whichever
// instance is currently rendering, like React's own current dispatcher.
let active = null;

function mountWithHooks(component, initialProps) {
  const slots = [];
  const effects = [];
  let cursor = 0;
  let props = initialProps;
  let rendering = false;
  let needsRender = false;
  const instance = { renders: 0, value: undefined };

  const render = () => {
    rendering = true;
    needsRender = false;
    cursor = 0;
    const previous = active;
    active = instance;
    try {
      instance.renders += 1;
      instance.value = component(props);
    } finally {
      active = previous;
      rendering = false;
    }
    for (const entry of effects.splice(0)) {
      entry.previous?.cleanup?.();
      slots[entry.index] = { ...slots[entry.index], cleanup: entry.fn() };
    }
    if (needsRender) render();
  };

  const rerender = () => {
    needsRender = true;
    if (!rendering) render();
  };

  Object.assign(instance, {
    render,
    setProps(next) { props = next; render(); },
    useRef(initial) {
      const index = cursor++;
      slots[index] ??= { current: initial };
      return slots[index];
    },
    useState(initial) {
      const index = cursor++;
      slots[index] ??= { value: typeof initial === "function" ? initial() : initial };
      const slot = slots[index];
      return [slot.value, (value) => {
        const next = typeof value === "function" ? value(slot.value) : value;
        if (Object.is(next, slot.value)) return;
        slot.value = next;
        rerender();
      }];
    },
    useCallback(callback, deps) {
      const index = cursor++;
      if (!slots[index] || !depsEqual(deps, slots[index].deps)) slots[index] = { deps, value: callback };
      return slots[index].value;
    },
    useEffect(callback, deps) {
      const index = cursor++;
      const previous = slots[index];
      if (previous && depsEqual(deps, previous.deps)) return;
      slots[index] = { ...previous, deps };
      effects.push({ index, fn: callback, previous });
    },
    useSyncExternalStore(subscribe, getSnapshot) {
      const index = cursor++;
      let slot = slots[index];
      if (!slot || slot.subscribe !== subscribe) {
        slot?.unsubscribe?.();
        slot = { subscribe, unsubscribe: subscribe(rerender) };
        slots[index] = slot;
      }
      return getSnapshot();
    },
  });
  return instance;
}

const react = {
  useRef: (...args) => active.useRef(...args),
  useState: (...args) => active.useState(...args),
  useCallback: (...args) => active.useCallback(...args),
  useEffect: (...args) => active.useEffect(...args),
  useSyncExternalStore: (...args) => active.useSyncExternalStore(...args),
};

/** Fresh copy of theme/fonts.ts with a controllable expo-font mock. */
function loadFonts() {
  const loaded = [];
  const pending = [];
  const familyOf = (faces) => {
    const names = Object.keys(faces);
    if (names.some((name) => name.startsWith("Libron"))) return "serif";
    if (names.some((name) => name.startsWith("NVLegibleNext"))) return "sans";
    if (names.some((name) => name.startsWith("NVGaramond"))) return "garamond";
    if (names.some((name) => name.startsWith("NVBitter"))) return "bitter";
    return "jost";
  };
  const fontModule = {
    loadAsync(faces) {
      const family = familyOf(faces);
      loaded.push(family);
      let resolveLoad;
      const promise = new Promise((resolvePromise) => { resolveLoad = resolvePromise; });
      pending.push({ family, resolve: () => resolveLoad() });
      return promise;
    },
  };
  const modules = new Map();
  const resolveLocal = (from, name) => {
    for (const candidate of [name, `${name}.tsx`, `${name}.ts`]) {
      const path = resolve(from, candidate);
      try { readFileSync(path); return path; } catch {}
    }
    throw new Error(`Cannot resolve ${name} from ${from}`);
  };
  const load = (filename) => {
    if (modules.has(filename)) return modules.get(filename).exports;
    const module = { exports: {} };
    modules.set(filename, module);
    const source = readFileSync(filename, "utf8");
    const { outputText } = ts.transpileModule(source, {
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX },
    });
    const localRequire = (name) => {
      if (name === "react") return react;
      if (name === "expo-font") return fontModule;
      if (name === "react-native") return { Platform: { OS: "native" } };
      if (name === "expo-asset") {
        return { Asset: { fromModule: () => ({ uri: "https://assets.test/preview.ttf" }) } };
      }
      if (name.startsWith("@expo-google-fonts/")) {
        const [, library, face] = name.split("/");
        const family = library === "jetbrains-mono" ? "JetBrainsMono" : "Roboto";
        return { [`${family}_${face}`]: "font" };
      }
      if (name.endsWith(".ttf")) return name.split("/").pop().replace(/\.ttf$/, "").replace(/-/g, "_");
      if (name === "../components/ui/MaterialIcon") return { MaterialIcon: Object.assign(() => null, { font: {} }) };
      if (name.startsWith(".")) return load(resolveLocal(dirname(filename), name));
      return require(name);
    };
    new Function("require", "module", "exports", outputText)(localRequire, module, module.exports);
    return module.exports;
  };
  return {
    fonts: load(resolve(sourceRoot, "theme/fonts.ts")),
    loaded,
    mount(component, props) {
      const instance = mountWithHooks(component, props);
      instance.render();
      return instance;
    },
    async resolve(family) {
      const index = pending.findIndex((entry) => entry.family === family);
      assert.notEqual(index, -1, `${family} has a pending load`);
      const [entry] = pending.splice(index, 1);
      entry.resolve();
      // expo-font's promise settles through a catch/then chain before markReady.
      await new Promise((resolveTick) => setImmediate(resolveTick));
    },
  };
}

test("a family's load notifies only callers drawing that family", async () => {
  const context = loadFonts();
  const useReaderFontFamily = context.fonts.useReaderFontFamily;
  const sans = context.mount(() => useReaderFontFamily("sans"), {});
  const serif = context.mount(() => useReaderFontFamily("serif"), {});
  assert.equal(sans.value, null);
  assert.equal(serif.value, null);
  assert.deepEqual(context.loaded, ["sans", "serif"]);

  const serifRenders = serif.renders;
  const sansRenders = sans.renders;
  await context.resolve("sans");
  assert.equal(sans.value, "sans");
  assert.equal(sans.renders, sansRenders + 1, "the drawing family re-renders once ready");
  assert.equal(serif.renders, serifRenders, "an unrelated preview family does not re-render this caller");
  assert.equal(serif.value, null);

  await context.resolve("serif");
  assert.equal(serif.value, "serif");
});

test("switching keeps the previous family until the chosen one is ready", async () => {
  const context = loadFonts();
  let family = "sans";
  const view = context.mount(() => context.fonts.useReaderFontFamily(family), {});
  await context.resolve("sans");
  assert.equal(view.value, "sans");

  family = "garamond";
  view.setProps({});
  assert.equal(context.loaded.at(-1), "garamond");
  assert.equal(view.value, "sans", "no fallback face while the next family loads");

  await context.resolve("garamond");
  assert.equal(view.value, "garamond");

  family = "jost";
  view.setProps({});
  assert.equal(view.value, "garamond", "the last drawn family is retained");
  await context.resolve("jost");
  assert.equal(view.value, "jost");
});

test("the controls panel's global revision still follows every family", async () => {
  const context = loadFonts();
  const view = context.mount(() => context.fonts.useReaderFontRevision(), {});
  const before = view.renders;
  void context.fonts.loadReaderFonts("bitter");
  await context.resolve("bitter");
  assert.equal(view.renders, before + 1);
});

test("loadReaderFonts coalesces concurrent requests per family", async () => {
  const context = loadFonts();
  const first = context.fonts.loadReaderFonts("jost");
  const second = context.fonts.loadReaderFonts("jost");
  assert.equal(first, second);
  assert.deepEqual(context.loaded, ["jost"]);
  await context.resolve("jost");
  await first;
  assert.equal(context.fonts.readerFontsReady("jost"), true);
});

test("a preview face never satisfies the article's full-family readiness", async () => {
  const context = loadFonts();
  // Preview loading is a separate, lighter request; it must not declare bold
  // and italic faces ready for article text.
  void context.fonts.loadReaderFontPreview("bitter");
  assert.deepEqual(context.loaded, ["bitter"]);
  await context.resolve("bitter");
  assert.equal(context.fonts.readerFontPreviewReady("bitter"), true);
  assert.equal(context.fonts.readerFontsReady("bitter"), false);

  // The article hook then requests the full family and draws only once it lands.
  const view = context.mount(() => context.fonts.useReaderFontFamily("bitter"), {});
  assert.equal(view.value, null);
  assert.deepEqual(context.loaded, ["bitter", "bitter"]);
  await context.resolve("bitter");
  assert.equal(view.value, "bitter");
  assert.equal(context.fonts.readerFontsReady("bitter"), true);
});

test("a preview arrival does not re-render a hook drawing another family", async () => {
  const context = loadFonts();
  const view = context.mount(() => context.fonts.useReaderFontFamily("sans"), {});
  const renders = view.renders;
  void context.fonts.loadReaderFontPreview("jost");
  assert.deepEqual(context.loaded, ["sans", "jost"]);
  await context.resolve("jost");
  assert.equal(view.renders, renders);
  assert.equal(view.value, null);
});

test("reader settings defers all preview families off the open path", () => {
  const sheet = readFileSync(resolve(sourceRoot, "components/reader/ReaderControlsSheet.tsx"), "utf8");
  assert.doesNotMatch(sheet, /READER_FONT_FAMILY_LIST\.forEach\(\(family\) => void loadReaderFont/,
    "opening the panel must not start every preview family synchronously");
  assert.match(sheet, /loadReaderFontPreview\(family\)/, "native previews load only their regular face");
  assert.match(sheet, /Platform\.OS === "web"/, "web selects the batch path");
  assert.match(sheet, /preloadReaderFontPreviews\(families\)/, "dormant web work prefetches without registering");
  assert.match(sheet, /loadReaderFontPreviews\(families\)/, "web registers previews as one batch");
  assert.match(sheet, /workScheduler\.schedule\(/, "preview work yields to the reader's idle scheduler");
  assert.match(sheet, /index \* PREVIEW_STAGGER_MS/, "preview loads stagger instead of serializing");
  assert.doesNotMatch(sheet, /PREVIEW_DELAY_MS/, "previews use no fixed post-open wait");
  assert.doesNotMatch(sheet, /loadReaderFontPreview\(family\)\.then/, "one slow font must not serialize the rest");
});
