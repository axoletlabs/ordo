import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, resolve } from "node:path";
import { test } from "node:test";
import { transformSync } from "@babel/core";
import React from "react";

const require = createRequire(import.meta.url);

/** Execute the real hook through native gesture callbacks, without RN's JS
 * touch responder. Only the bridge and React's lifecycle are simulated. */
function harness(platform) {
  const slots = [], effects = [], cache = new Map(), haptics = [];
  let cursor = 0;
  const same = (a, b) => a && b && a.length === b.length && a.every((value, i) => Object.is(value, b[i]));
  const memo = (fn, deps) => {
    const index = cursor++;
    if (!slots[index] || !same(slots[index].deps, deps)) slots[index] = { value: fn(), deps };
    return slots[index].value;
  };
  const hooks = { ...React,
    useRef: value => slots[cursor++] ??= { current: value },
    useState: initial => {
      const index = cursor++;
      slots[index] ??= { value: initial };
      return [slots[index].value, value => { slots[index].value = value; }];
    },
    useMemo: memo, useCallback: (fn, deps) => memo(() => fn, deps),
    useEffect: (fn, deps) => {
      const index = cursor++;
      if (slots[index] && same(slots[index].deps, deps)) return;
      effects.push(() => { slots[index]?.cleanup?.(); slots[index] = { deps, cleanup: fn() }; });
    },
  };
  function gesture(type) {
    const instance = { type, callbacks: {}, config: {} };
    for (const key of ["enabled", "runOnJS", "cancelsTouchesInView"]) instance[key] = value => {
      instance.config[key] = value; return instance;
    };
    for (const key of ["onTouchesDown", "onTouchesMove", "onTouchesUp", "onTouchesCancelled", "onFinalize"]) instance[key] = fn => {
      instance.callbacks[key] = fn; return instance;
    };
    return instance;
  }
  function load(filename) {
    if (cache.has(filename)) return cache.get(filename).exports;
    const module = { exports: {} }; cache.set(filename, module);
    const code = transformSync(readFileSync(filename, "utf8"), {
      filename, babelrc: false, configFile: false, presets: ["babel-preset-expo"],
    }).code;
    new Function("require", "module", "exports", code)(id => {
      if (id === "react") return hooks;
      if (id === "react-native") return { Platform: { OS: platform } };
      if (id === "react-native-gesture-handler") return { Gesture: {
        Manual: () => gesture("manual"), Native: () => gesture("native"),
        Simultaneous: (...gestures) => ({ type: "simultaneous", gestures }),
      } };
      if (id.endsWith("/haptics")) return { haptics: {
        selection: () => haptics.push("selection"), light: () => haptics.push("light"),
      } };
      if (id.startsWith(".")) return load(resolve(dirname(filename), `${id}.ts`));
      return require(id);
    }, module, module.exports);
    return module.exports;
  }
  const { useMaterialRefresh } = load(resolve(import.meta.dirname, "../src/hooks/use-material-refresh.ts"));
  return {
    haptics,
    render(options = {}) {
      cursor = 0; effects.length = 0;
      const hook = useMaterialRefresh(options.refreshing ?? false, options.onRefresh, options.enabled ?? true);
      effects.forEach(fn => fn());
      return hook;
    },
    dispose() { slots.forEach(slot => slot?.cleanup?.()); },
  };
}

function nativePull(hook) {
  assert.equal(hook.gesture.type, "simultaneous");
  assert.equal(hook.gesture.gestures[0].type, "native", "keep the list's native scroller simultaneous");
  const observer = hook.gesture.gestures[1];
  assert.equal(observer.config.cancelsTouchesInView, false);
  const states = [];
  const manager = Object.fromEntries(["begin", "activate", "fail", "end"].map(key => [key, () => states.push(key)]));
  const send = (name, x = 100, y = 100, count = 1) => observer.callbacks[name]({
    allTouches: count ? [{ absoluteX: x, absoluteY: y }] : [], numberOfTouches: count,
  }, manager);
  return { states, down: (x, y, count) => send("onTouchesDown", x, y, count),
    move: (x, y, count) => send("onTouchesMove", x, y, count),
    up: () => send("onTouchesUp", 100, 200, 0),
    cancel: () => { send("onTouchesCancelled"); observer.callbacks.onFinalize(); },
    finalize: () => observer.callbacks.onFinalize(),
  };
}

for (const platform of ["android", "ios"]) {
  test(`${platform}: native pull drives the Material HUD and commits once on release`, t => {
    const app = harness(platform); t.after(() => app.dispose());
    let requests = 0;
    const options = { onRefresh: () => requests++ };
    const hook = app.render(options), pull = nativePull(hook);
    pull.down(); pull.move(100, 120);
    assert.equal(app.render(options).dy, 20);
    assert.equal(requests, 0);
    pull.move(100, 210);
    const armed = app.render(options);
    assert.equal(armed.dy, 110);
    assert.equal(armed.gesture, hook.gesture, "HUD renders never rebuild the active observer");
    pull.up(); pull.finalize(); pull.up();
    assert.equal(requests, 1);
    assert.equal(app.render(options).dy, 0);
    assert.deepEqual(app.haptics, ["selection", "light"]);
    app.render({ ...options, refreshing: true });
    pull.down(); pull.move(100, 210); pull.up();
    assert.equal(requests, 1, "ignore pulls while refreshing");
    app.render(options);
    pull.down(); pull.move(100, 210); pull.up();
    assert.equal(requests, 2, "unlock on completion");
  });

  test(`${platform}: invalid or interrupted native pulls clear the HUD without refreshing`, t => {
    const app = harness(platform); t.after(() => app.dispose());
    let requests = 0;
    const options = { onRefresh: () => requests++ };
    const hook = app.render(options), pull = nativePull(hook);
    for (const invalid of [
      () => { pull.move(100, 140); pull.up(); },
      () => { pull.move(100, 210); pull.cancel(); },
      () => { pull.move(260, 180); pull.up(); },
      () => { pull.move(100, 210, 2); pull.up(); },
      () => { pull.move(100, 210); pull.move(100, 120); pull.up(); },
      () => { pull.move(100, 210); pull.finalize(); pull.up(); },
    ]) {
      pull.down(); invalid();
      assert.equal(requests, 0);
      assert.equal(app.render(options).dy, 0);
    }
    hook.onScroll({ nativeEvent: { contentOffset: { y: 50 } } });
    pull.down(); pull.move(100, 210); pull.up();
    assert.equal(requests, 0, "a pull starting below the top cannot refresh");
    hook.onScroll({ nativeEvent: { contentOffset: { y: 0 } } });
    pull.down(); pull.move(100, 210);
    app.render({ ...options, enabled: false }); pull.up();
    assert.equal(requests, 0, "selection drag disabling scroll also disables refresh");
  });

  test(`${platform}: a stable native observer uses the latest refresh callback`, t => {
    const app = harness(platform); t.after(() => app.dispose());
    let old = 0, latest = 0;
    const hook = app.render({ onRefresh: () => old++ }), pull = nativePull(hook);
    pull.down(); pull.move(100, 210);
    assert.equal(app.render({ onRefresh: () => latest++ }).gesture, hook.gesture);
    pull.up();
    assert.equal(old, 0); assert.equal(latest, 1);
  });
}

test("web: touch release retains Material feedback without a native gesture wrapper", t => {
  const app = harness("web"); t.after(() => app.dispose());
  let requests = 0;
  const options = { onRefresh: () => requests++ }, hook = app.render(options);
  assert.equal(hook.gesture, undefined);
  const event = y => ({ nativeEvent: { touches: [{ pageX: 100, pageY: y }] } });
  hook.onTouchStart(event(100)); hook.onTouchMove(event(210));
  assert.equal(app.render(options).dy, 110);
  hook.onTouchEnd(event(210)); hook.onScrollEndDrag({});
  assert.equal(requests, 1);
});
