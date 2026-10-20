/** Run: node --test apps/mobile/scripts/bookmark-row-geometry.test.cjs
 *
 * Bookmark-row geometry regression tests. These do not match source strings;
 * they load the real transpiled BookmarkRow/TagChip/Text sources, render them
 * (React SSR + a recording react-native stub), and measure the result with a
 * deterministic flex layout engine for the row's style subset (stacked
 * columns/rows, margins, paddings, minHeight/height, alignSelf, gaps).
 *
 * Regression this guards: inline tag chips were given real 48dp layout boxes
 * (commit aae8402) which stretched every tagged row to a fixed 120dp while the
 * painted chip (24dp) floated centered inside its invisible target — ~16dp of
 * dead space between the domain line and the chip and ~25dp below the chip.
 *
 * Report mode (no tests, prints JSON): node scripts/bookmark-row-geometry.test.cjs --report
 */
const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const { resolve, dirname } = require("node:path");
const ts = require("../../../node_modules/typescript");
const React = require("../../../node_modules/react");
const { renderToStaticMarkup } = require("../../../node_modules/react-dom/server");

const SRC = resolve(__dirname, "../src");

/* ----------------------------- style helpers ----------------------------- */

function flattenStyle(style) {
  if (style == null || style === false) return {};
  if (Array.isArray(style)) return Object.assign({}, ...style.map(flattenStyle));
  return style;
}

/* ------------------------- recording react-native ------------------------- */

const recordState = { theme: { palette: {}, expressive: false }, dims: { fontScale: 1, width: 390, height: 844 } };
const RecordContext = React.createContext(null);

function textOf(children) {
  if (children == null || typeof children === "boolean") return "";
  if (typeof children === "string" || typeof children === "number") return String(children);
  if (Array.isArray(children)) return children.map(textOf).join("");
  if (typeof children === "object" && children.props) return textOf(children.props.children);
  return "";
}

function normalizeHitSlop(hitSlop) {
  if (hitSlop == null) return undefined;
  if (typeof hitSlop === "object") return hitSlop;
  return { top: hitSlop, bottom: hitSlop, left: hitSlop, right: hitSlop };
}

/** Host stub: records style/props into a context-shaped tree during SSR. */
function hostComponent(kind) {
  function Host(props) {
    const {
      children, style, hitSlop, testID, accessibilityLabel, numberOfLines, accessibilityRole,
      pointerEvents, collapsable, importantForAccessibility, accessible, ..._rest
    } = props;
    const parent = React.useContext(RecordContext);
    const node = {
      kind, flat: flattenStyle(style), hitSlop: normalizeHitSlop(hitSlop), testID,
      accessibilityLabel, numberOfLines, text: textOf(children), children: [],
    };
    if (parent) parent.children.push(node);
    else if (!recordState.root) recordState.root = node;
    const rendered = typeof children === "function" ? children({ pressed: false, hovered: false }) : children;
    return React.createElement(RecordContext.Provider, { value: node }, rendered ?? null);
  }
  Host.displayName = `Host(${kind})`;
  return Host;
}

const StubView = hostComponent("View");
const StubText = hostComponent("Text");

function useThemeStub() {
  return recordState.theme;
}

/** PressableScale contract stub: records the real target box + hitSlop and the
 * painted visualStyle box separately, then renders the painted box. */
function PressableScaleStub({ style, visualStyle, hitSlop, children, accessibilityLabel, ..._rest }) {
  const parent = React.useContext(RecordContext);
  const node = {
    kind: "ChipTarget", flat: flattenStyle(style), visual: visualStyle ? flattenStyle(visualStyle) : null,
    hitSlop: normalizeHitSlop(hitSlop), accessibilityLabel, text: "", children: [],
  };
  if (parent) parent.children.push(node);
  else if (!recordState.root) recordState.root = node;
  const rendered = typeof children === "function" ? children({ pressed: false }) : children;
  const painted = visualStyle ?? style;
  return React.createElement(RecordContext.Provider, { value: node },
    React.createElement(StubView, { style: painted }, rendered));
}

function ListPressableStub({ style, children, accessibilityLabel, ..._rest }) {
  const parent = React.useContext(RecordContext);
  const node = { kind: "Pressable", flat: flattenStyle(style), accessibilityLabel, text: "", children: [] };
  if (parent) parent.children.push(node);
  else if (!recordState.root) recordState.root = node;
  const rendered = typeof children === "function" ? children({ pressed: false, hovered: false }) : children;
  return React.createElement(RecordContext.Provider, { value: node }, rendered ?? null);
}

function passthroughComponent(name) {
  function Passthrough({ children }) {
    return children ?? null;
  }
  Passthrough.displayName = `Passthrough(${name})`;
  return Passthrough;
}

const reactNativeStub = {
  Platform: { OS: "web", select: (options) => options.web ?? options.default },
  useWindowDimensions: () => recordState.dims,
  View: StubView,
  Text: StubText,
  Pressable: ListPressableStub,
  StyleSheet: {
    create: (styles) => styles,
    flatten: flattenStyle,
    hairlineWidth: 1,
    absoluteFillObject: { position: "absolute", top: 0, left: 0, right: 0, bottom: 0 },
  },
};

/* ------------------------------- module map ------------------------------- */

const stubByPath = new Map([
  ["components/ui/PressableScale", { PressableScale: PressableScaleStub }],
  ["components/ui/ListPressable", { ListPressable: ListPressableStub }],
  ["components/ui/MaterialIcon", {
    MaterialIcon: function MaterialIconStub({ size = 24 }) {
      return React.createElement(StubView, { style: { width: size, height: size } });
    },
  }],
  ["components/ui/Spinner", { Spinner: passthroughComponent("Spinner") }],
  ["components/bookmarks/RowHighlight", { RowHighlight: passthroughComponent("RowHighlight") }],
  ["components/bookmarks/SelectionMark", { SelectionMark: passthroughComponent("SelectionMark") }],
  ["components/bookmarks/SelectionDrag", {
    SelectionDragHandle: passthroughComponent("SelectionDragHandle"),
    useSelectionDragRow: () => ({ bind() {}, consumePress: () => false }),
  }],
  ["theme/ThemeProvider", { useTheme: useThemeStub, ThemeOverrideProvider: passthroughComponent("ThemeOverrideProvider") }],
  ["hooks/use-app-router", { useAppRouter: () => ({ push: () => true }) }],
  ["hooks/use-bookmarks", { prefetchBookmarkDetail() {} }],
  ["hooks/use-tags", { prefetchTaggedBookmarks() {} }],
  ["hooks/use-selection", {
    bookmarkKey: (id) => `bookmark:${id}`,
    SELECTION_LONG_PRESS_MS: 450,
    useSelectionHoldGuard: () => ({ pressIn() {}, pressOut() {}, consumePress: () => false, reset() {}, markEnter() {} }),
  }],
  ["hooks/use-menu-highlight", { useMenuHighlightStore: (selector) => selector({ key: null }) }],
  ["hooks/selection-state-context", { useRowSelection: () => ({ selected: false, selectionMode: false }) }],
  ["lib/open-website", { openBookmarkInExternalBrowser() {} }],
  ["lib/haptics", { haptics: { light() {} } }],
  ["lib/press-action", { runPressAction: (fn) => fn() }],
  ["lib/menu-anchor", { measureAnchor: (_view, cb) => cb({ x: 0, y: 0, width: 1, height: 1 }) }],
  ["lib/row-hover", { rowOwnsHover: () => true }],
  ["lib/pointer-hover", { nativeHoverEvents: () => ({}) }],
]);

const moduleCache = new Map();

function sourceCandidates(base) {
  return [base, `${base}.tsx`, `${base}.ts`];
}

function stubFor(resolved) {
  for (const [key, stub] of stubByPath) {
    const absolute = resolve(SRC, key);
    for (const candidate of sourceCandidates(absolute)) {
      if (resolved === candidate || resolved === candidate.replace(/\.(tsx|ts)$/, "")) return stub;
    }
  }
  return undefined;
}

function loadSourceFile(file) {
  const cached = moduleCache.get(file);
  if (cached) return cached.exports;
  const code = readFileSync(file, "utf8");
  const { outputText } = ts.transpileModule(code, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true },
    fileName: file,
  });
  const module = { exports: {} };
  moduleCache.set(file, module);
  const requireModule = (name) => requireWithStubs(name, dirname(file));
  new Function("require", "module", "exports", outputText)(requireModule, module, module.exports);
  return module.exports;
}

function requireWithStubs(name, fromDir) {
  if (name === "react") return React;
  if (name === "react-native") return reactNativeStub;
  if (name === "react-dom") return { server: { renderToStaticMarkup } };
  if (name === "expo-image") return { Image: passthroughComponent("Image") };
  if (name === "@expo/vector-icons") return { Ionicons: passthroughComponent("Ionicons") };
  if (name.startsWith("@ordo")) return require(resolve(__dirname, "../node_modules", name));
  if (name.startsWith(".")) {
    const resolved = resolve(fromDir, name);
    const stub = stubFor(resolved);
    if (stub) return stub;
    for (const candidate of sourceCandidates(resolved)) {
      try {
        readFileSync(candidate);
        return loadSourceFile(candidate);
      } catch {
        /* try next */
      }
    }
    throw new Error(`cannot load source module ${name} from ${fromDir}`);
  }
  return require(name);
}

const BookmarkRowModule = loadSourceFile(resolve(SRC, "components/bookmarks/BookmarkRow.tsx"));
const BookmarkRow = BookmarkRowModule.BookmarkRow ?? BookmarkRowModule.default;
const layoutLib = loadSourceFile(resolve(SRC, "lib/bookmark-row-layout.ts"));

/* ------------------------------- layout engine ------------------------------- */

function num(flat, ...keys) {
  for (const key of keys) {
    const value = flat?.[key];
    if (typeof value === "number") return value;
  }
  return 0;
}

function isAbsolute(node) {
  return node.flat?.position === "absolute";
}

function inFlowChildren(node) {
  return node.children.filter((child) => !isAbsolute(child));
}

function textHeight(node) {
  const { flat } = node;
  if (typeof flat.lineHeight === "number") return flat.lineHeight;
  if (typeof flat.fontSize === "number") return Math.ceil(flat.fontSize * 1.4);
  return 16;
}

/** Pass 1 (bottom-up): intrinsic + clamped heights. */
function measureHeights(node) {
  const flat = node.flat ?? {};
  if (node.kind === "Text") {
    node.measured = textHeight(node);
    return node.measured;
  }
  if (node.kind === "ChipTarget") {
    const boxMin = num(flat, "minHeight");
    const visualMin = node.visual ? num(node.visual, "minHeight") : 0;
    node.boxHeight = Math.max(boxMin, 0);
    node.visualHeight = node.visual ? Math.max(visualMin, 0) : null;
    node.measured = Math.max(node.boxHeight, node.visualHeight ?? 0);
    // Chip height is container-driven; still measure subtree heights so
    // placement arithmetic below has real numbers to center against.
    for (const child of node.children) measureHeights(child);
    return node.measured;
  }
  const padTop = num(flat, "paddingTop", "paddingVertical", "padding");
  const padBottom = num(flat, "paddingBottom", "paddingVertical", "padding");
  const children = inFlowChildren(node);
  for (const child of children) measureHeights(child);
  const direction = flat.flexDirection ?? "column";
  const gap = num(flat, direction === "column" ? "rowGap" : "columnGap", "gap");
  const outer = (child) => child.measured + num(child.flat, "marginTop") + num(child.flat, "marginBottom");
  // Yoga semantics: a row's intrinsic (sizing) height is the max over ALL
  // children — stretch children are laid out at the parent's final height
  // but still size it intrinsically when it is unset.
  const stacked = direction === "column"
    ? children.reduce((sum, child) => sum + outer(child), 0) + (children.length ? gap * (children.length - 1) : 0)
    : children.reduce((max, child) => Math.max(max, outer(child)), 0);
  node.intrinsicHeight = stacked + padTop + padBottom;
  const minHeight = num(flat, "minHeight");
  const byHeight = typeof flat.height === "number" ? flat.height : Math.max(stacked, minHeight - padTop - padBottom) + padTop + padBottom;
  node.measured = Math.max(byHeight, minHeight);
  node.padTop = padTop;
  node.contentHeight = node.measured - padTop - num(flat, "paddingBottom", "paddingVertical", "padding");
  return node.measured;
}

/** Pass 2 (top-down): absolute y placement for every in-flow node. */
function placeNode(node, topY) {
  node.y = topY + num(node.flat, "marginTop");
  const flat = node.flat ?? {};
  if (node.kind === "Text") return;
  if (node.kind === "ChipTarget") {
    const inner = node.visual ? node.visual : flat;
    node.painted = {
      offset: node.visualHeight != null && flat.justifyContent === "center"
        ? Math.max(0, (node.measured - node.visualHeight) / 2)
        : 0,
      height: node.visualHeight ?? node.measured,
    };
    node.targetHeight = node.measured + (node.hitSlop?.top ?? 0) + (node.hitSlop?.bottom ?? 0);
    const children = inFlowChildren(node);
    children.forEach((child) => placeNode(child, node.y + num(inner, "paddingTop", "paddingVertical", "padding")));
    return;
  }
  const padTop = node.padTop ?? 0;
  const direction = flat.flexDirection ?? "column";
  const gap = num(flat, direction === "column" ? "rowGap" : "columnGap", "gap");
  const children = inFlowChildren(node);
  if (direction === "column") {
    let y = node.y + padTop;
    children.forEach((child, index) => {
      placeNode(child, y);
      y += num(child.flat, "marginTop") + child.measured + num(child.flat, "marginBottom")
        + (index < children.length - 1 ? gap : 0);
    });
  } else {
    const alignItems = flat.alignItems ?? "stretch";
    children.forEach((child) => {
      const alignSelf = child.flat?.alignSelf ?? alignItems;
      let top = node.y + padTop;
      if (alignSelf === "center") top += Math.max(0, node.contentHeight - child.measured) / 2;
      else if (alignSelf === "flex-end") top += Math.max(0, node.contentHeight - child.measured);
      placeNode(child, top);
    });
  }
}

/* -------------------------------- fixtures -------------------------------- */

function tag(id, name) {
  return { id, name, color: "emerald" };
}

function websiteBookmark(overrides = {}) {
  return {
    id: "b1",
    title: "Linen shirt",
    url: "https://shop.example.com/linen-shirt",
    domain: "shop.example.com",
    description: null,
    tags: [],
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    isRead: false,
    fetchStatus: "ok",
    contentKind: "website",
    remindAt: null,
    readingTimeMinutes: null,
    suggestedTags: [],
    folderId: null,
    ...overrides,
  };
}

/* ------------------------------- measurement ------------------------------- */

function darkPalette() {
  return new Proxy({}, { get: (_target, prop) => `#role-${String(prop)}` });
}

function renderRow(bookmark, { expressive = false, fontScale = 1, omitTagIds } = {}) {
  recordState.root = null;
  recordState.theme = { palette: darkPalette(), expressive };
  recordState.dims = { fontScale, width: 390, height: 844 };
  const element = React.createElement(BookmarkRow, {
    bookmark, onPress: () => {}, onMore: () => {}, omitTagIds,
  });
  renderToStaticMarkup(element);
  const root = recordState.root;
  if (!root) throw new Error("row did not render");
  measureHeights(root);
  placeNode(root, 0);
  return root;
}

function findNode(node, predicate, found = []) {
  if (predicate(node)) found.push(node);
  for (const child of node.children) findNode(child, predicate, found);
  return found;
}

function measureRow(bookmark, options = {}) {
  const root = renderRow(bookmark, options);
  const rowNode = findNode(root, (n) => n.testID === "bookmark-row")[0] ?? root;
  const title = findNode(root, (n) => n.kind === "Text" && n.text.includes(bookmark.title))[0];
  const domainText = findNode(root, (n) => n.kind === "Text" && n.text === bookmark.domain)[0];
  const chip = findNode(root, (n) => n.kind === "ChipTarget" && (n.accessibilityLabel ?? "").includes("tagged"))[0];
  const result = {
    appliedHeight: typeof rowNode.flat.height === "number" ? rowNode.flat.height : undefined,
    intrinsicHeight: root.intrinsicHeight,
    titleY: title?.y,
    metaBottom: domainText ? domainText.y + domainText.measured : undefined,
    chip: chip ? {
      boxTop: chip.y,
      boxHeight: chip.boxHeight,
      paintedTop: chip.y + chip.painted.offset,
      paintedBottom: chip.y + chip.painted.offset + chip.painted.height,
      paintedHeight: chip.painted.height,
      targetHeight: chip.targetHeight,
      hitSlop: chip.hitSlop,
      maxWidth: chip.flat.maxWidth,
      boxMinWidth: chip.flat.minWidth,
      visualMinHeight: chip.visual?.minHeight,
    } : null,
  };
  if (result.chip && result.metaBottom != null) {
    result.gapMetaToChipPainted = result.chip.paintedTop - result.metaBottom;
    if (result.appliedHeight != null) result.deadBelowChipPainted = result.appliedHeight - result.chip.paintedBottom;
  }
  return { root, rowNode, result };
}

/* ------------------------------ baseline data ------------------------------ */
// Frozen measurements of the pre-fix source (real 48dp tag target boxes),
// captured by this same engine before the compact fix. The tests below pin
// the fixed geometry; these constants document the delta.
const BEFORE = {
  appliedHeight: 120,
  intrinsicHeight: 118,
  gapMetaToChipPainted: 16,
  deadBelowChipPainted: 25,
  chipTargetHeight: 48,
  chipPaintedHeight: 24,
};

/* --------------------------------- report --------------------------------- */

if (process.argv.includes("--debug-tree")) {
  const { root } = measureRow(websiteBookmark({ tags: [tag("t1", "Shopping")] }));
  const walk = (node, depth) => {
    console.log(`${" ".repeat(depth)}${node.kind} y=${node.y} measured=${node.measured}${node.text ? ` text=${JSON.stringify(node.text.slice(0, 20))}` : ""}`);
    node.children.forEach((child) => walk(child, depth + 2));
  };
  walk(root, 0);
  process.exit(0);
}

if (process.argv.includes("--report")) {
  const tagged = websiteBookmark({ tags: [tag("t1", "Shopping")] });
  const manyTags = websiteBookmark({ tags: [tag("t1", "Shopping"), tag("t2", "Gifts"), tag("t3", "Winter")] });
  const reminder = websiteBookmark({ remindAt: new Date(Date.now() + 3600e3).toISOString() });
  const report = {
    before: BEFORE,
    tagged: { standard: measureRow(tagged).result, expressive: measureRow(tagged, { expressive: true }).result },
    manyTags: measureRow(manyTags).result,
    reminder: measureRow(reminder).result,
    plain: measureRow(websiteBookmark()).result,
    estimates: {
      tagged: layoutLib.estimateBookmarkRowSize(tagged),
      reminder: layoutLib.estimateBookmarkRowSize(reminder),
      plain: layoutLib.estimateBookmarkRowSize(websiteBookmark()),
    },
  };
  console.log(JSON.stringify(report, null, 2));
  process.exit(0);
}

/* ---------------------------------- tests ---------------------------------- */

const { test } = require("node:test");

function taggedBookmark() {
  return websiteBookmark({ tags: [tag("t1", "Shopping")] });
}

test("tagged row is compact: fixed height tracks the estimate and hugs the content", () => {
  const { result } = measureRow(taggedBookmark());
  const estimate = layoutLib.estimateBookmarkRowSize(taggedBookmark());
  assert.equal(result.appliedHeight, estimate, "applied fixed height must equal the FlashList estimate");
  assert.ok(result.appliedHeight <= 104,
    `tagged row must stay compact (got ${result.appliedHeight}dp, was ${BEFORE.appliedHeight}dp before the fix)`);
  assert.ok(result.appliedHeight >= result.intrinsicHeight,
    `fixed height ${result.appliedHeight} must never clip intrinsic content ${result.intrinsicHeight}`);
  assert.ok(result.appliedHeight - result.intrinsicHeight <= 4,
    `fixed height reserves ${result.appliedHeight - result.intrinsicHeight}dp over intrinsic ${result.intrinsicHeight}dp`);
});

test("the painted chip sits in Material rhythm: tight under metadata, modest space below", () => {
  const { result } = measureRow(taggedBookmark());
  assert.ok(result.gapMetaToChipPainted <= 8,
    `gap between metadata line and painted chip must be <= 8dp (got ${result.gapMetaToChipPainted}dp, was ${BEFORE.gapMetaToChipPainted}dp)`);
  assert.ok(result.deadBelowChipPainted <= 20,
    `dead space below the painted chip must be <= 20dp (got ${result.deadBelowChipPainted}dp, was ${BEFORE.deadBelowChipPainted}dp)`);
});

test("inline chip keeps a >= 48dp interactive target and an M3 32dp real container", () => {
  const { result } = measureRow(taggedBookmark());
  const chip = result.chip;
  assert.ok(chip, "inline tag chip rendered");
  // 48dp touch: real box (>= 32dp, the M3 chip container height — react-native-web
  // ignores hitSlop, so the real box must carry a sane target alone) plus native
  // hitSlop bands that live inside the row's own gap and bottom padding.
  assert.ok(chip.boxHeight >= 32, `chip real box >= 32dp (got ${chip.boxHeight}dp)`);
  assert.ok(chip.targetHeight >= 48, `chip interactive target >= 48dp (got ${chip.targetHeight}dp)`);
  assert.ok(chip.boxMinWidth >= 48, `chip target width >= 48dp (got ${chip.boxMinWidth}dp)`);
});

test("estimate buckets: plain 72, reminder/suggestion 96, tagged compact, omitted tags fall back", () => {
  assert.equal(layoutLib.estimateBookmarkRowSize(websiteBookmark()), 72);
  assert.equal(layoutLib.estimateBookmarkRowSize(websiteBookmark({ remindAt: new Date(Date.now() + 3600e3).toISOString() })), 96);
  assert.equal(layoutLib.estimateBookmarkRowSize(websiteBookmark({ suggestedTags: [tag("s1", "Read later")] })), 96);
  const tagged = layoutLib.estimateBookmarkRowSize(taggedBookmark());
  assert.ok(tagged >= 96 && tagged <= 104, `tagged estimate in the compact band (got ${tagged}dp)`);
  assert.equal(layoutLib.estimateBookmarkRowSize(taggedBookmark(), ["t1"]), 72,
    "hiding the only tag (active filter) falls back to the plain bucket");
});

test("typography alignment: tagged and plain rows start the title at the same offset", () => {
  const plain = measureRow(websiteBookmark());
  const tagged = measureRow(taggedBookmark());
  assert.equal(plain.result.titleY, tagged.result.titleY,
    "title offset must not shift when a row has tags");
});

test("tag overflow stays on one measured line and does not grow the row", () => {
  const one = measureRow(taggedBookmark());
  const many = measureRow(websiteBookmark({ tags: [tag("t1", "Shopping"), tag("t2", "Gift ideas"), tag("t3", "Winter sale")] }));
  assert.equal(many.result.appliedHeight, one.result.appliedHeight, "overflow tags collapse to +N; row height unchanged");
  const chips = findNode(many.root, (n) => n.kind === "ChipTarget" && (n.accessibilityLabel ?? "").includes("tagged"));
  assert.equal(chips.length, 2, "two visible chips before overflow");
  for (const chip of chips) {
    assert.equal(chip.flat.maxWidth, 120, "chip clamps long names at 120dp");
  }
  assert.ok(findNode(many.root, (n) => n.kind === "Text" && n.text.trim() === "+1")[0], "overflow count rendered");
});

test("font scaling drops the fixed height so accessibility text is never clipped", () => {
  const scaled = measureRow(taggedBookmark(), { fontScale: 1.5 });
  assert.equal(scaled.result.appliedHeight, undefined, "row must not pin a fixed height when fontScale > 1");
  assert.ok(scaled.result.intrinsicHeight >= 94, `intrinsic content still measured (${scaled.result.intrinsicHeight}dp)`);
});

test("expressive mode keeps the same content stack; only chrome differs", () => {
  const standard = measureRow(taggedBookmark());
  const expressive = measureRow(taggedBookmark(), { expressive: true });
  assert.equal(expressive.result.intrinsicHeight, standard.result.intrinsicHeight, "content stack identical in both design modes");
  assert.equal(expressive.result.gapMetaToChipPainted, standard.result.gapMetaToChipPainted, "chip rhythm identical in both design modes");
  assert.equal(expressive.rowNode.flat.marginBottom, 2, "expressive segmented gap");
  assert.equal(expressive.rowNode.flat.overflow, "visible", "expressive rows let shaped highlights bleed");
  assert.equal(standard.rowNode.flat.overflow, "hidden", "standard rows clip their contents");
});

test("reminder rows keep their status line and 96dp bucket", () => {
  const { result } = measureRow(websiteBookmark({ remindAt: new Date(Date.now() + 3600e3).toISOString() }));
  assert.equal(result.appliedHeight, 96);
  assert.ok(result.intrinsicHeight <= 96, `reminder row intrinsic (${result.intrinsicHeight}dp) fits its 96dp bucket`);
});
