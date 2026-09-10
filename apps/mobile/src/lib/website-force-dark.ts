/**
 * Force-dark for ordo's in-app website WebView.
 *
 * Android's WebView `forceDarkOn` is a no-op when the app targets API 33+,
 * and iOS has no equivalent, so this injects `color-scheme: dark` (so pages
 * that already ship a dark theme can use it) and algorithmically inverts
 * pages that are still light after styles apply.
 *
 * The luminance helpers are the TypeScript source of truth; the injected
 * script inlines the same heuristic (keep them in sync).
 */

/** Class toggled on <html> when the page still looks light after color-scheme. */
export const WEBSITE_FORCE_DARK_INVERT_CLASS = "ordo-force-dark-invert";

/** Relative luminance above this is treated as a light page that needs invert. */
export const FORCE_DARK_LIGHT_LUMINANCE = 0.5;

/**
 * Relative luminance 0–1 for an `rgb()` / `rgba()` CSS color.
 * Transparent / unparseable values return null so callers can skip them.
 */
export function cssColorLuminance(color: string | null | undefined): number | null {
  if (!color) return null;
  const normalized = color.trim().toLowerCase();
  if (normalized === "transparent" || normalized === "rgba(0, 0, 0, 0)") return null;
  const match = color.match(/rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)/i);
  if (!match) return null;
  return (0.2126 * Number(match[1]) + 0.7152 * Number(match[2]) + 0.0722 * Number(match[3])) / 255;
}

/**
 * Invert when every sampled background is missing, or the first parseable
 * sample is light. Dark-themed pages (luminance ≤ threshold) are left alone.
 */
export function shouldInvertForForceDark(
  backgroundColors: ReadonlyArray<string | null | undefined>,
): boolean {
  for (const color of backgroundColors) {
    const luminance = cssColorLuminance(color);
    if (luminance != null) return luminance > FORCE_DARK_LIGHT_LUMINANCE;
  }
  return true;
}

/**
 * Document-start + load user script. Ends with `true;` for iOS WKWebView.
 * Keep the invert heuristic in sync with `shouldInvertForForceDark`.
 */
export const WEBSITE_FORCE_DARK_SCRIPT = `(function(){
  var CLASS_NAME = '${WEBSITE_FORCE_DARK_INVERT_CLASS}';
  var STYLE_ID = 'ordo-force-dark-style';
  var LIGHT = ${FORCE_DARK_LIGHT_LUMINANCE};
  function luminance(color) {
    if (!color) return null;
    var n = String(color).trim().toLowerCase();
    if (n === 'transparent' || n === 'rgba(0, 0, 0, 0)') return null;
    var m = String(color).match(/rgba?\\(\\s*(\\d+)\\s*,\\s*(\\d+)\\s*,\\s*(\\d+)/i);
    if (!m) return null;
    return (0.2126 * m[1] + 0.7152 * m[2] + 0.0722 * m[3]) / 255;
  }
  function shouldInvert(colors) {
    for (var i = 0; i < colors.length; i++) {
      var L = luminance(colors[i]);
      if (L != null) return L > LIGHT;
    }
    return true;
  }
  function ensureStyle() {
    var root = document.documentElement;
    if (!root) return;
    root.style.colorScheme = 'dark';
    var head = document.head || root;
    if (!document.querySelector('meta[name="color-scheme"]')) {
      var meta = document.createElement('meta');
      meta.setAttribute('name', 'color-scheme');
      meta.setAttribute('content', 'dark');
      head.insertBefore(meta, head.firstChild);
    }
    if (document.getElementById(STYLE_ID)) return;
    var style = document.createElement('style');
    style.id = STYLE_ID;
    style.textContent =
      'html{color-scheme:dark!important}' +
      'html.' + CLASS_NAME + '{background-color:#111!important;filter:invert(1) hue-rotate(180deg)!important}' +
      'html.' + CLASS_NAME + ' img,html.' + CLASS_NAME + ' video,html.' + CLASS_NAME + ' picture,' +
      'html.' + CLASS_NAME + ' canvas,html.' + CLASS_NAME + ' [style*="background-image"]' +
      '{filter:invert(1) hue-rotate(180deg)!important}';
    head.appendChild(style);
  }
  function applyInvert() {
    try {
      ensureStyle();
      var root = document.documentElement;
      var body = document.body;
      if (!root) return;
      var samples = [];
      if (root) samples.push(getComputedStyle(root).backgroundColor);
      if (body) samples.push(getComputedStyle(body).backgroundColor);
      if (shouldInvert(samples)) root.classList.add(CLASS_NAME);
      else root.classList.remove(CLASS_NAME);
    } catch (e) {}
  }
  try { ensureStyle(); } catch (e) {}
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', applyInvert);
  } else {
    applyInvert();
  }
  setTimeout(applyInvert, 400);
})();
true;`;
