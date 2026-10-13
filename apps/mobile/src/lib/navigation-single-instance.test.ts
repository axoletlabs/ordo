import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { test } from "node:test";

const require = createRequire(import.meta.url);
const routerPath = join(dirname(require.resolve("expo-router/package.json")), "build/react-navigation/routers/StackRouter.js");
const { StackRouter } = require(routerPath);
const layout = readFileSync(new URL("../../app/(app)/_layout.tsx", import.meta.url), "utf8");

for (const name of ["settings/index", "settings/appearance", "folder/[id]", "reader/[id]", "tags/[id]"]) {
  test(`${name}: queued double pushes reuse one screen and one Back returns`, () => {
    assert.ok(layout.includes(`name="${name}" dangerouslySingular`));
    const router = StackRouter({ initialRouteName: "(tabs)" });
    // Expo's boolean dangerouslySingular derives identity from route segments,
    // substituting dynamic IDs, but not ephemeral query parameters.
    const options = { routeNames: ["(tabs)", name], routeParamList: {}, routeGetIdList: {
      [name]: ({ params }: { params: { id?: string } }) => name.replace("[id]", params?.id ?? "[id]"),
    } };
    let state = router.getInitialState(options);
    const action = { type: "PUSH", payload: { name, params: { id: "first" } } };
    state = router.getStateForAction(state, action, options);
    const key = state.routes[1].key;
    state = router.getStateForAction(state, action, options);
    assert.equal(state.routes.length, 2);
    assert.equal(state.routes[1].key, key);
    const back = router.getStateForAction(state, { type: "POP", payload: { count: 1 } }, options);
    assert.equal(back.routes.length, 1);
    if (name.includes("[id]")) {
      state = router.getStateForAction(state, { ...action, payload: { name, params: { id: "second" } } }, options);
      assert.equal(state.routes.length, 3, "different items still create different detail screens");
    }
  });
}
