/**
 * Pure helpers for ordo's built-in website WebView (BookmarkBrowser).
 *
 * Keep this file free of react-native so node tests can import it.
 */

/** Schemes the WebView may navigate itself. */
const ALLOWED_SCHEMES = new Set(["http", "https", "about", "blob", "data"]);

/** Schemes that should leave the app (mail, phone, maps, store, app links). */
const EXTERNAL_SCHEMES = new Set([
  "mailto",
  "tel",
  "sms",
  "geo",
  "maps",
  "market",
  "intent",
  "whatsapp",
  "tg",
  "itms",
  "itms-apps",
]);

const BLOCKED_SCHEMES = new Set([
  "javascript",
  "file",
  "content",
  "filesystem",
  "chrome",
  "chrome-extension",
  "moz-extension",
  "safari-extension",
]);

export type WebViewRequestAction = "allow" | "block" | "external";

/**
 * Same-tab navigation shim. `target=_blank` / `window.open` otherwise do
 * nothing when the WebView does not create a second window.
 */
export const BROWSER_NAV_SCRIPT = `(function(){
  if (window.__ordoBrowser) return;
  window.__ordoBrowser = true;
  function go(url) {
    try { if (url) window.location.href = url; } catch (e) {}
  }
  window.open = function(url) {
    if (url) go(url);
    return window;
  };
  document.addEventListener('click', function(e) {
    var n = e.target;
    while (n && n.tagName !== 'A') n = n.parentElement;
    if (!n) return;
    var t = n.getAttribute('target');
    if (t === '_blank' && n.href) {
      e.preventDefault();
      go(n.href);
    }
  }, true);
})();
true;`;

export function webViewUrlScheme(url: string): string {
  const trimmed = url.trim();
  const colon = trimmed.indexOf(":");
  if (colon <= 0) return "";
  return trimmed.slice(0, colon).toLowerCase();
}

/**
 * Decide whether a WebView request should load, open outside ordo, or be
 * dropped. Iframe/ad frames never leave the app.
 */
export function webViewRequestAction(url: string, isTopFrame = true): WebViewRequestAction {
  if (!url) return "block";
  const scheme = webViewUrlScheme(url);
  if (!scheme || BLOCKED_SCHEMES.has(scheme)) return "block";
  if (ALLOWED_SCHEMES.has(scheme)) return "allow";
  if (!isTopFrame) return "block";
  if (EXTERNAL_SCHEMES.has(scheme)) return "external";
  return "external";
}

/** iOS -999 / Chromium aborted navigations are not real load failures. */
export function isCancelledWebViewError(code: number, description = ""): boolean {
  if (code === -999) return true;
  const text = description.toUpperCase();
  return (
    text.includes("ERR_ABORTED") ||
    text.includes("ERR_CONNECTION_CANCELLED") ||
    text.includes("NSURLERRORCANCELLED")
  );
}

/** Hostname for the reader header; skip blank/data documents. */
export function pageHostFromWebViewUrl(url: string): string | null {
  const scheme = webViewUrlScheme(url);
  if (!scheme || scheme === "about" || scheme === "blob" || scheme === "data") return null;
  try {
    const host = new URL(url).hostname.replace(/^www\./, "");
    return host || null;
  } catch {
    return null;
  }
}

/** Finger travel (CSS px) before a top-of-page pull commits a reload. */
export const BROWSER_PTR_THRESHOLD = 72;

export type BrowserPtrPhase = "move" | "end" | "cancel";
export interface BrowserPtrMessage {
  type: "ordo-ptr";
  phase: BrowserPtrPhase;
  dy: number;
}

/**
 * Runs inside the page so the pull is measured where scrolling actually
 * happens. Native UIRefreshControl / wrapping ScrollView never see WebView
 * pans. No MutationObserver — that starves the load.
 */
export const BROWSER_PTR_SCRIPT = `(function(){
  if (window.__ordoPtr) return;
  window.__ordoPtr = true;
  var startY = 0;
  var startX = 0;
  var armed = false;
  var lastDy = 0;
  var lastAt = 0;
  function send(phase, dy) {
    try {
      if (window.ReactNativeWebView && window.ReactNativeWebView.postMessage) {
        window.ReactNativeWebView.postMessage(JSON.stringify({
          type: 'ordo-ptr',
          phase: phase,
          dy: dy
        }));
      }
    } catch (e) {}
  }
  function nodeEl(n) {
    if (!n) return document.documentElement;
    return n.nodeType === 1 ? n : (n.parentElement || document.documentElement);
  }
  function isAtTop(from) {
    var n = nodeEl(from);
    while (n && n !== document && n !== document.documentElement) {
      if (n.scrollHeight > n.clientHeight + 1 && n.scrollTop > 1) return false;
      n = n.parentElement;
    }
    var se = document.scrollingElement || document.documentElement;
    if (se && se.scrollTop > 1) return false;
    if (document.body && document.body.scrollTop > 1) return false;
    if ((window.scrollY || window.pageYOffset || 0) > 1) return false;
    return true;
  }
  document.addEventListener('touchstart', function(e) {
    if (!e.touches || e.touches.length !== 1) { armed = false; return; }
    startY = e.touches[0].clientY;
    startX = e.touches[0].clientX;
    armed = isAtTop(e.target);
    lastDy = 0;
    lastAt = 0;
  }, { capture: true, passive: true });
  document.addEventListener('touchmove', function(e) {
    if (!armed || !e.touches || e.touches.length !== 1) return;
    var dy = e.touches[0].clientY - startY;
    var dx = e.touches[0].clientX - startX;
    if (Math.abs(dx) > 24 && Math.abs(dx) > dy) {
      armed = false;
      send('cancel', 0);
      return;
    }
    if (dy < 0) return;
    if (!isAtTop(e.target)) {
      armed = false;
      send('cancel', 0);
      return;
    }
    var now = Date.now();
    if (Math.abs(dy - lastDy) < 6 && now - lastAt < 32) return;
    lastDy = dy;
    lastAt = now;
    send('move', dy);
  }, { capture: true, passive: true });
  function finish(e) {
    if (!armed) return;
    armed = false;
    var y = e.changedTouches && e.changedTouches[0] ? e.changedTouches[0].clientY : startY;
    send('end', y - startY);
  }
  document.addEventListener('touchend', finish, { capture: true, passive: true });
  document.addEventListener('touchcancel', function() {
    if (!armed) return;
    armed = false;
    send('cancel', 0);
  }, { capture: true, passive: true });
})();
true;`;

export function parseBrowserPtrMessage(raw: string): BrowserPtrMessage | null {
  try {
    const data = JSON.parse(raw) as { type?: unknown; phase?: unknown; dy?: unknown };
    if (data?.type !== "ordo-ptr") return null;
    if (data.phase !== "move" && data.phase !== "end" && data.phase !== "cancel") return null;
    const dy = Number(data.dy);
    return { type: "ordo-ptr", phase: data.phase, dy: Number.isFinite(dy) ? dy : 0 };
  } catch {
    return null;
  }
}

export function shouldCommitBrowserPtr(dy: number, refreshing: boolean): boolean {
  return !refreshing && dy >= BROWSER_PTR_THRESHOLD;
}

export function browserPtrHudOpacity(dy: number, refreshing: boolean): number {
  if (refreshing) return 1;
  if (dy <= 0) return 0;
  return Math.min(1, dy / 48);
}

export function browserPtrHudOffset(dy: number): number {
  return Math.min(Math.max(dy, 0) * 0.4, 36);
}

/** Hex colors we inject into the document canvas (palette tokens). */
const CHROME_HEX = /^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/;

export function isBrowserChromeColor(value: string): boolean {
  return CHROME_HEX.test(value.trim());
}

/**
 * Document-start paint so a reload is not a white blank. No !important, so
 * the site's own CSS can replace it. Force-dark invert still wins later.
 */
export function browserCanvasScript(background: string): string {
  const color = background.trim();
  if (!isBrowserChromeColor(color)) return "true;";
  return `(function(){
  try {
    var s = document.getElementById('ordo-browser-chrome') || document.createElement('style');
    s.id = 'ordo-browser-chrome';
    s.textContent = 'html,body{background-color:${color}}';
    var p = document.head || document.documentElement;
    if (!s.parentNode) p.insertBefore(s, p.firstChild);
  } catch (e) {}
})();
true;`;
}

/** Cover the WebView until the new document has finished replacing the blank. */
export function browserBlankCoverVisible(
  loading: boolean,
  progress: number,
  hasError: boolean,
): boolean {
  if (hasError || !loading) return false;
  return progress < 1;
}

/** Width 0–1 of the top loading bar. A hair of width so a 0% load is visible. */
export function browserProgressBarWidth(progress: number, loading: boolean): number {
  if (!loading) return 0;
  if (progress <= 0) return 0.03;
  return Math.min(progress, 1);
}

export function browserInjectedJavaScript(extraScript = "true;", canvasBackground?: string): string {
  const canvas =
    canvasBackground && isBrowserChromeColor(canvasBackground)
      ? `${browserCanvasScript(canvasBackground)}\n`
      : "";
  return `${BROWSER_NAV_SCRIPT}\n${BROWSER_PTR_SCRIPT}\n${canvas}${extraScript}`;
}
