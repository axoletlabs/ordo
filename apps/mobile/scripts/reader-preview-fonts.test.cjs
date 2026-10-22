/** Preview subset loading contract: distinct family registration, preview-only
 * readiness, full-face handoff, failure retry, coalescing, web FontFace
 * registration/batching, web fallback, native unchanged, and asset coverage.
 * Runs against the real theme/fonts.ts with controllable expo-font, Asset and
 * FontFace mocks.
 *   node --test apps/mobile/scripts/reader-preview-fonts.test.cjs */
const assert = require("node:assert/strict");
const { readFileSync, statSync } = require("node:fs");
const { resolve, dirname } = require("node:path");
const { test } = require("node:test");
const ts = require("typescript");

const sourceRoot = process.env.ORDO_CONTROL_SOURCE_ROOT ?? resolve(__dirname, "../src");
const assetsRoot = resolve(__dirname, "../assets/fonts");

let activeHook = null;
const react = {
  useCallback: (callback) => callback,
  useEffect: () => {},
  useRef: (initial) => ({ current: initial }),
  useSyncExternalStore(subscribe, getSnapshot) {
    const instance = activeHook;
    if (!instance) return getSnapshot();
    const index = instance.cursor++;
    let slot = instance.slots[index];
    if (!slot || slot.subscribe !== subscribe) {
      slot?.unsubscribe?.();
      slot = { subscribe, unsubscribe: subscribe(() => instance.rerender()) };
      instance.slots[index] = slot;
    }
    return getSnapshot();
  },
};

/** Minimal hook host for the module's useReaderFontRevision subscription. */
function mountRevision(fonts) {
  const instance = {
    slots: [],
    cursor: 0,
    renders: 0,
    value: undefined,
    render() {
      this.cursor = 0;
      this.renders += 1;
      this.value = fonts.useReaderFontRevision();
    },
    rerender() { this.render(); },
  };
  const previous = activeHook;
  activeHook = instance;
  try { instance.render(); } finally { activeHook = previous; }
  // Test-only access to the production subscribe closure captured by the stub.
  instance.subscribeRevision = (listener) => {
    const slot = instance.slots[0];
    assert.ok(slot?.subscribe, "revision subscription mounted");
    return slot.subscribe(listener);
  };
  return instance;
}

const PREVIEW_FAMILIES = {
  serif: "Libron_400Regular_Preview",
  sans: "NVLegibleNext_400Regular_Preview",
  garamond: "NVGaramond_400Regular_Preview",
  bitter: "NVBitter_400Regular_Preview",
  jost: "NVJost_400Regular_Preview",
};
const FULL_REGULARS = {
  serif: "Libron_400Regular",
  sans: "NVLegibleNext_400Regular",
  garamond: "NVGaramond_400Regular",
  bitter: "NVBitter_400Regular",
  jost: "NVJost_400Regular",
};
const FULL_FACES = {
  serif: ["Libron_400Regular", "Libron_400Regular_Italic", "Libron_700Bold", "Libron_700BoldItalic"],
  sans: ["NVLegibleNext_400Regular", "NVLegibleNext_400Regular_Italic", "NVLegibleNext_700Bold", "NVLegibleNext_700BoldItalic"],
  garamond: ["NVGaramond_400Regular", "NVGaramond_400Regular_Italic", "NVGaramond_700Bold", "NVGaramond_700BoldItalic"],
  bitter: ["NVBitter_400Regular", "NVBitter_400Regular_Italic", "NVBitter_700Bold", "NVBitter_700BoldItalic"],
  jost: ["NVJost_400Regular", "NVJost_400Regular_Italic", "NVJost_700Bold", "NVJost_700BoldItalic"],
};
const PREVIEW_FILES = {
  serif: "Libron-Preview.ttf",
  sans: "NVLegibleNext-Preview.ttf",
  garamond: "NVGaramond-Preview.ttf",
  bitter: "NVBitter-Preview.ttf",
  jost: "NVJost-Preview.ttf",
};
const FULL_FILES = {
  serif: "Libron-Regular.ttf",
  sans: "NVLegibleNext-Regular.ttf",
  garamond: "NVGaramond-Regular.ttf",
  bitter: "NVBitter-Regular.ttf",
  jost: "NVJost-Regular.ttf",
};
const LABELS = { serif: "Libron", sans: "Legible Sans", garamond: "Garamond", bitter: "Bitter", jost: "Jost" };

const tick = () => new Promise((resolveTick) => setImmediate(resolveTick));

/** Installs a minimal DOM FontFace environment and returns controls. */
function installWebFontEnvironment({ fontFace = true, raf = false } = {}) {
  const previous = {
    window: globalThis.window,
    document: globalThis.document,
    FontFace: globalThis.FontFace,
    requestAnimationFrame: globalThis.requestAnimationFrame,
    cancelAnimationFrame: globalThis.cancelAnimationFrame,
  };
  const faces = [];
  const added = [];
  const frames = [];
  const headAppends = { count: 0 };
  class FakeFontFace {
    constructor(family, source, descriptors) {
      this.family = family;
      this.source = source;
      this.display = descriptors?.display;
      this.status = "unloaded";
      this.loadCalls = 0;
      this._resolve = null;
      this._reject = null;
      faces.push(this);
    }
    load() {
      this.loadCalls += 1;
      this.status = "loading";
      return new Promise((resolveLoad, rejectLoad) => {
        this._resolve = () => { this.status = "loaded"; resolveLoad(this); };
        this._reject = (error) => { this.status = "error"; rejectLoad(error); };
      });
    }
  }
  const fontSet = {
    add(face) { added.push(face); return this; },
    delete(face) { void face; return this; },
    has(face) { return added.includes(face); },
  };
  const documentStub = {
    fonts: fontFace ? fontSet : undefined,
    head: { appendChild() { headAppends.count += 1; } },
    createElement() { throw new Error("unexpected stylesheet creation"); },
  };
  globalThis.window = {};
  globalThis.document = documentStub;
  if (fontFace) globalThis.FontFace = FakeFontFace;
  else delete globalThis.FontFace;
  if (raf) {
    globalThis.requestAnimationFrame = (callback) => {
      frames.push(callback);
      return frames.length;
    };
    globalThis.cancelAnimationFrame = () => {};
  } else {
    delete globalThis.requestAnimationFrame;
    delete globalThis.cancelAnimationFrame;
  }
  return {
    faces,
    added,
    frames,
    headAppends,
    async flushFrame() {
      const callbacks = frames.splice(0);
      for (const callback of callbacks) callback(0);
      await tick();
      await tick();
    },
    async resolveFace(index) {
      assert.ok(faces[index], `face ${index} exists`);
      faces[index]._resolve();
      await tick();
      await tick();
    },
    async rejectFace(index, error = new Error("font face failed")) {
      assert.ok(faces[index], `face ${index} exists`);
      faces[index]._reject(error);
      await tick();
      await tick();
    },
    restore() {
      if (previous.window === undefined) delete globalThis.window;
      else globalThis.window = previous.window;
      if (previous.document === undefined) delete globalThis.document;
      else globalThis.document = previous.document;
      if (previous.FontFace === undefined) delete globalThis.FontFace;
      else globalThis.FontFace = previous.FontFace;
      if (previous.requestAnimationFrame === undefined) delete globalThis.requestAnimationFrame;
      else globalThis.requestAnimationFrame = previous.requestAnimationFrame;
      if (previous.cancelAnimationFrame === undefined) delete globalThis.cancelAnimationFrame;
      else globalThis.cancelAnimationFrame = previous.cancelAnimationFrame;
    },
  };
}

/** Fresh copy of theme/fonts.ts with controllable expo-font/Asset/Platform. */
function loadFonts({ platform = "native", web = null, assetUri } = {}) {
  const calls = [];
  const pending = [];
  const platformState = { OS: platform };
  const webState = web ? installWebFontEnvironment(web === true ? {} : web) : null;
  const uriFor = assetUri === undefined
    ? (assetModule) => `https://assets.test/${encodeURIComponent(String(assetModule))}`
    : () => assetUri;
  const fontModule = {
    loadAsync(faces) {
      const keys = Object.keys(faces);
      calls.push({ keys });
      let resolveLoad;
      let rejectLoad;
      const promise = new Promise((resolvePromise, rejectPromise) => {
        resolveLoad = resolvePromise;
        rejectLoad = rejectPromise;
      });
      pending.push({ resolve: resolveLoad, reject: rejectLoad });
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
      if (name === "react-native") return { Platform: platformState };
      if (name === "expo-asset") {
        return {
          Asset: {
            fromModule: (assetModule) => ({
              uri: uriFor(assetModule),
              localUri: null,
            }),
          },
        };
      }
      if (name.startsWith("@expo-google-fonts/")) {
        const [, library, face] = name.split("/");
        const family = library === "jetbrains-mono" ? "JetBrainsMono" : "Roboto";
        return { [`${family}_${face}`]: 1 };
      }
      if (name.endsWith(".ttf")) return { default: name.split("/").pop() };
      if (name === "../components/ui/MaterialIcon") {
        return { MaterialIcon: Object.assign(() => null, { font: {} }) };
      }
      if (name.startsWith(".")) return load(resolveLocal(dirname(filename), name));
      return require(name);
    };
    new Function("require", "module", "exports", outputText)(localRequire, module, module.exports);
    return module.exports;
  };
  return {
    fonts: load(resolve(sourceRoot, "theme/fonts.ts")),
    calls,
    platform: platformState,
    web: webState,
    async resolveCall(index) {
      assert.ok(pending[index], `call ${index} is pending`);
      pending[index].resolve();
      await tick();
      await tick();
    },
    async rejectCall(index, error = new Error("font load failed")) {
      assert.ok(pending[index], `call ${index} is pending`);
      pending[index].reject(error);
      await tick();
      await tick();
    },
    restore() { webState?.restore(); },
  };
}

/* ------------------------- minimal TTF cmap reader ------------------------- */

/** Returns the set of Unicode code points with a non-zero glyph. Supports the
 * format 0/4/6/12 subtables our ASCII subsets use. */
function cmapCodePoints(file) {
  const buffer = readFileSync(file);
  const view = new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength);
  const numTables = view.getUint16(4);
  let cmapOffset = 0;
  for (let index = 0; index < numTables; index += 1) {
    const record = 12 + index * 16;
    const tag = String.fromCharCode(view.getUint8(record), view.getUint8(record + 1),
      view.getUint8(record + 2), view.getUint8(record + 3));
    if (tag === "cmap") { cmapOffset = view.getUint32(record + 8); break; }
  }
  assert.ok(cmapOffset > 0, `${file} has a cmap`);
  const codePoints = new Set();
  const add = (codePoint, glyph) => {
    if (glyph !== 0) codePoints.add(codePoint);
  };
  const count = view.getUint16(cmapOffset + 2);
  for (let index = 0; index < count; index += 1) {
    const subtable = cmapOffset + view.getUint32(cmapOffset + 4 + index * 8 + 4);
    const format = view.getUint16(subtable);
    if (format === 0) {
      for (let codePoint = 0; codePoint < 256; codePoint += 1) {
        add(codePoint, view.getUint8(subtable + 6 + codePoint));
      }
    } else if (format === 6) {
      const first = view.getUint16(subtable + 6);
      const entries = view.getUint16(subtable + 8);
      for (let i = 0; i < entries; i += 1) add(first + i, view.getUint16(subtable + 10 + i * 2));
    } else if (format === 4) {
      const segCount = view.getUint16(subtable + 6) / 2;
      const endCodes = subtable + 14;
      const startCodes = endCodes + segCount * 2 + 2;
      const deltas = startCodes + segCount * 2;
      const rangeOffsets = deltas + segCount * 2;
      for (let segment = 0; segment < segCount; segment += 1) {
        const end = view.getUint16(endCodes + segment * 2);
        const start = view.getUint16(startCodes + segment * 2);
        const delta = view.getInt16(deltas + segment * 2);
        const rangeOffset = view.getUint16(rangeOffsets + segment * 2);
        for (let codePoint = start; codePoint <= end && codePoint !== 0xffff; codePoint += 1) {
          let glyph;
          if (rangeOffset === 0) {
            glyph = (codePoint + delta) & 0xffff;
          } else {
            const address = rangeOffsets + segment * 2 + rangeOffset + (codePoint - start) * 2;
            glyph = view.getUint16(address);
            if (glyph !== 0) glyph = (glyph + delta) & 0xffff;
          }
          add(codePoint, glyph);
        }
      }
    } else if (format === 12) {
      const groups = view.getUint32(subtable + 12);
      for (let group = 0; group < groups; group += 1) {
        const entry = subtable + 16 + group * 12;
        const start = view.getUint32(entry);
        const end = view.getUint32(entry + 4);
        const startGlyph = view.getUint32(entry + 8);
        for (let codePoint = start; codePoint <= end; codePoint += 1) {
          add(codePoint, startGlyph + codePoint - start);
        }
      }
    }
  }
  return codePoints;
}

/* ---------------------------------- tests ---------------------------------- */

test("native preview subsets use distinct families and never mark the article ready", async () => {
  const context = loadFonts();
  for (const family of Object.keys(PREVIEW_FAMILIES)) {
    void context.fonts.loadReaderFontPreview(family);
  }
  assert.deepEqual(context.calls.map((call) => call.keys),
    Object.values(PREVIEW_FAMILIES).map((key) => [key]),
    "each preview registers exactly its own subset family through Expo");
  for (const family of Object.keys(PREVIEW_FAMILIES)) {
    assert.equal(context.fonts.readerFontsReady(family), false);
    assert.equal(context.fonts.readerFontPreviewReady(family), false);
    assert.equal(context.fonts.resolveReaderFontPreview(family), undefined);
  }
  for (let index = 0; index < context.calls.length; index += 1) await context.resolveCall(index);
  for (const [family, key] of Object.entries(PREVIEW_FAMILIES)) {
    assert.equal(context.fonts.readerFontPreviewReady(family), true);
    assert.equal(context.fonts.readerFontsReady(family), false, "a preview must not satisfy full readiness");
    assert.equal(context.fonts.resolveReaderFontPreview(family), key);
  }
});

test("native preview first then full switches to the full regular face", async () => {
  const context = loadFonts();
  const preview = context.fonts.loadReaderFontPreview("serif");
  await context.resolveCall(0);
  assert.equal(context.fonts.resolveReaderFontPreview("serif"), "Libron_400Regular_Preview");

  const full = context.fonts.loadReaderFonts("serif");
  assert.deepEqual(context.calls[1].keys, FULL_FACES.serif);
  await context.resolveCall(1);
  await preview;
  await full;
  assert.equal(context.fonts.readerFontsReady("serif"), true);
  assert.equal(context.fonts.readerFontPreviewReady("serif"), true, "a full face also counts preview-ready");
  assert.equal(context.fonts.resolveReaderFontPreview("serif"), FULL_REGULARS.serif);
  assert.equal(context.calls.length, 2, "no preview subset is loaded after the full face arrives");
});

test("native full request, in flight or ready, suppresses the preview subset", async () => {
  const context = loadFonts();
  const full = context.fonts.loadReaderFonts("garamond");
  const previewInFlight = context.fonts.loadReaderFontPreview("garamond");
  assert.equal(previewInFlight, full, "the in-flight full request is reused");
  assert.deepEqual(context.calls.map((call) => call.keys), [FULL_FACES.garamond]);
  await context.resolveCall(0);
  await full;
  const previewAfter = context.fonts.loadReaderFontPreview("garamond");
  await previewAfter;
  assert.equal(context.calls.length, 1, "ready full face never loads the subset");
  assert.equal(context.fonts.resolveReaderFontPreview("garamond"), FULL_REGULARS.garamond);
});

test("native failed preview is not marked ready and retries cleanly", async () => {
  const originalWarn = console.warn;
  console.warn = () => {};
  try {
    const context = loadFonts();
    const first = context.fonts.loadReaderFontPreview("jost");
    await context.rejectCall(0);
    await first;
    assert.equal(context.fonts.readerFontPreviewReady("jost"), false);
    assert.equal(context.fonts.readerFontsReady("jost"), false);
    assert.equal(context.fonts.resolveReaderFontPreview("jost"), undefined);

    const retry = context.fonts.loadReaderFontPreview("jost");
    assert.equal(context.calls.length, 2);
    assert.deepEqual(context.calls[1].keys, ["NVJost_400Regular_Preview"]);
    await context.resolveCall(1);
    await retry;
    assert.equal(context.fonts.readerFontPreviewReady("jost"), true);
    assert.equal(context.fonts.resolveReaderFontPreview("jost"), "NVJost_400Regular_Preview");
  } finally {
    console.warn = originalWarn;
  }
});

test("native concurrent previews coalesce and can overlap a full request", async () => {
  const context = loadFonts();
  const first = context.fonts.loadReaderFontPreview("bitter");
  const second = context.fonts.loadReaderFontPreview("bitter");
  assert.equal(first, second);
  assert.deepEqual(context.calls.map((call) => call.keys), [["NVBitter_400Regular_Preview"]]);

  const full = context.fonts.loadReaderFonts("bitter");
  assert.deepEqual(context.calls[1].keys, FULL_FACES.bitter);
  await context.resolveCall(0);
  await first;
  assert.equal(context.fonts.resolveReaderFontPreview("bitter"), "NVBitter_400Regular_Preview");
  await context.resolveCall(1);
  await full;
  assert.equal(context.fonts.readerFontsReady("bitter"), true);
  assert.equal(context.fonts.resolveReaderFontPreview("bitter"), FULL_REGULARS.bitter);
  assert.equal(context.calls.length, 2, "the full load is not duplicated");
});

test("web preview loads a FontFace before readiness and never touches Expo CSS", async () => {
  const context = loadFonts({ platform: "web", web: true });
  try {
    assert.equal(context.platform.OS, "web");
    assert.equal(typeof globalThis.FontFace, "function");
    assert.equal(typeof globalThis.document.fonts.add, "function");
    const task = context.fonts.loadReaderFontPreview("serif");
    assert.equal(context.calls.length, 0, "ExpoFont.loadAsync is not used on modern web");
    assert.equal(context.web.faces.length, 1, "one FontFace is created");
    const face = context.web.faces[0];
    assert.equal(face.family, PREVIEW_FAMILIES.serif);
    assert.match(face.source, /Libron-Preview\.ttf/);
    assert.equal(face.display, "swap");
    assert.equal(face.loadCalls, 1);
    assert.deepEqual(context.web.added, [], "not added before load resolves");
    assert.equal(context.fonts.readerFontPreviewReady("serif"), false);
    assert.equal(context.fonts.resolveReaderFontPreview("serif"), undefined);

    await context.web.resolveFace(0);
    await task;
    assert.deepEqual(context.web.added, [face], "added only after FontFace.load()");
    assert.equal(context.fonts.readerFontPreviewReady("serif"), true);
    assert.equal(context.fonts.readerFontsReady("serif"), false, "a FontFace preview never marks the article ready");
    assert.equal(context.fonts.resolveReaderFontPreview("serif"), PREVIEW_FAMILIES.serif);
    assert.equal(context.web.headAppends.count, 0, "no shared stylesheet insertion");
    assert.equal(context.calls.length, 0, "no Expo CSS fallback");
  } finally {
    context.restore();
  }
});

test("web FontFace failures do not mark ready and retry with a new face", async () => {
  const originalWarn = console.warn;
  console.warn = () => {};
  const context = loadFonts({ platform: "web", web: true });
  try {
    const first = context.fonts.loadReaderFontPreview("jost");
    assert.equal(context.web.faces.length, 1);
    await context.web.rejectFace(0);
    await first;
    assert.equal(context.web.added.length, 0);
    assert.equal(context.fonts.readerFontPreviewReady("jost"), false);
    assert.equal(context.fonts.resolveReaderFontPreview("jost"), undefined);

    const retry = context.fonts.loadReaderFontPreview("jost");
    assert.equal(context.web.faces.length, 2, "retry creates a fresh face");
    assert.equal(context.calls.length, 0, "failure does not fall back to CSS");
    await context.web.resolveFace(1);
    await retry;
    assert.deepEqual(context.web.added, [context.web.faces[1]]);
    assert.equal(context.fonts.readerFontPreviewReady("jost"), true);
    assert.equal(context.fonts.resolveReaderFontPreview("jost"), PREVIEW_FAMILIES.jost);
  } finally {
    context.restore();
    console.warn = originalWarn;
  }
});

test("web previews coalesce and a full request suppresses the face", async () => {
  const context = loadFonts({ platform: "web", web: true });
  try {
    const first = context.fonts.loadReaderFontPreview("bitter");
    const second = context.fonts.loadReaderFontPreview("bitter");
    assert.equal(first, second);
    assert.equal(context.web.faces.length, 1);
    assert.equal(context.web.faces[0].loadCalls, 1);
    await context.web.resolveFace(0);
    await first;

    const full = context.fonts.loadReaderFonts("bitter");
    assert.deepEqual(context.calls[0].keys, FULL_FACES.bitter);
    const previewAfter = context.fonts.loadReaderFontPreview("bitter");
    await previewAfter;
    assert.equal(context.web.faces.length, 1, "full request does not create another face");
    await context.resolveCall(0);
    await full;
    assert.equal(context.fonts.readerFontsReady("bitter"), true);
    assert.equal(context.fonts.resolveReaderFontPreview("bitter"), FULL_REGULARS.bitter);
  } finally {
    context.restore();
  }
});

test("web preview first then full switches from FontFace to the full regular face", async () => {
  const context = loadFonts({ platform: "web", web: true });
  try {
    const preview = context.fonts.loadReaderFontPreview("garamond");
    await context.web.resolveFace(0);
    await preview;
    assert.equal(context.fonts.resolveReaderFontPreview("garamond"), PREVIEW_FAMILIES.garamond);
    assert.equal(context.calls.length, 0);

    const full = context.fonts.loadReaderFonts("garamond");
    assert.deepEqual(context.calls[0].keys, FULL_FACES.garamond);
    await context.resolveCall(0);
    await full;
    assert.equal(context.fonts.readerFontsReady("garamond"), true);
    assert.equal(context.fonts.resolveReaderFontPreview("garamond"), FULL_REGULARS.garamond);
    assert.equal(context.web.faces.length, 1, "no preview face is added after the full family");
  } finally {
    context.restore();
  }
});

test("web preload fetches/coalesces faces without registration or revision", async () => {
  const context = loadFonts({ platform: "web", web: true });
  try {
    const revision = mountRevision(context.fonts);
    const rendersBefore = revision.renders;
    const first = context.fonts.preloadReaderFontPreviews(["serif", "sans"]);
    const second = context.fonts.preloadReaderFontPreviews(["serif", "sans"]);
    assert.equal(context.web.faces.length, 2, "both faces start loading in parallel");
    assert.equal(context.web.faces[0].loadCalls, 1);
    assert.equal(context.web.faces[1].loadCalls, 1);
    assert.deepEqual(context.web.added, [], "preload never adds to document.fonts");
    assert.equal(context.fonts.readerFontPreviewReady("serif"), false);
    assert.equal(context.fonts.resolveReaderFontPreview("serif"), undefined);
    assert.equal(revision.renders, rendersBefore, "preload publishes no revision");

    await context.web.resolveFace(0);
    await context.web.resolveFace(1);
    await first;
    await second;
    assert.deepEqual(context.web.added, [], "resolved preloads still do not register");
    assert.equal(context.fonts.readerFontPreviewReady("serif"), false);
    assert.equal(context.fonts.readerFontPreviewReady("sans"), false);
    assert.equal(revision.renders, rendersBefore, "decode completion publishes no revision");

    const batch = context.fonts.loadReaderFontPreviews(["serif", "sans"]);
    assert.equal(context.web.faces.length, 2, "registration reuses the cached faces");
    assert.equal(context.web.faces[0].loadCalls, 1);
    assert.equal(context.web.faces[1].loadCalls, 1);
    await batch;
    assert.deepEqual(context.web.added, context.web.faces, "registration adds the exact cached faces");
    assert.equal(context.fonts.readerFontPreviewReady("serif"), true);
    assert.equal(context.fonts.readerFontPreviewReady("sans"), true);
    assert.equal(revision.renders, rendersBefore + 1, "registration publishes one batch revision");
  } finally {
    context.restore();
  }
});

test("preload failures stay unregistered and retry with a fresh face", async () => {
  const originalWarn = console.warn;
  console.warn = () => {};
  const context = loadFonts({ platform: "web", web: true });
  try {
    const first = context.fonts.preloadReaderFontPreviews(["serif", "sans"]);
    await context.web.resolveFace(0);
    await context.web.rejectFace(1);
    await first;
    assert.deepEqual(context.web.added, []);
    assert.equal(context.fonts.readerFontPreviewReady("serif"), false);
    assert.equal(context.fonts.readerFontPreviewReady("sans"), false);
    assert.equal(context.web.faces.length, 2);

    const retry = context.fonts.preloadReaderFontPreviews(["sans"]);
    assert.equal(context.web.faces.length, 3, "failed preload retries with a fresh face");
    await context.web.resolveFace(2);
    await retry;
    assert.deepEqual(context.web.added, [], "retry is still preload-only");
    const batch = context.fonts.loadReaderFontPreviews(["serif", "sans"]);
    assert.equal(context.web.faces.length, 3, "registration uses cached serif and retried sans");
    await batch;
    assert.deepEqual(context.web.added.map((face) => face.family), [
      PREVIEW_FAMILIES.serif, PREVIEW_FAMILIES.sans,
    ]);
    assert.equal(context.fonts.readerFontPreviewReady("sans"), true);
  } finally {
    context.restore();
    console.warn = originalWarn;
  }
});

test("preload skips full families and never falls back to Expo while dormant", async () => {
  const context = loadFonts({ platform: "web", web: true });
  try {
    const full = context.fonts.loadReaderFonts("garamond");
    const preload = context.fonts.preloadReaderFontPreviews(["garamond", "jost"]);
    assert.equal(context.web.faces.length, 1, "full-family garamond is skipped");
    assert.equal(context.web.faces[0].family, PREVIEW_FAMILIES.jost);
    assert.equal(context.calls.length, 1, "only the full family used Expo");
    await context.web.resolveFace(0);
    await preload;
    assert.equal(context.fonts.readerFontPreviewReady("jost"), false);
    await context.resolveCall(0);
    await full;
    assert.equal(context.fonts.readerFontsReady("garamond"), true);
  } finally {
    context.restore();
  }

  const oldWeb = loadFonts({ platform: "web", web: { fontFace: false } });
  try {
    const preload = oldWeb.fonts.preloadReaderFontPreviews(["serif", "jost"]);
    assert.equal(oldWeb.calls.length, 0, "dormant preload never invokes Expo");
    assert.equal(oldWeb.web.faces.length, 0);
    await preload;
    assert.equal(oldWeb.fonts.readerFontPreviewReady("serif"), false);
    const registration = oldWeb.fonts.loadReaderFontPreviews(["serif"]);
    assert.equal(oldWeb.calls.length, 1, "visible registration falls back to Expo");
    await oldWeb.resolveCall(0);
    await registration;
    assert.equal(oldWeb.fonts.readerFontPreviewReady("serif"), true);
  } finally {
    oldWeb.restore();
  }
});

test("web batch loads faces in parallel and publishes exactly one revision", async () => {
  const context = loadFonts({ platform: "web", web: { raf: true } });
  try {
    const revision = mountRevision(context.fonts);
    const rendersBefore = revision.renders;
    const task = context.fonts.loadReaderFontPreviews(["serif", "sans"]);
    assert.equal(context.web.faces.length, 2, "both faces load in parallel");
    assert.equal(context.web.faces[0].family, PREVIEW_FAMILIES.serif);
    assert.equal(context.web.faces[1].family, PREVIEW_FAMILIES.sans);
    assert.equal(context.web.faces[0].loadCalls, 1);
    assert.equal(context.web.faces[1].loadCalls, 1);
    assert.deepEqual(context.web.added, [], "nothing is registered before the barrier");
    assert.equal(context.calls.length, 0, "no Expo CSS path");

    await context.web.resolveFace(0);
    assert.deepEqual(context.web.added, [], "one completed face does not register early");
    assert.equal(context.fonts.readerFontPreviewReady("serif"), false);
    assert.equal(context.web.frames.length, 1, "one frame is scheduled for the pending faces");
    await context.web.resolveFace(1);
    assert.deepEqual(context.web.added, [], "the frame has not run yet");
    assert.equal(context.web.frames.length, 1, "another face joins the same frame");
    await context.web.flushFrame();
    await task;

    assert.deepEqual(context.web.added.map((face) => face.family), [
      PREVIEW_FAMILIES.serif, PREVIEW_FAMILIES.sans,
    ], "both faces are added in the same batch continuation");
    assert.equal(context.fonts.readerFontPreviewReady("serif"), true);
    assert.equal(context.fonts.readerFontPreviewReady("sans"), true);
    assert.equal(context.fonts.readerFontsReady("serif"), false);
    assert.equal(revision.value, 1, "one revision for the whole batch");
    assert.equal(revision.renders, rendersBefore + 1, "one Typeface subscription render");
  } finally {
    context.restore();
  }
});

test("web batch partial failure marks successes and leaves the failure retryable", async () => {
  const originalWarn = console.warn;
  console.warn = () => {};
  const context = loadFonts({ platform: "web", web: { raf: true } });
  try {
    const revision = mountRevision(context.fonts);
    const rendersBefore = revision.renders;
    const first = context.fonts.loadReaderFontPreviews(["serif", "sans"]);
    await context.web.resolveFace(0);
    await context.web.rejectFace(1);
    await context.web.flushFrame();
    await first;

    assert.deepEqual(context.web.added.map((face) => face.family), [PREVIEW_FAMILIES.serif]);
    assert.equal(context.fonts.readerFontPreviewReady("serif"), true);
    assert.equal(context.fonts.readerFontPreviewReady("sans"), false);
    assert.equal(context.fonts.resolveReaderFontPreview("sans"), undefined);
    assert.equal(revision.renders, rendersBefore + 1);

    const retry = context.fonts.loadReaderFontPreviews(["sans"]);
    assert.equal(context.web.faces.length, 3, "failed family creates a fresh face on retry");
    assert.equal(context.web.faces[2].family, PREVIEW_FAMILIES.sans);
    await context.web.resolveFace(2);
    await context.web.flushFrame();
    await retry;
    assert.deepEqual(context.web.added.map((face) => face.family), [
      PREVIEW_FAMILIES.serif, PREVIEW_FAMILIES.sans,
    ]);
    assert.equal(context.fonts.readerFontPreviewReady("sans"), true);
    assert.equal(revision.renders, rendersBefore + 2, "the successful retry publishes once");
  } finally {
    context.restore();
    console.warn = originalWarn;
  }
});

test("a throwing revision subscriber cannot strand a registered face", async () => {
  const context = loadFonts({ platform: "web", web: { raf: true } });
  try {
    const revision = mountRevision(context.fonts);
    const registration = context.fonts.loadReaderFontPreview("serif");
    let registrationState = "pending";
    void registration.then(
      () => { registrationState = "resolved"; },
      () => { registrationState = "rejected"; },
    );
    await context.web.resolveFace(0);
    assert.equal(context.web.frames.length, 1, "face registration is queued");

    const listenerError = new Error("revision listener failed");
    const unsubscribe = revision.subscribeRevision(() => { throw listenerError; });
    try {
      const frame = context.web.frames[0];
      assert.equal(typeof frame, "function");
      assert.throws(
        () => frame(0),
        (error) => error === listenerError,
        "the frame flush propagates the subscriber error",
      );
      assert.deepEqual(context.web.added.map((face) => face.family), [PREVIEW_FAMILIES.serif],
        "the face was added before the subscriber was notified");
      assert.equal(context.fonts.readerFontPreviewReady("serif"), true,
        "readiness was published before the subscriber threw");

      await tick();
      await tick();
      assert.equal(registrationState, "resolved",
        "the registration promise still settles instead of being stranded");
      assert.equal(context.fonts.resolveReaderFontPreview("serif"), PREVIEW_FAMILIES.serif);
    } finally {
      unsubscribe();
    }
  } finally {
    context.restore();
  }
});

test("web batch skips a full family and shares an in-flight face with the single API", async () => {
  const context = loadFonts({ platform: "web", web: { raf: true } });
  try {
    const full = context.fonts.loadReaderFonts("garamond");
    const batch = context.fonts.loadReaderFontPreviews(["garamond", "jost"]);
    let batchSettled = false;
    void batch.then(() => { batchSettled = true; });
    assert.equal(context.web.faces.length, 1, "full-family garamond is skipped");
    assert.equal(context.web.faces[0].family, PREVIEW_FAMILIES.jost);

    const single = context.fonts.loadReaderFontPreview("jost");
    assert.equal(context.web.faces.length, 1, "single API shares the batch face");
    await context.web.resolveFace(0);
    await context.web.flushFrame();
    await single;
    assert.deepEqual(context.web.added.map((face) => face.family), [PREVIEW_FAMILIES.jost]);
    assert.equal(batchSettled, false, "the batch promise joins a requested full-family load without blocking ready previews");

    await context.resolveCall(0);
    await full;
    await batch;
    assert.equal(context.fonts.readerFontsReady("garamond"), true);
    assert.equal(context.fonts.resolveReaderFontPreview("garamond"), FULL_REGULARS.garamond);
    assert.equal(context.fonts.readerFontPreviewReady("jost"), true);
    assert.equal(context.fonts.resolveReaderFontPreview("jost"), PREVIEW_FAMILIES.jost);
    assert.equal(context.web.faces.length, 1, "no garamond preview face was created");
    assert.equal(context.calls.length, 1, "only the full family used Expo");
  } finally {
    context.restore();
  }
});

test("a slow face queues in a later frame and never blocks a fast face", async () => {
  const context = loadFonts({ platform: "web", web: { raf: true } });
  try {
    const revision = mountRevision(context.fonts);
    const rendersBefore = revision.renders;
    const batch = context.fonts.loadReaderFontPreviews(["serif", "sans"]);
    await context.web.resolveFace(0);
    assert.equal(context.web.frames.length, 1);
    await context.web.flushFrame();
    assert.deepEqual(context.web.added.map((face) => face.family), [PREVIEW_FAMILIES.serif]);
    assert.equal(context.fonts.readerFontPreviewReady("serif"), true);
    assert.equal(context.fonts.readerFontPreviewReady("sans"), false, "the slow face is still pending");
    assert.equal(revision.renders, rendersBefore + 1, "the fast face publishes in the first frame");

    await context.web.resolveFace(1);
    assert.equal(context.web.frames.length, 1, "the slow face enqueues a later frame");
    await context.web.flushFrame();
    await batch;
    assert.deepEqual(context.web.added.map((face) => face.family), [
      PREVIEW_FAMILIES.serif, PREVIEW_FAMILIES.sans,
    ]);
    assert.equal(context.fonts.readerFontPreviewReady("sans"), true);
    assert.equal(revision.renders, rendersBefore + 2, "the later frame publishes once");
  } finally {
    context.restore();
  }
});

test("batch uses one microtask flush when requestAnimationFrame is unavailable", async () => {
  const context = loadFonts({ platform: "web", web: true });
  try {
    const task = context.fonts.loadReaderFontPreviews(["serif", "sans"]);
    await context.web.resolveFace(0);
    await context.web.resolveFace(1);
    await task;
    assert.deepEqual(context.web.added.map((face) => face.family), [
      PREVIEW_FAMILIES.serif, PREVIEW_FAMILIES.sans,
    ]);
    assert.equal(context.fonts.readerFontPreviewReady("serif"), true);
    assert.equal(context.fonts.readerFontPreviewReady("sans"), true);
  } finally {
    context.restore();
  }
});

test("batch falls back to Expo per family on native", async () => {
  const context = loadFonts({ platform: "native" });
  const task = context.fonts.loadReaderFontPreviews(["serif", "sans"]);
  assert.deepEqual(context.calls.map((call) => call.keys), [
    ["Libron_400Regular_Preview"],
    ["NVLegibleNext_400Regular_Preview"],
  ]);
  await context.resolveCall(0);
  await context.resolveCall(1);
  await task;
  assert.equal(context.fonts.readerFontPreviewReady("serif"), true);
  assert.equal(context.fonts.readerFontPreviewReady("sans"), true);
  assert.equal(context.fonts.readerFontPreviewReady("jost"), false);
});

test("web falls back to Expo when FontFace APIs are unavailable", async () => {
  const context = loadFonts({ platform: "web", web: { fontFace: false } });
  try {
    const task = context.fonts.loadReaderFontPreview("sans");
    assert.deepEqual(context.calls[0].keys, ["NVLegibleNext_400Regular_Preview"]);
    assert.equal(context.web.faces.length, 0);
    await context.resolveCall(0);
    await task;
    assert.equal(context.fonts.readerFontPreviewReady("sans"), true);
    assert.equal(context.fonts.resolveReaderFontPreview("sans"), PREVIEW_FAMILIES.sans);
  } finally {
    context.restore();
  }
});

test("web falls back to Expo when the Expo asset URI is unresolved", async () => {
  const context = loadFonts({ platform: "web", web: true, assetUri: "" });
  try {
    const task = context.fonts.loadReaderFontPreview("jost");
    assert.deepEqual(context.calls[0].keys, ["NVJost_400Regular_Preview"]);
    assert.equal(context.web.faces.length, 0, "no FontFace is created without a URL");
    await context.resolveCall(0);
    await task;
    assert.equal(context.fonts.readerFontPreviewReady("jost"), true);
    assert.equal(context.fonts.resolveReaderFontPreview("jost"), PREVIEW_FAMILIES.jost);
  } finally {
    context.restore();
  }
});

test("native keeps the Expo preview loader", async () => {
  const context = loadFonts({ platform: "native" });
  const task = context.fonts.loadReaderFontPreview("serif");
  assert.deepEqual(context.calls[0].keys, ["Libron_400Regular_Preview"]);
  await context.resolveCall(0);
  await task;
  assert.equal(context.fonts.resolveReaderFontPreview("serif"), PREVIEW_FAMILIES.serif);
  assert.equal(context.fonts.readerFontsReady("serif"), false);
});

test("preview assets exist in assets/fonts, cover their label glyphs, and are much smaller", () => {
  const totalBytes = Object.values(PREVIEW_FILES)
    .reduce((total, file) => total + statSync(resolve(assetsRoot, file)).size, 0);
  assert.ok(totalBytes < 200 * 1024, `all preview subsets stay small (${totalBytes} B)`);
  for (const family of Object.keys(PREVIEW_FILES)) {
    const previewPath = resolve(assetsRoot, PREVIEW_FILES[family]);
    const fullPath = resolve(assetsRoot, FULL_FILES[family]);
    const previewBytes = statSync(previewPath).size;
    const fullBytes = statSync(fullPath).size;
    assert.ok(previewBytes > 1024, `${PREVIEW_FILES[family]} is a real font`);
    assert.ok(previewBytes < 40 * 1024, `${PREVIEW_FILES[family]} stays small (${previewBytes} B)`);
    assert.ok(previewBytes < fullBytes, `${PREVIEW_FILES[family]} is smaller than ${FULL_FILES[family]}`);

    const codePoints = cmapCodePoints(previewPath);
    for (const character of LABELS[family]) {
      assert.ok(codePoints.has(character.codePointAt(0)), `${PREVIEW_FILES[family]} contains "${character}"`);
    }
  }
});
