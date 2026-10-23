import { APP_COLOR } from "./material-colors";

/** Seeds generate every Material role, including accessible light/dark pairs. */
export const APP_PALETTES = [
  { name: "Teal", seed: APP_COLOR },
  { name: "Blue", seed: "#3568B4" },
  { name: "Violet", seed: "#7856A8" },
  { name: "Rose", seed: "#A84B78" },
  { name: "Coral", seed: "#B6533C" },
  { name: "Amber", seed: "#936B00" },
  { name: "Green", seed: "#527A39" },
  { name: "Slate", seed: "#526574" },
] as const;

/** Accept familiar RGB shorthand, with or without #; reject alpha and CSS. */
export function normalizeAppColor(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const hex = value.trim().replace(/^#/, "");
  if (/^[\da-f]{3}$/i.test(hex)) {
    return `#${hex.split("").map((digit) => digit + digit).join("")}`.toUpperCase();
  }
  return /^[\da-f]{6}$/i.test(hex) ? `#${hex.toUpperCase()}` : null;
}

export function appPaletteName(seed: string): string {
  return APP_PALETTES.find((option) => option.seed === seed)?.name ?? "Custom";
}
