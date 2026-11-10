/** Behavioral checks for draft ownership, cancelled lock strokes and sheet regrabs.
 * Real source runs with a minimal hook/worklet host; no device is simulated. */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const babel = require('@babel/core');
const React = require('react');
const source = relative => path.join(__dirname, '../src', relative);
function load(relative, stubs = {}) {
  const filename = source(relative);
  const code = babel.transformSync(fs.readFileSync(filename, 'utf8'), {
    filename, configFile: false, babelrc: false,
    presets: [[require.resolve('babel-preset-expo'), { disableImportExportTransform: false, worklets: false, reanimated: false }]],
  }).code;
  const exports = {};
  vm.runInNewContext(`(function(require,exports){${code}\n})`, { Map, setTimeout, clearTimeout })(name => {
    if (name in stubs) return stubs[name];
    if (name.startsWith('@babel/runtime/') || name === 'react/jsx-runtime') return require(name);
    throw new Error(`Unstubbed import ${name}`);
  }, exports);
  return exports;
}
function hookHost() {
  const slots = [];
  let cursor = 0, effects = [];
  const memo = (fn, deps) => {
    const i = cursor++, previous = slots[i];
    if (!previous || deps.some((value, index) => !Object.is(value, previous.deps[index]))) slots[i] = { value: fn(), deps };
    return slots[i].value;
  };
  const host = { ...React,
    useRef(initial) { const i = cursor++; return slots[i] ??= { current: initial }; },
    useState(initial) { const i = cursor++; if (!(i in slots)) slots[i] = typeof initial === 'function' ? initial() : initial;
      return [slots[i], value => { slots[i] = typeof value === 'function' ? value(slots[i]) : value; }]; },
    useMemo: memo, useCallback: (fn, deps) => memo(() => fn, deps),
    useLayoutEffect(fn, deps) { memo(() => { effects.push(fn); }, deps); },
  };
  return { React: host, render(fn) { cursor = 0; effects = []; const result = fn(); effects.forEach(fn => fn()); return result; } };
}
const hooks = hookHost();
const { useDraftDismiss } = load('components/ui/draft-dismiss.tsx', { react: hooks.React });
let visible = true, dirty = false, dismissed = 0;
const render = () => hooks.render(() => useDraftDismiss(visible, dirty));
let draft = render();
assert.equal(draft.scope.request(() => dismissed++), true);
assert.equal(dismissed, 1);
draft.scope.edit('title', 'Saved', 'Draft');
assert.equal(draft.scope.request(() => dismissed++), false);
draft = render(); assert.equal(draft.confirming, true);
draft.keep(); draft = render();
assert.equal(draft.confirming, false); assert.equal(dismissed, 1);
// A covering picker/confirmation re-render must not rebase the saved title.
assert.equal(draft.scope.request(() => dismissed++), false);
draft = render(); draft.discard(); draft.discard();
assert.equal(dismissed, 2, 'discard executes the pending transition once');
draft = render();
draft.scope.edit('secret', '', 'entered');
draft.scope.edit('secret', 'entered', '');
assert.equal(draft.scope.request(() => dismissed++), true, 'editing back to the baseline is clean');
draft.scope.edit('code', '', '123'); draft.scope.sync('code', '');
assert.equal(draft.scope.request(() => dismissed++), true, 'a successful form reset clears the field');
dirty = true; draft = render();
assert.equal(draft.scope.request(() => dismissed++), false, 'non-text drafts are guarded');
draft.keep(); dirty = false; visible = false; render(); visible = true; draft = render();
assert.equal(draft.scope.request(() => dismissed++), true, 'a new session does not inherit edits');
console.log('PASS: panel drafts survive Keep editing and cover transitions; discard, revert and reset are safe');

const physics = load('lib/sheet-gesture.ts');
for (const position of [-110, -60, -8, 0, 24, 140]) {
  const regrab = physics.sheetDragPosition(physics.sheetDragOrigin(position), 0);
  assert.ok(Math.abs(regrab - position) < 1e-6, `regrab jumped at ${position}`);
}
assert.equal(physics.sheetDragPosition(24, 16), 40);
assert.ok(physics.sheetDragPosition(0, -500) > -120, 'upward travel resists instead of escaping the viewport');
assert.equal(physics.shouldDismissSheet(20, 900), true);
assert.equal(physics.shouldDismissSheet(70, 0), true);
assert.equal(physics.shouldDismissSheet(0, 1500), false);
assert.equal(physics.shouldDismissSheet(20, -900), false);
console.log('PASS: resisted and positive sheet positions regrab continuously; distance/velocity dismissal boundaries');

const { appendPatternNode } = load('lib/pattern-input.ts');
let callbacks, changes, completions;
const pan = () => {
  callbacks = {};
  const chain = new Proxy({}, { get: (_, key) => value => { callbacks[key] = value; return chain; } });
  return chain;
};
const patternHooks = { ...React, useState: initial => [initial, () => {}], useMemo: fn => fn(), useEffect: fn => fn() };
const noop = () => null;
const { PatternInput } = load('components/bookmarks/PatternInput.tsx', {
  react: patternHooks,
  'react-native': { Platform: { OS: 'android' }, StyleSheet: { create: x => x, absoluteFill: {} }, View: noop },
  'react-native-gesture-handler': { Gesture: { Pan: pan }, GestureDetector: noop },
  'react-native-reanimated': { __esModule: true, default: { View: noop, createAnimatedComponent: x => x },
    useSharedValue: value => ({ value }), useAnimatedProps: fn => fn, useAnimatedStyle: fn => fn,
    runOnJS: fn => fn },
  'react-native-svg': { __esModule: true, default: noop, Path: noop },
  '../../theme/ThemeProvider': { useTheme: () => ({ palette: {} }) },
  '../../lib/haptics': { haptics: { selection() {}, warning() {} } },
  '../../theme/tokens': { radius: {} },
  '../ui/PressableScale': { PressableScale: noop }, '../ui/Button': { Button: noop }, '../ui/Text': { Text: noop },
  '../ui/draft-dismiss': { usePanelDraftField: () => () => {} },
  '../../lib/pattern-input': { appendPatternNode },
});
function beginPattern() {
  changes = []; completions = [];
  PatternInput({ value: [], onChange: value => changes.push([...value]), onComplete: value => completions.push([...value]) });
  callbacks.onStart({ x: 36, y: 36 });
  callbacks.onUpdate({ x: 216, y: 36 });
  callbacks.onUpdate({ x: 216, y: 216 });
  assert.equal(changes.length, 0, 'continuous tracking stays off the JS state path');
}
beginPattern(); callbacks.onFinalize({}, false);
assert.deepEqual(changes, [[]]); assert.deepEqual(completions, [], 'cancelled strokes never submit');
beginPattern(); callbacks.onEnd(); callbacks.onFinalize({}, true);
assert.deepEqual(changes, [[0, 1, 2, 5, 8]]); assert.deepEqual(completions, [[0, 1, 2, 5, 8]]);
console.log('PASS: interrupted lock strokes are discarded; successful release preserves intermediate-dot filling');

// Reveal actions retain the originating folder and reuse undoable deletion.
let folderLocked = false, token = null, writes = [], errors = [];
const rowHooks = { ...React, useRef: () => ({ current: null }), useState: value => [value, () => {}], useEffect: fn => fn() };
const { BookmarkSwipe } = load('components/bookmarks/BookmarkSwipe.tsx', {
  react: rowHooks, 'react-native': { View: noop },
  'react-native-gesture-handler/ReanimatedSwipeable': { __esModule: true, default: noop },
  '@tanstack/react-query': { useQueryClient: () => ({ getQueryData: () => [{ id: 'folder', protected: folderLocked }] }) },
  '../../hooks/use-bookmarks': {
    useToggleRead: folderId => ({ mutate: value => writes.push(['read', folderId, value]) }),
    useDeleteBookmark: folderId => ({ mutate: value => writes.push(['undoableDelete', folderId, value]) }),
  },
  '../../store/folder-tokens': { useFolderTokenStore: { getState: () => ({ get: () => token }) } },
  '../../lib/api/query-keys': { qk: { folders: ['folders'] } },
  '../../lib/error-message': { errorMessage: error => String(error) },
  '../../lib/haptics': { haptics: { selection() {}, medium() {} } },
  '../../theme/ThemeProvider': { useTheme: () => ({ palette: {}, expressive: false }) },
  '../../theme/material-motion': { useMaterialMotion: () => ({ spatial: {}, reducedMotion: false }) },
  '../ui/ListPressable': { ListPressable: noop }, '../ui/Text': { Text: noop },
  '../ui/toast-store': { toast: { error: message => errors.push(message) } },
});
const bookmark = { id: 'article', folderId: 'folder', isRead: false };
function reveal(disabled = false) {
  const row = BookmarkSwipe({ bookmark, disabled, children: null });
  return row.props.renderRightActions().props.children;
}
let actions = reveal(); actions[0].props.onPress(); actions[1].props.onPress();
assert.deepEqual(writes.map(write => write.slice(0, 2)), [['read', 'folder'], ['undoableDelete', 'folder']]);
assert.equal(writes[0][2].id, 'article'); assert.equal(writes[0][2].isRead, true);
assert.equal(writes[1][2], bookmark);
writes = []; actions = reveal(true); actions.forEach(action => action.props.onPress());
assert.equal(writes.length, 0, 'selection suppresses both row actions');
folderLocked = true; actions = reveal(); actions.forEach(action => action.props.onPress());
assert.equal(writes.length, 0); assert.equal(errors.length, 2, 'protected folders cannot mutate without a token');
token = 'unlocked'; actions[1].props.onPress(); assert.equal(writes.length, 1);
console.log('PASS: article swipes preserve folder scope, selection gating and the undoable delete path');

// Overlay publishes must never flip the refresh gesture's native enabled state:
// RNGH 2.32 cancels a begun handler mid-touch on an enabled flip, and a long-press
// menu publish used to do exactly that while the finger held a row. The hook now
// mirrors `enabled` into a shared value (stable gesture identity) and gates
// arming/commit through it.
const pullRefresh = load('lib/pull-refresh.ts');
let jsCalls = [], refreshCalls = [];
function gestureRecorder() {
  const record = { enabled: [], down: null, move: null, up: null };
  const chain = new Proxy({ __record: record }, {
    get(target, key) {
      if (key === '__record') return target.__record;
      if (key === 'enabled') return value => { target.__record.enabled.push(value); return chain; };
      if (key === 'onTouchesDown') return fn => { target.__record.down = fn; return chain; };
      if (key === 'onTouchesMove') return fn => { target.__record.move = fn; return chain; };
      if (key === 'onTouchesUp') return fn => { target.__record.up = fn; return chain; };
      return () => chain;
    },
  });
  return chain;
}
const manager = { begin() {}, fail() {}, activate() {}, end() {} };
const refreshHost = hookHost();
const { useMaterialRefresh } = load('hooks/use-material-refresh.ts', {
  react: { ...refreshHost.React, useEffect: refreshHost.React.useLayoutEffect },
  'react-native': { Platform: { OS: 'android' } },
  'react-native-reanimated': {
    useSharedValue: initial => refreshHost.React.useRef({ value: initial }).current,
    runOnJS: fn => (...args) => { jsCalls.push(fn); fn(...args); },
  },
  'react-native-gesture-handler': {
    Gesture: { Manual: gestureRecorder, Native: gestureRecorder,
      Simultaneous: (native, observer) => ({ native, observer }) },
  },
  '../lib/pull-refresh': pullRefresh,
  '../lib/haptics': { haptics: { light() {}, selection() {} } },
});
let enabled = true;
const renderRefresh = () => refreshHost.render(() => useMaterialRefresh(false, () => refreshCalls.push('refresh'), enabled));
const down = observer => observer.__record.down({ allTouches: [{ absoluteX: 4, absoluteY: 4 }], numberOfTouches: 1 }, manager);
const up = observer => observer.__record.up({ allTouches: [] }, manager);

let hook = renderRefresh();
const gesture = hook.gesture;
down(gesture.observer);
// A menu publish flips `enabled` mid-hold. The gesture object and its native
// enabled chain must not change; only the shared value moves.
enabled = false; hook = renderRefresh();
assert.equal(hook.gesture, gesture, 'overlay publish must not rebuild the refresh gesture');
assert.deepEqual(gesture.observer.__record.enabled, [true], 'no mid-touch native enabled write');
up(gesture.observer);
assert.deepEqual(jsCalls, [], 'a pull begun before the overlay cannot commit under it');
assert.deepEqual(refreshCalls, []);

// A plain pull with no overlay still commits on release.
jsCalls = []; enabled = true; hook = renderRefresh();
down(hook.gesture.observer);
hook.gesture.observer.__record.move({ allTouches: [{ absoluteX: 4, absoluteY: 300 }], numberOfTouches: 1 }, manager);
up(hook.gesture.observer);
assert.equal(jsCalls.length, 2, 'release runs the threshold haptic and exactly one runOnJS commit');
assert.deepEqual(refreshCalls, ['refresh']);
console.log('PASS: overlay publishes keep refresh gesture identity; disabled pulls never commit; plain pulls still commit');
