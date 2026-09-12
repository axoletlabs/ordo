/**
 * Force-dark for ordo's in-app website WebView.
 *
 * Android's WebView `forceDarkOn` is a no-op when the app targets API 33+,
 * and iOS has no equivalent. Ask the page for its own dark theme first
 * (`color-scheme`, `prefers-color-scheme`, common theme attributes). Invert
 * only surfaces that are still light after that.
 *
 * Filter `body`, not `html`: a root filter misses sticky/fixed chrome
 * (GitHub's header and README bar stay white). Do not re-invert
 * `[style*="background-image"]` — that un-inverts whole layout subtrees.
 *
 * The luminance helpers are the TypeScript source of truth; the injected
 * script inlines the same heuristic (keep them in sync).
 */

/** Class toggled on <html> when the page still looks light. */
export const WEBSITE_FORCE_DARK_INVERT_CLASS = "ordo-force-dark-invert";

/** Relative luminance above this is treated as a light page that needs invert. */
export const FORCE_DARK_LIGHT_LUMINANCE = 0.5;

/**
 * Large page surfaces sampled before html/body. `color-scheme: dark` paints
 * the root canvas dark even on light sites; those wrappers are the real page.
 */
export const FORCE_DARK_CONTENT_SELECTORS = [
  "main",
  '[role="main"]',
  "#root",
  "#__next",
  "#app",
  ".application-main",
] as const;

/** Theme attributes flipped to dark when the site already exposes them. */
export const NATIVE_DARK_ATTRIBUTES: Readonly<Record<string, readonly string[]>> = {
  "data-color-mode": ["auto", "light"],
  "data-theme": ["auto", "light", "system"],
  "data-bs-theme": ["auto", "light"],
};

/**
 * Relative luminance 0–1 for an `rgb()` / `rgba()` CSS color or `#rgb` hex.
 * Transparent / unparseable values return null so callers can skip them.
 */
export function cssColorLuminance(color: string | null | undefined): number | null {
  const channels = cssColorChannels(color);
  if (!channels) return null;
  return (0.2126 * channels[0] + 0.7152 * channels[1] + 0.0722 * channels[2]) / 255;
}

/** `r,g,b` key for comparing a computed color to the browser-chrome paint. */
export function cssColorChannelKey(color: string | null | undefined): string | null {
  const channels = cssColorChannels(color);
  return channels ? channels.join(",") : null;
}

export function isForceDarkChromePaint(
  color: string | null | undefined,
  chromeColor: string | null | undefined,
): boolean {
  const sample = cssColorChannelKey(color);
  const chrome = cssColorChannelKey(chromeColor);
  return sample != null && sample === chrome;
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
 * Content first — it is the page surface. Html is skipped while inverted
 * because the invert stylesheet paints it. Colors that match ordo's reload
 * canvas are ignored so that paint cannot cancel invert.
 */
export function forceDarkBackgroundSamples(
  htmlBackground: string | null | undefined,
  bodyBackground: string | null | undefined,
  inverted: boolean,
  contentBackgrounds: ReadonlyArray<string | null | undefined> = [],
  chromeColor?: string | null,
): Array<string | null | undefined> {
  const skipChrome = (color: string | null | undefined) =>
    isForceDarkChromePaint(color, chromeColor) ? null : color;
  const content = contentBackgrounds.map(skipChrome);
  if (inverted) return [...content, skipChrome(bodyBackground)];
  return [...content, skipChrome(bodyBackground), skipChrome(htmlBackground)];
}

export function pageNeedsForceDarkInvert(
  htmlBackground: string | null | undefined,
  bodyBackground: string | null | undefined,
  inverted: boolean,
  contentBackgrounds: ReadonlyArray<string | null | undefined> = [],
  chromeColor?: string | null,
): boolean {
  return shouldInvertForForceDark(
    forceDarkBackgroundSamples(
      htmlBackground,
      bodyBackground,
      inverted,
      contentBackgrounds,
      chromeColor,
    ),
  );
}

/**
 * Sites that already advertise a theme switcher: only rewrite values they
 * already set (GitHub `data-color-mode="auto"`, Bootstrap `data-bs-theme`).
 */
export function nativeDarkAttributeUpdates(
  attributes: Readonly<Record<string, string | null | undefined>>,
): Record<string, string> {
  const updates: Record<string, string> = {};
  for (const [name, from] of Object.entries(NATIVE_DARK_ATTRIBUTES)) {
    const current = attributes[name];
    if (current && from.includes(current)) updates[name] = "dark";
  }
  return updates;
}

function cssColorChannels(color: string | null | undefined): [number, number, number] | null {
  if (!color) return null;
  const normalized = color.trim().toLowerCase();
  if (normalized === "transparent" || normalized === "rgba(0, 0, 0, 0)") return null;
  const hex = normalized.match(/^#([0-9a-f]{3}|[0-9a-f]{6})$/);
  if (hex) {
    let value = hex[1];
    if (value.length === 3) {
      value = `${value[0]}${value[0]}${value[1]}${value[1]}${value[2]}${value[2]}`;
    }
    return [
      Number.parseInt(value.slice(0, 2), 16),
      Number.parseInt(value.slice(2, 4), 16),
      Number.parseInt(value.slice(4, 6), 16),
    ];
  }
  const match = color.match(/rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)/i);
  if (!match) return null;
  return [Number(match[1]), Number(match[2]), Number(match[3])];
}

/**
 * Document-start + load user script. Ends with `true;` for iOS WKWebView.
 *
 * No MutationObserver: watching html/head during parse starves the load so
 * the WebView never reaches onLoadEnd. Keep the invert heuristic in sync
 * with `pageNeedsForceDarkInvert`.
 */
export const WEBSITE_FORCE_DARK_SCRIPT = `(function(){
  var CLASS_NAME = '${WEBSITE_FORCE_DARK_INVERT_CLASS}';
  var STYLE_ID = 'ordo-force-dark-style';
  var LIGHT = ${FORCE_DARK_LIGHT_LUMINANCE};
  var CONTENT_SEL = ${JSON.stringify(FORCE_DARK_CONTENT_SELECTORS)};
  var THEME_ATTR = ${JSON.stringify(NATIVE_DARK_ATTRIBUTES)};
  var SCHEME_CSS = 'html{color-scheme:dark!important}';
  var INVERT_CSS =
    'html{background-color:#111!important}' +
    'html.' + CLASS_NAME + '>body{filter:invert(1) hue-rotate(180deg)!important}' +
    'html.' + CLASS_NAME + ' img,html.' + CLASS_NAME + ' video,' +
    'html.' + CLASS_NAME + ' picture,html.' + CLASS_NAME + ' canvas' +
    '{filter:invert(1) hue-rotate(180deg)!important}';
  function channels(color) {
    if (!color) return null;
    var n = String(color).trim().toLowerCase();
    if (n === 'transparent' || n === 'rgba(0, 0, 0, 0)') return null;
    var hex = n.match(/^#([0-9a-f]{3}|[0-9a-f]{6})$/);
    if (hex) {
      var h = hex[1];
      if (h.length === 3) h = h.charAt(0) + h.charAt(0) + h.charAt(1) + h.charAt(1) + h.charAt(2) + h.charAt(2);
      return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)];
    }
    var m = String(color).match(/rgba?\\(\\s*(\\d+)\\s*,\\s*(\\d+)\\s*,\\s*(\\d+)/i);
    if (!m) return null;
    return [Number(m[1]), Number(m[2]), Number(m[3])];
  }
  function colorKey(color) {
    var c = channels(color);
    return c ? c.join(',') : null;
  }
  function chromeKey() {
    var s = document.getElementById('ordo-browser-chrome');
    if (!s || !s.textContent) return null;
    var m = String(s.textContent).match(/background-color:\\s*([^;}]+)/);
    return m ? colorKey(m[1]) : null;
  }
  function luminance(color, painted) {
    var key = colorKey(color);
    if (key && painted && key === painted) return null;
    var c = channels(color);
    if (!c) return null;
    return (0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2]) / 255;
  }
  function contentBackgrounds() {
    var colors = [];
    for (var i = 0; i < CONTENT_SEL.length; i++) {
      var el = document.querySelector(CONTENT_SEL[i]);
      if (el) colors.push(getComputedStyle(el).backgroundColor);
    }
    try {
      var x = Math.round((window.innerWidth || 0) / 2);
      var y = Math.round((window.innerHeight || 0) * 0.4);
      var stack = document.elementsFromPoint ? document.elementsFromPoint(x, y) : [];
      for (var j = 0; j < stack.length && j < 8; j++) {
        var n = stack[j];
        if (!n || n === document.documentElement || n === document.body) continue;
        colors.push(getComputedStyle(n).backgroundColor);
      }
    } catch (e) {}
    return colors;
  }
  function shouldInvert(htmlBg, bodyBg, inverted, extras, painted) {
    var colors = extras ? extras.slice() : [];
    colors.push(bodyBg);
    if (!inverted) colors.push(htmlBg);
    for (var i = 0; i < colors.length; i++) {
      var L = luminance(colors[i], painted);
      if (L != null) return L > LIGHT;
    }
    return true;
  }
  function preferNativeDark(root) {
    try { root.style.colorScheme = 'dark'; } catch (e) {}
    var head = document.head || root;
    var meta = document.querySelector('meta[name="color-scheme"]');
    if (!meta) {
      meta = document.createElement('meta');
      meta.setAttribute('name', 'color-scheme');
      head.insertBefore(meta, head.firstChild);
    }
    meta.setAttribute('content', 'dark');
    for (var name in THEME_ATTR) {
      if (!Object.prototype.hasOwnProperty.call(THEME_ATTR, name)) continue;
      var current = root.getAttribute(name);
      if (current && THEME_ATTR[name].indexOf(current) !== -1) {
        root.setAttribute(name, 'dark');
      }
    }
  }
  function installMatchMedia() {
    if (window.__ordoForceDarkMedia || typeof window.matchMedia !== 'function') return;
    window.__ordoForceDarkMedia = true;
    var original = window.matchMedia.bind(window);
    window.matchMedia = function(query) {
      var q = String(query || '');
      var mql = original(q);
      var dark = /prefers-color-scheme:\\s*dark/i.test(q);
      var light = /prefers-color-scheme:\\s*light/i.test(q);
      if (!dark && !light) return mql;
      return {
        matches: dark,
        media: q,
        onchange: null,
        addListener: function(fn) { if (mql.addListener) mql.addListener(fn); },
        removeListener: function(fn) { if (mql.removeListener) mql.removeListener(fn); },
        addEventListener: function(t, fn) { if (mql.addEventListener) mql.addEventListener(t, fn); },
        removeEventListener: function(t, fn) { if (mql.removeEventListener) mql.removeEventListener(t, fn); },
        dispatchEvent: function(e) { return mql.dispatchEvent ? mql.dispatchEvent(e) : false; }
      };
    };
  }
  function ensureStyle() {
    var root = document.documentElement;
    if (!root) return null;
    var style = document.getElementById(STYLE_ID);
    if (style) return style;
    style = document.createElement('style');
    style.id = STYLE_ID;
    var parent = document.head || root;
    parent.appendChild(style);
    return style;
  }
  function isInverted(style) {
    return !!(style && style.textContent && style.textContent.indexOf('invert(1)') !== -1);
  }
  function paintInvert(style, root, on) {
    style.textContent = SCHEME_CSS + (on ? INVERT_CSS : '');
    if (on) root.classList.add(CLASS_NAME);
    else root.classList.remove(CLASS_NAME);
  }
  function applyInvert() {
    try {
      var style = ensureStyle();
      var root = document.documentElement;
      var body = document.body;
      if (!root || !style) return;
      preferNativeDark(root);
      var inverted = isInverted(style) || root.classList.contains(CLASS_NAME);
      var htmlBg = getComputedStyle(root).backgroundColor;
      var bodyBg = body ? getComputedStyle(body).backgroundColor : null;
      paintInvert(
        style,
        root,
        shouldInvert(htmlBg, bodyBg, inverted, contentBackgrounds(), chromeKey())
      );
    } catch (e) {}
  }
  function boot() {
    installMatchMedia();
    try {
      var style = ensureStyle();
      var root = document.documentElement;
      if (root) preferNativeDark(root);
      if (style && root) paintInvert(style, root, true);
    } catch (e) {}
    var refine = function() { applyInvert(); };
    if (typeof requestAnimationFrame === 'function') requestAnimationFrame(refine);
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', refine);
    } else {
      refine();
    }
    var delays = [0, 250, 1000, 2200];
    for (var i = 0; i < delays.length; i++) setTimeout(refine, delays[i]);
  }
  if (window.__ordoForceDark) {
    applyInvert();
  } else {
    window.__ordoForceDark = true;
    boot();
  }
})();
true;`;
