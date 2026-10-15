import assert from "node:assert/strict";
import { test } from "node:test";
import { runInNewContext } from "node:vm";
import {
  BROWSER_NAV_SCRIPT,
  BROWSER_PTR_SCRIPT,
  BROWSER_PTR_THRESHOLD,
  browserBlankCoverVisible,
  browserCanvasScript,
  browserInjectedJavaScript,
  browserProgressBarWidth,
  browserPtrHudOffset,
  browserPtrHudOpacity,
  isCancelledWebViewError,
  pageHostFromWebViewUrl,
  parseBrowserPtrMessage,
  shouldCommitBrowserPtr,
  webViewRequestAction,
  webViewUrlScheme,
} from "./in-app-browser.ts";

test("webViewUrlScheme reads the scheme case-insensitively", () => {
  assert.equal(webViewUrlScheme("HTTPS://example.com"), "https");
  assert.equal(webViewUrlScheme(" mailto:a@b.c"), "mailto");
  assert.equal(webViewUrlScheme("not-a-url"), "");
});

test("http(s) and in-page documents load in the WebView", () => {
  assert.equal(webViewRequestAction("https://example.com/path"), "allow");
  assert.equal(webViewRequestAction("http://example.com"), "allow");
  assert.equal(webViewRequestAction("about:blank"), "allow");
  assert.equal(webViewRequestAction("about:srcdoc"), "allow");
  assert.equal(webViewRequestAction("blob:https://example.com/1"), "allow");
  assert.equal(webViewRequestAction("data:text/html,hi", false), "allow");
  assert.equal(webViewRequestAction("data:text/html,hi"), "block");
});

test("javascript, local files, and intent URLs never load", () => {
  assert.equal(webViewRequestAction("javascript:alert(1)"), "block");
  assert.equal(webViewRequestAction("file:///etc/passwd"), "block");
  assert.equal(webViewRequestAction("content://media/1"), "block");
  assert.equal(webViewRequestAction("intent://scan/#Intent;end"), "block");
  assert.equal(webViewRequestAction("package:com.evil"), "block");
  assert.equal(webViewRequestAction("unknown-scheme:foo"), "block");
  assert.equal(webViewRequestAction(""), "block");
});

test("mail and phone links leave the app on the top frame only", () => {
  assert.equal(webViewRequestAction("mailto:hi@example.com"), "external");
  assert.equal(webViewRequestAction("tel:+1555"), "external");
  assert.equal(webViewRequestAction("sms:+1555"), "external");
  assert.equal(webViewRequestAction("mailto:hi@example.com", false), "block");
});

test("cancelled navigations are not shown as failures", () => {
  assert.equal(isCancelledWebViewError(-999), true);
  assert.equal(isCancelledWebViewError(-3, "net::ERR_ABORTED"), true);
  assert.equal(isCancelledWebViewError(-2, "net::ERR_NAME_NOT_RESOLVED"), false);
});

test("pageHostFromWebViewUrl strips www and skips blank documents", () => {
  assert.equal(pageHostFromWebViewUrl("https://www.example.com/a"), "example.com");
  assert.equal(pageHostFromWebViewUrl("about:blank"), null);
  assert.equal(pageHostFromWebViewUrl("data:text/html,x"), null);
});

test("pull-to-refresh commits only after a long enough pull at rest", () => {
  assert.equal(shouldCommitBrowserPtr(0, false), false);
  assert.equal(shouldCommitBrowserPtr(BROWSER_PTR_THRESHOLD - 1, false), false);
  assert.equal(shouldCommitBrowserPtr(BROWSER_PTR_THRESHOLD, false), true);
  assert.equal(shouldCommitBrowserPtr(200, true), false);
});

test("parseBrowserPtrMessage ignores unrelated WebView messages", () => {
  assert.equal(parseBrowserPtrMessage("not-json"), null);
  assert.equal(parseBrowserPtrMessage('{"hello":1}'), null);
  assert.deepEqual(parseBrowserPtrMessage('{"type":"ordo-ptr","phase":"end","dy":80}'), {
    type: "ordo-ptr",
    phase: "end",
    dy: 80,
  });
});

test("ptr hud follows the pull then holds while refreshing", () => {
  assert.equal(browserPtrHudOpacity(0, false), 0);
  assert.equal(browserPtrHudOpacity(48, false), 1);
  assert.equal(browserPtrHudOpacity(0, true), 1);
  assert.equal(browserPtrHudOffset(0), 0);
  assert.ok(browserPtrHudOffset(40) > 0);
});

test("ptr script listens for touches without observing the tree", () => {
  assert.match(BROWSER_PTR_SCRIPT, /ordo-ptr/);
  assert.match(BROWSER_PTR_SCRIPT, /touchstart/);
  assert.match(BROWSER_PTR_SCRIPT, /touchend/);
  assert.doesNotMatch(BROWSER_PTR_SCRIPT, /MutationObserver/);
  assert.match(BROWSER_PTR_SCRIPT, /true;\s*$/);
});

test("progress bar stays visible during load and has a minimum width", () => {
  assert.equal(browserProgressBarWidth(0, true), 0.03);
  assert.equal(browserProgressBarWidth(0.4, true), 0.4);
  assert.equal(browserProgressBarWidth(1, true), 1);
  assert.equal(browserProgressBarWidth(0.4, false), 0);
});

test("navigation shim rewrites new windows without observing the tree", () => {
  assert.match(BROWSER_NAV_SCRIPT, /window\.open/);
  assert.match(BROWSER_NAV_SCRIPT, /_blank/);
  assert.doesNotMatch(BROWSER_NAV_SCRIPT, /MutationObserver/);
  assert.match(BROWSER_NAV_SCRIPT, /true;\s*$/);
});

test("injected script includes extra user script when provided", () => {
  assert.match(browserInjectedJavaScript("true;"), /__ordoBrowser/);
  assert.match(browserInjectedJavaScript("true;"), /__ordoPtr/);
  assert.match(browserInjectedJavaScript("window.__ordoExtra = 1; true;"), /__ordoExtra/);
});

test("reload canvas uses the chrome color without locking the site's CSS", () => {
  const script = browserCanvasScript("#1A1A16");
  assert.match(script, /#1A1A16/);
  assert.match(script, /ordo-browser-chrome/);
  assert.doesNotMatch(script, /!important/);
  assert.equal(browserCanvasScript("white"), "true;");
  assert.match(browserInjectedJavaScript("true;", "#EFE7D2"), /#EFE7D2/);
});

test("blank cover hides the white reload document until load finishes", () => {
  assert.equal(browserBlankCoverVisible(true, 0, false), true);
  assert.equal(browserBlankCoverVisible(true, 0.4, false), true);
  assert.equal(browserBlankCoverVisible(true, 1, false), false);
  assert.equal(browserBlankCoverVisible(false, 0, false), false);
  assert.equal(browserBlankCoverVisible(true, 0, true), false);
});

function ptrPage() {
  const listeners: Record<string, (event: unknown) => void> = {};
  const messages: Array<{ phase: string; dy: number }> = [];
  let now = 1000, reads = 0;
  const root = { scrollTop: 0 };
  const target = { nodeType: 1, parentElement: root, scrollTop: 0,
    get scrollHeight() { reads++; return 1000; }, clientHeight: 100 };
  runInNewContext(BROWSER_PTR_SCRIPT, {
    window: { scrollY: 0, ReactNativeWebView: { postMessage: (raw: string) => messages.push(JSON.parse(raw)) } },
    document: { documentElement: root, scrollingElement: root, body: root,
      addEventListener: (name: string, callback: (event: unknown) => void) => { listeners[name] = callback; } },
    Date: { now: () => now },
  });
  return { messages, target, reads: () => reads, at: (time: number) => { now = time; },
    touch: (name: string, y: number) => listeners[name]?.({ target, touches: [{ clientX: 0, clientY: y }], changedTouches: [{ clientX: 0, clientY: y }] }) };
}

test("fast refresh pulls cross the bridge at most once per 32ms, with an immediate release", () => {
  const page = ptrPage();
  page.touch("touchstart", 0);
  for (let frame = 0; frame < 120; frame++) {
    page.at(1000 + frame * 8);
    page.touch("touchmove", frame * 10);
  }
  assert.equal(page.messages.filter(message => message.phase === "move").length, 30);
  page.touch("touchend", 1200);
  assert.deepEqual(page.messages.at(-1), { type: "ordo-ptr", phase: "end", dy: 1200 });
  assert.ok(page.reads() < 35, "Rate limiting precedes layout reads");
});

test("ordinary upward scrolling stops page-layout probes and reversal cancels a pull", () => {
  const page = ptrPage();
  page.touch("touchstart", 100);
  const initialReads = page.reads();
  for (let step = 0; step < 100; step++) page.touch("touchmove", 99 - step);
  page.touch("touchend", 0);
  assert.equal(page.reads(), initialReads);
  assert.equal(page.messages.length, 0);
  page.touch("touchstart", 100);
  page.touch("touchmove", 180);
  page.touch("touchmove", 90);
  assert.equal(page.messages.at(-1)?.phase, "cancel");
});

test("a page that scrolled away from the top cannot refresh on release", () => {
  const page = ptrPage();
  page.touch("touchstart", 0);
  page.touch("touchmove", 100);
  page.target.scrollTop = 40;
  page.touch("touchend", 120);
  assert.equal(page.messages.at(-1)?.dy, 0);
});
