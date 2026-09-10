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

/**
 * Android: the wrapping ScrollView must only intercept when the page is at
 * the top, otherwise it steals vertical pans from the WebView.
 */
export function androidPullToRefreshScrollEnabled(contentOffsetY: number): boolean {
  return contentOffsetY <= 0.5;
}

/** Width 0–1 of the top loading bar. A hair of width so a 0% load is visible. */
export function browserProgressBarWidth(progress: number, loading: boolean): number {
  if (!loading) return 0;
  if (progress <= 0) return 0.03;
  return Math.min(progress, 1);
}

export function browserInjectedJavaScript(extraScript = "true;"): string {
  return `${BROWSER_NAV_SCRIPT}\n${extraScript}`;
}
