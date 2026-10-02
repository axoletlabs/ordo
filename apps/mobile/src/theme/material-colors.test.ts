import assert from "node:assert/strict";
import { test } from "node:test";
import { materialColorRoles } from "./material-colors.ts";
import { argbFromHex, Contrast } from "@material/material-color-utilities";

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
