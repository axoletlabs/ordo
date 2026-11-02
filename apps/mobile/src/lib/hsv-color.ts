/** HSV helpers for the custom app-color picker. Hue is 0–360; s and v are 0–1. */
export type Hsv = { h: number; s: number; v: number };

export function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

export function clampHsv({ h, s, v }: Hsv): Hsv {
  return { h: ((h % 360) + 360) % 360, s: clamp(s, 0, 1), v: clamp(v, 0, 1) };
}

function channel(value: number) {
  return Math.round(clamp(value, 0, 1) * 255);
}

function toHex(value: number) {
  return value.toString(16).padStart(2, "0").toUpperCase();
}

/** Accept #RGB / #RRGGBB, with or without the leading #. */
export function parseHexColor(value: string): string | null {
  const hex = value.trim().replace(/^#/, "");
  if (/^[\da-f]{3}$/i.test(hex)) {
    return `#${hex.split("").map((digit) => digit + digit).join("")}`.toUpperCase();
  }
  return /^[\da-f]{6}$/i.test(hex) ? `#${hex.toUpperCase()}` : null;
}

export function hsvToRgb({ h, s, v }: Hsv) {
  const hsv = clampHsv({ h, s, v });
  const chroma = hsv.v * hsv.s;
  const x = chroma * (1 - Math.abs((hsv.h / 60) % 2 - 1));
  const m = hsv.v - chroma;
  const sector = Math.floor(hsv.h / 60) % 6;
  const [r, g, b] = sector === 0 ? [chroma, x, 0]
    : sector === 1 ? [x, chroma, 0]
    : sector === 2 ? [0, chroma, x]
    : sector === 3 ? [0, x, chroma]
    : sector === 4 ? [x, 0, chroma]
    : [chroma, 0, x];
  return { r: channel(r + m), g: channel(g + m), b: channel(b + m) };
}

export function hsvToHex(hsv: Hsv): string {
  const { r, g, b } = hsvToRgb(hsv);
  return `#${toHex(r)}${toHex(g)}${toHex(b)}`;
}

export function hexToRgb(value: string): { r: number; g: number; b: number } | null {
  const hex = parseHexColor(value);
  if (!hex) return null;
  return {
    r: Number.parseInt(hex.slice(1, 3), 16),
    g: Number.parseInt(hex.slice(3, 5), 16),
    b: Number.parseInt(hex.slice(5, 7), 16),
  };
}

export function hexToHsv(value: string): Hsv | null {
  const rgb = hexToRgb(value);
  if (!rgb) return null;
  const r = rgb.r / 255, g = rgb.g / 255, b = rgb.b / 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b);
  const delta = max - min;
  let h = 0;
  if (delta !== 0) {
    if (max === r) h = ((g - b) / delta + (g < b ? 6 : 0)) * 60;
    else if (max === g) h = ((b - r) / delta + 2) * 60;
    else h = ((r - g) / delta + 4) * 60;
  }
  return { h, s: max === 0 ? 0 : delta / max, v: max };
}

/** Fully saturated, fully bright color for a hue slider fill. */
export function hueHex(h: number): string {
  return hsvToHex({ h, s: 1, v: 1 });
}
