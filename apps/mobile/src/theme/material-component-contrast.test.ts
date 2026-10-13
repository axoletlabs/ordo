import assert from "node:assert/strict";
import { test } from "node:test";
import { argbFromHex, Contrast, lstarFromArgb } from "@material/material-color-utilities";
import { materialColorRoles } from "./material-colors.ts";

function ratio(foreground: string, background: string): number {
  return Contrast.ratioOfTones(lstarFromArgb(argbFromHex(foreground)), lstarFromArgb(argbFromHex(background)));
}

for (const seed of ["#006A60", "#6750A4", "#005AC1", "#984061", "#386A20", "#8B6500"]) {
  for (const dark of [false, true]) for (const contrast of [0, 0.5, 1] as const) {
    test(`Component contrast: ${seed}, ${dark ? "dark" : "light"}, ${contrast}`, () => {
      const roles = materialColorRoles(seed, dark, false, contrast);
      // Lists, dialogs, fields, menus, and settings use the full tonal hierarchy.
      for (const surface of [roles.surface, roles.surfaceContainerLowest, roles.surfaceContainerLow,
        roles.surfaceContainer, roles.surfaceContainerHigh, roles.surfaceContainerHighest]) {
        for (const text of [roles.onSurface, roles.onSurfaceVariant]) {
          // Allow only the generator's integer RGB rounding tolerance.
          assert.ok(ratio(text, surface) >= 4.45, `Supporting text on ${surface}: ${ratio(text, surface).toFixed(2)}`);
        }
      }
      // Empty OTP cells and filled-field indicators need outline, not outlineVariant.
      for (const surface of [roles.surface, roles.surfaceContainerHigh, roles.surfaceContainerHighest]) {
        assert.ok(ratio(roles.outline, surface) >= 3, `Field boundary: ${ratio(roles.outline, surface).toFixed(2)}`);
        assert.ok(ratio(roles.primary, surface) >= 3, `Focus indicator: ${ratio(roles.primary, surface).toFixed(2)}`);
      }
    });
  }
}
