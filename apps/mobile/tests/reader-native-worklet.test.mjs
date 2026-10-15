import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, resolve } from "node:path";
import test from "node:test";
import { transformSync } from "@babel/core";

const require = createRequire(import.meta.url);
const mobile = resolve(import.meta.dirname, "..");

function compile(source, filename, mocks, platform = "android") {
  const { code } = transformSync(source, {
    filename, babelrc: false, configFile: false, envName: "production",
    presets: [["babel-preset-expo", { platform }]],
  });
  const module = { exports: {} };
  new Function("require", "module", "exports", "__DEV__", code)(id => {
    if (id.startsWith("@babel/runtime/")) return require(id);
    assert.ok(id in mocks, `Unexpected dependency: ${id}`);
    return mocks[id];
  }, module, module.exports, false);
  return module.exports;
}

/** Use the installed native serializer's real type checks. Only the JSI
 * allocation functions are replaced; web/Jest's identity serializer misses this crash. */
function nativeRuntime() {
  const worklets = dirname(require.resolve("react-native-worklets/package.json"));
  const filename = resolve(worklets, "src/memory/serializable.native.ts");
  const { createSerializable } = compile(readFileSync(filename, "utf8"), filename, {
    "../debug/errors": {}, "../debug/jsVersion": {}, "../debug/logger": {},
    "../runtimeKind": {},
    "../workletFunction": { isWorkletFunction: value => typeof value === "function" && value.__workletHash !== undefined },
    "../WorkletsModule/NativeWorklets": { WorkletsModule: new Proxy({}, {
      get: (_, kind) => (...args) => ({ kind, args }),
    }) },
    "./isSynchronizable": { isSynchronizable: () => false },
    "./serializableMappingCache": { serializableMappingCache: new WeakMap(), serializableMappingFlag: Symbol() },
  });
  const reanimated = dirname(require.resolve("react-native-reanimated/package.json"));
  const eventFile = resolve(reanimated, "src/WorkletEventHandler.ts");
  const { WorkletEventHandler } = compile(readFileSync(eventFile, "utf8"), eventFile, {
    "./common": { SHOULD_BE_USE_WEB: false }, "./core": {},
  });
  return { createSerializable, WorkletEventHandler };
}

function readerStyle(createSerializable, expansion, scrollHandler, platform) {
  const filename = resolve(mobile, "src/components/reader/ReaderPane.tsx");
  const source = readFileSync(filename, "utf8");
  // Execute the actual header-style declarations with the native Babel transform.
  const declarations = source.slice(source.indexOf("  const chromeHeightSV ="), source.indexOf("  const websiteViewRef ="));
  assert.ok(declarations.includes("const chromeShiftStyle ="));
  const { render } = compile(`
    import { useState } from "react";
    import { useAnimatedStyle, useSharedValue } from "react-native-reanimated";
    export function render(collapsingFab) {
      ${declarations}
      return { chromeHeightSV, chromeShiftStyle };
    }
  `, filename, {
    react: { useState: value => [value, () => {}] },
    "react-native-reanimated": {
      useSharedValue: value => ({ value }),
      useAnimatedStyle: updater => {
        assert.ok(updater.__workletHash, "test the native worklet, not the web fallback");
        createSerializable(updater);
        return updater;
      },
    },
  }, platform);
  return render({ expansion, scrollHandler, expand() {} });
}

for (const platform of ["android", "ios"]) test(`${platform}: reader header mounts without serializing its JS scroll-event registration`, () => {
  const { createSerializable, WorkletEventHandler } = nativeRuntime();
  const scrollHandler = { workletEventHandler: new WorkletEventHandler(() => {}, ["onScroll"]) };
  assert.throws(() => createSerializable(scrollHandler), /Cannot copy value of type `WorkletEventHandlerNative`/,
    "native event registrations cannot be captured in a style worklet");
  const expansion = { spatial: { value: 1 }, effects: { value: 1 } };
  const { chromeHeightSV, chromeShiftStyle } = readerStyle(createSerializable, expansion, scrollHandler, platform);
  chromeHeightSV.value = 96;
  for (const [expanded, shift] of [[1, 0], [0.5, -48], [0, -96]]) {
    expansion.spatial.value = expanded;
    assert.equal(chromeShiftStyle().transform[0].translateY || 0, shift);
  }
});
