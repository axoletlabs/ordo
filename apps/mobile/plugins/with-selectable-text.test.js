const assert = require("node:assert/strict");
const { test } = require("node:test");
const {
  ordoSelectableTextKotlin,
  patchMainApplicationForSelectableText,
} = require("./with-selectable-text.js");

const EXPO57_APPLICATION = `class MainApplication : Application(), ReactApplication {
  override val reactHost: ReactHost by lazy {
    ExpoReactHostFactory.getDefaultReactHost(
      context = applicationContext,
      packageList =
        PackageList(this).packages.apply {
          // Packages that cannot be autolinked yet can be added manually here, for example:
          // add(MyReactNativePackage())
        }
    )
  }
}
`;

test("registers OrdoSelectableTextPackage on Expo 57 MainApplication", () => {
  const patched = patchMainApplicationForSelectableText(EXPO57_APPLICATION, "kt");
  assert.match(patched, /add\(OrdoSelectableTextPackage\(\)\)/);
  assert.equal(patchMainApplicationForSelectableText(patched, "kt"), patched);
});

test("selectable text native module is a TextView, not an EditText", () => {
  const src = ordoSelectableTextKotlin("com.axolet.ordo");
  assert.match(src, /isCursorVisible = false/);
  assert.match(src, /setTextIsSelectable\(true\)/);
  assert.match(src, /customInsertionActionModeCallback/);
  assert.match(src, /Callback2/);
  assert.match(src, /return false/);
  assert.match(src, /hookView/);
  assert.match(src, /ViewGroup/);
  assert.match(src, /putSelectionRect/);
  assert.match(src, /getLocationInWindow/);
  assert.match(src, /PixelUtil/);
  assert.match(src, /getLineBottom\(startLine\)/);
  assert.doesNotMatch(src, /hideSelectionMenu/);
  assert.doesNotMatch(src, /getLocationOnScreen/);
  assert.doesNotMatch(src, /EditText/);
  assert.doesNotMatch(src, /ReactEditText/);
});
