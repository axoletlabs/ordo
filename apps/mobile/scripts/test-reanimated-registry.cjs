/** Exercise installed animation synchronization and shared-control color processing. */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');

const source = path.join(path.dirname(require.resolve('react-native-reanimated/package.json')),
  'src/PropsRegistryGarbageCollector.ts');
const code = ts.transpileModule(fs.readFileSync(source, 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText;
const exportsObject = {};
const intervals = new Set();
const synced = [];
vm.runInNewContext(code, {
  exports: exportsObject,
  require: (name) => {
    if (name === './ReanimatedModule') return { ReanimatedModule: {
      getSettledUpdates: () => [{ viewTag: 3, styleProps: { opacity: 1 } }],
    } };
    if (name === './common/style/processors/colors') {
      return { unprocessColorsInProps: () => {}, unprocessColor: (color) => color };
    }
    throw Error(`Unexpected dependency: ${name}`);
  },
  setInterval: (callback) => { intervals.add(callback); return callback; },
  clearInterval: (callback) => intervals.delete(callback),
});
const gc = exportsObject.PropsRegistryGarbageCollector;
const component = { _syncStylePropsBackToReact: (props) => synced.push(props.opacity) };

gc.registerView(1, component);
gc.registerView(1, component); // GestureDetector + inner Animated.View share a tag.
assert.equal(intervals.size, 1);
gc.unregisterView(1);
gc.unregisterView(1); // Both wrappers unmount; the second removal must be a no-op.
assert.equal(intervals.size, 0);
gc.registerView(2, component);
assert.equal(intervals.size, 1, 'sync must restart after a nested view unmount');
gc.registerView(3, component);
gc.unregisterView(2);
gc.unregisterView(2);
assert.equal(intervals.size, 1, 'duplicate removal must not stop syncing other mounted views');
for (const tick of intervals) tick();
assert.deepEqual(synced, [1], 'settled styles still reach the remaining mounted view');
gc.unregisterView(3);
assert.equal(intervals.size, 0);
for (let i = 0; i < 20; i++) {
  gc.registerView(3, component);
  assert.equal(intervals.size, 1);
  gc.unregisterView(3);
  gc.unregisterView(3);
  assert.equal(intervals.size, 0, 'repeated unmounts must not leak collector timers');
}
console.log('PASS: actual Reanimated collector restarts after nested unmount, keeps syncing live views, and leaves no timers after repeated cycles');

// Run the real state-layer worklet through the installed native color parser.
// A release spring can reach scientific-notation alpha values before settling;
// rejecting one on the UI runtime destroys the entire React Native instance.
function compileSource(file, dependencies = {}) {
  const exports = {};
  const code = ts.transpileModule(fs.readFileSync(file, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  vm.runInNewContext(code, { exports, require: name => {
    assert(name in dependencies, `Unexpected color dependency: ${name}`);
    return dependencies[name];
  } });
  return exports;
}
const reanimated = path.dirname(require.resolve('react-native-reanimated/package.json'));
const colors = compileSource(path.join(reanimated, 'src/Colors.ts'));
const { processColor } = compileSource(path.join(reanimated, 'src/common/style/processors/colors.ts'), {
  '../../../Colors': colors,
  '../../constants': { IS_ANDROID: true, IS_IOS: false },
  '../../types': { ValueProcessorTarget: { CSS: 'css' } },
  '../../utils': { isRecord: value => value != null && typeof value === 'object' && !Array.isArray(value) },
});
assert.throws(() => processColor('rgba(28,53,49,4.2036685545777925e-7)'), /Invalid color value/,
  'reproduce the exact on-device failure before testing our paint');

const pressablePath = path.resolve(__dirname, '../src/components/ui/PressableScale.tsx');
const pressable = ts.createSourceFile(pressablePath, fs.readFileSync(pressablePath, 'utf8'),
  ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
let layerWorklet;
function findLayer(node) {
  if (ts.isVariableDeclaration(node) && node.name.getText(pressable) === 'layerStyle') {
    assert(ts.isCallExpression(node.initializer));
    layerWorklet = node.initializer.arguments[0].getText(pressable);
  }
  ts.forEachChild(node, findLayer);
}
findLayer(pressable);
assert(layerWorklet, 'test must execute the actual shared-control paint callback');
const layer = { value: 0 };
const paint = vm.runInNewContext(`(${layerWorklet})`, { tintRgb: [28, 53, 49], layer });
const values = [0, 1, 0.08, 0.1, -0.01, 1.01, 4.2036685545777925e-7, Number.MIN_VALUE];
// Cover release tails, interruption/reversal, and both sides of clamping.
for (let exponent = 1; exponent <= 323; exponent++) values.push(10 ** -exponent, -(10 ** -exponent));
for (let frame = 0; frame < 2000; frame++) values.push(0.1 * Math.exp(-frame / 30));
for (const value of values) {
  layer.value = value;
  const result = processColor(paint().backgroundColor);
  assert.equal(typeof result, 'number', `invalid native paint at intensity ${value}`);
  assert.equal((result >>> 16) & 255, 28);
  assert.equal((result >>> 8) & 255, 53);
  assert.equal(result & 255, 49);
  const alpha = (result >>> 24) / 255;
  assert(Math.abs(alpha - Math.max(0, Math.min(1, value))) <= 1 / 255,
    'safe formatting must preserve the intended fade within native alpha precision');
}
layer.value = 0;
assert.equal(processColor(paint().backgroundColor) >>> 24, 0, 'release settles fully transparent');
console.log(`PASS: actual state-layer paint survives ${values.length} spring-tail/retarget values in the installed Android color processor`);

// TypeScript-only tests cannot catch a callback skipped by the worklet plugin.
// Compile the real hook with the Android production Babel config, then execute
// the serialized completion on a separate VM, as the native UI runtime does.
const babel = require('@babel/core');
const hookPath = path.resolve(__dirname, '../src/hooks/use-surface-size.ts');
const compiledHook = babel.transformFileSync(hookPath, {
  cwd: path.resolve(__dirname, '..'),
  envName: 'production',
  caller: { name: 'metro', bundler: 'metro', platform: 'android', isDev: false, supportsStaticESM: false },
}).code;

function surfaceHarness(reducedMotion = false) {
  const slots = [], effects = [], springs = [], jsQueue = [];
  let cursor = 0;
  const motion = { reducedMotion, spatial: { stiffness: 380, damping: 31, mass: 1 } };
  const exports = {};
  const dependencies = {
    react: {
      useRef: initial => slots[cursor++] ??= { current: initial },
      useLayoutEffect: (effect, deps) => {
        const index = cursor++;
        const previous = slots[index];
        if (previous && deps.every((value, i) => Object.is(value, previous.deps[i]))) return;
        effects.push(() => {
          previous?.cleanup?.();
          slots[index] = { deps, cleanup: effect() };
        });
      },
    },
    'react-native-reanimated': {
      useSharedValue: initial => slots[cursor++] ??= { value: initial },
      useAnimatedStyle: style => style(),
      cancelAnimation: () => {},
      withSpring: (target, config, callback) => { springs.push({ target, callback }); return target; },
      runOnJS: callback => (...args) => jsQueue.push(() => callback(...args)),
    },
    '../theme/material-motion': { useMaterialMotion: () => motion },
  };
  vm.runInNewContext(compiledHook, { exports, require: name => {
    assert(name in dependencies, `Unexpected surface dependency: ${name}`);
    return dependencies[name];
  } });
  return {
    springs, jsQueue,
    render: (height, options) => {
      cursor = 0;
      const style = exports.useSurfaceSize(height, options);
      while (effects.length) effects.shift()();
      return style;
    },
    complete: (callback, finished) => {
      assert.equal(typeof callback?.__workletHash, 'number',
        'session-row collapse completion must be compiled as a UI worklet');
      const worklet = vm.runInNewContext(`(${callback.__initData.code})`);
      worklet.call({ __closure: callback.__closure }, finished);
    },
  };
}

const surface = surfaceHarness();
surface.render(null);
surface.render(72);
assert.equal(surface.springs.length, 0, 'first measurement must lay out directly');
let removed = 0, stale = 0;
surface.render(0, { onSettled: () => stale++ });
const collapse = surface.springs.at(-1);
assert.equal(collapse.target, 0);
surface.complete(collapse.callback, false);
assert.equal(surface.jsQueue.length, 0, 'cancelled collapse must not remove the row');
// Replacing the JS callback must not restart geometry or freeze an old owner.
surface.render(0, { onSettled: () => removed++ });
assert.equal(surface.springs.length, 1);
surface.complete(collapse.callback, true);
assert.equal(removed, 0, 'UI completion must schedule row removal on JS');
assert.equal(surface.jsQueue.length, 1);
surface.jsQueue.shift()();
assert.equal(removed, 1);
assert.equal(stale, 0, 'completion must use the latest committed JS callback');
surface.render(72);
assert.equal(surface.springs.at(-1).callback, undefined, 'ordinary resizing needs no completion callback');
const reducedSurface = surfaceHarness(true);
reducedSurface.render(0, { onSettled: () => removed++ });
assert.equal(reducedSurface.springs.length, 0);
assert.equal(reducedSurface.jsQueue.length, 0);
assert.equal(removed, 2, 'reduced motion must settle directly on JS');
console.log('PASS: production Android row-collapse worklet, JS dispatch, cancellation, callback replacement, ordinary resizing and reduced motion');
