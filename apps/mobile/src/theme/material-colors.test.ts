import assert from "node:assert/strict";
import { test } from "node:test";
import { APP_COLOR, materialColorRoles, type DeviceTonalPalettes } from "./material-colors.ts";
import { argbFromHex, Contrast, hexFromArgb, TonalPalette } from "@material/material-color-utilities";

const pairs = [
  ["primary", "onPrimary"], ["primaryContainer", "onPrimaryContainer"],
  ["secondary", "onSecondary"], ["secondaryContainer", "onSecondaryContainer"],
  ["tertiary", "onTertiary"], ["tertiaryContainer", "onTertiaryContainer"],
  ["error", "onError"], ["errorContainer", "onErrorContainer"],
  ["surface", "onSurface"], ["surfaceContainerHigh", "onSurfaceVariant"],
  ["inverseSurface", "inverseOnSurface"], ["inverseSurface", "inversePrimary"],
] as const;
import { lstarFromArgb } from "@material/material-color-utilities";
for (const seed of ["#006A60", "#6750A4", "#005AC1", "#984061", "#386A20", "#8B6500"]) {
  for (const dark of [false, true]) for (const expressive of [false, true]) for (const contrast of [0, 0.5, 1] as const) {
    test(`Material role contrast: ${seed}, ${dark ? "dark" : "light"}, ${expressive ? "expressive" : "standard"}, ${contrast}`, () => {
      const roles = materialColorRoles(seed, dark, expressive, contrast);
      for (const [container, foreground] of pairs) {
        const ratio = Contrast.ratioOfTones(lstarFromArgb(argbFromHex(roles[container])), lstarFromArgb(argbFromHex(roles[foreground])));
        assert.ok(ratio >= 4.45, `${foreground} on ${container}: ${ratio.toFixed(2)}`);
      }
    });
  }
}

test("Expressive components retain the app's color identity", () => {
  for (const dark of [false, true]) {
    assert.deepEqual(materialColorRoles(APP_COLOR, dark, true, 0), materialColorRoles(APP_COLOR, dark, false, 0));
  }
});

function tones(seed: string) {
  const palette = TonalPalette.fromInt(argbFromHex(seed));
  return Object.fromEntries([0, 10, 20, 30, 40, 50, 60, 70, 80, 90, 95, 99, 100].map((tone) => [String(tone), hexFromArgb(palette.tone(tone))]));
}
const device: DeviceTonalPalettes = {
  accent1: tones("#7848a6"), accent2: tones("#6a596e"), accent3: tones("#885345"),
  neutral1: tones("#626060"), neutral2: tones("#655e68"),
};
test("Material You preserves all of the device's selected color families", () => {
  const light = materialColorRoles(APP_COLOR, false, true, 0, device);
  const dark = materialColorRoles(APP_COLOR, true, true, 0, device);
  assert.equal(light.primary, device.accent1["40"]);
  assert.equal(light.secondary, device.accent2["40"]);
  assert.equal(light.tertiary, device.accent3["40"]);
  assert.equal(light.onSurface, device.neutral1["10"]);
  assert.equal(light.onSurfaceVariant, device.neutral2["30"]);
  assert.equal(dark.primary, device.accent1["80"]);
  assert.notDeepEqual(light, materialColorRoles(APP_COLOR, false, true, 0));
});
test("Android semantic roles preserve its selected style instead of regenerating a seed", () => {
  const exact: DeviceTonalPalettes = { ...device, schemes: {
    light: { primary: "#000000", onPrimary: "#FFFFFF" },
    dark: { primary: "#FFFFFF", onPrimary: "#000000" },
  } };
  assert.equal(materialColorRoles(APP_COLOR, false, true, 0, exact).primary, "#000000");
  assert.equal(materialColorRoles(APP_COLOR, true, true, 0, exact).primary, "#FFFFFF");
  assert.notEqual(materialColorRoles(APP_COLOR, false, true, 0.5, exact).primary, "#000000");
});
for (const dark of [false, true]) for (const contrast of [0, 0.5, 1] as const) {
  test(`Material You role contrast: ${dark ? "dark" : "light"}, ${contrast}`, () => {
    const roles = materialColorRoles(APP_COLOR, dark, true, contrast, device);
    for (const [container, foreground] of pairs) {
      const ratio = Contrast.ratioOfTones(lstarFromArgb(argbFromHex(roles[container])), lstarFromArgb(argbFromHex(roles[foreground])));
      assert.ok(ratio >= 4.45, `${foreground} on ${container}: ${ratio.toFixed(2)}`);
    }
  });
}
