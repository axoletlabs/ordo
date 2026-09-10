/**
 * Force-dark for ordo's in-app website WebView.
 *
 * Android's WebView `forceDarkOn` is a no-op when the app targets API 33+,
 * and iOS has no equivalent, so this injects a user script that inverts
 * pages that are still light after styles apply.
 *
 * The luminance helpers are the TypeScript source of truth; the injected
 * script inlines the same heuristic (keep them in sync).
 */

/** Class toggled on <html> when the page still looks light. */
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
 * Body first — it is the page surface. Html is skipped while inverted because
 * the invert stylesheet paints it, which would otherwise look like a dark
 * page and undo the filter.
 */
export function forceDarkBackgroundSamples(
  htmlBackground: string | null | undefined,
  bodyBackground: string | null | undefined,
  inverted: boolean,
): Array<string | null | undefined> {
  if (inverted) return [bodyBackground];
  return [bodyBackground, htmlBackground];
}

export function pageNeedsForceDarkInvert(
  htmlBackground: string | null | undefined,
  bodyBackground: string | null | undefined,
  inverted: boolean,
): boolean {
  return shouldInvertForForceDark(
    forceDarkBackgroundSamples(htmlBackground, bodyBackground, inverted),
  );
}

/**
 * Document-start + load user script. Ends with `true;` for iOS WKWebView.
 * Keep the invert heuristic in sync with `pageNeedsForceDarkInvert`.
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
  function shouldInvert(htmlBg, bodyBg, inverted) {
    var colors = inverted ? [bodyBg] : [bodyBg, htmlBg];
    for (var i = 0; i < colors.length; i++) {
      var L = luminance(colors[i]);
      if (L != null) return L > LIGHT;
    }
    return true;
  }
  var INVERT_CSS =
    'html{background-color:#fff!important;filter:invert(1) hue-rotate(180deg)!important}' +
    'html img,html video,html picture,html canvas,html [style*="background-image"]' +
    '{filter:invert(1) hue-rotate(180deg)!important}';
  function ensureStyle() {
    var root = document.documentElement;
    if (!root) return null;
    var head = document.head || root;
    var style = document.getElementById(STYLE_ID);
    if (!style) {
      style = document.createElement('style');
      style.id = STYLE_ID;
      head.appendChild(style);
    }
    return style;
  }
  function isInverted(style) {
    return !!(style && style.textContent && style.textContent.indexOf('invert(1)') !== -1);
  }
  function applyInvert() {
    try {
      var style = ensureStyle();
      var root = document.documentElement;
      var body = document.body;
      if (!root || !style) return;
      var inverted = isInverted(style) || root.classList.contains(CLASS_NAME);
      var htmlBg = getComputedStyle(root).backgroundColor;
      var bodyBg = body ? getComputedStyle(body).backgroundColor : null;
      if (shouldInvert(htmlBg, bodyBg, inverted)) {
        style.textContent = INVERT_CSS;
        root.classList.add(CLASS_NAME);
      } else {
        style.textContent = '';
        root.classList.remove(CLASS_NAME);
      }
    } catch (e) {}
  }
  function watch() {
    if (window.__ordoForceDarkWatch) return;
    window.__ordoForceDarkWatch = true;
    var root = document.documentElement;
    if (!root || typeof MutationObserver === 'undefined') return;
    var obs = new MutationObserver(function() {
      ensureStyle();
      applyInvert();
    });
    obs.observe(root, { attributes: true, attributeFilter: ['class', 'style'] });
    var host = document.head || root;
    obs.observe(host, { childList: true });
    if (document.body) {
      obs.observe(document.body, { attributes: true, attributeFilter: ['class', 'style'] });
    }
  }
  function boot() {
    ensureStyle();
    applyInvert();
    watch();
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', function() {
        applyInvert();
        watch();
      });
    }
    var delays = [50, 400, 1200, 2500];
    for (var i = 0; i < delays.length; i++) setTimeout(applyInvert, delays[i]);
  }
  if (window.__ordoForceDark) {
    applyInvert();
  } else {
    window.__ordoForceDark = true;
    boot();
  }
})();
true;`;
