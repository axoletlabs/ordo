import assert from "node:assert/strict";
import { test } from "node:test";
import {
  BROWSER_NAV_SCRIPT,
  BROWSER_PTR_SCRIPT,
  BROWSER_PTR_THRESHOLD,
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
  assert.equal(webViewRequestAction("data:text/html,hi"), "allow");
});

test("javascript and local files never load", () => {
  assert.equal(webViewRequestAction("javascript:alert(1)"), "block");
  assert.equal(webViewRequestAction("file:///etc/passwd"), "block");
  assert.equal(webViewRequestAction("content://media/1"), "block");
  assert.equal(webViewRequestAction(""), "block");
});

test("mail and phone links leave the app on the top frame only", () => {
  assert.equal(webViewRequestAction("mailto:hi@example.com"), "external");
  assert.equal(webViewRequestAction("tel:+1555"), "external");
  assert.equal(webViewRequestAction("sms:+1555"), "external");
  assert.equal(webViewRequestAction("mailto:hi@example.com", false), "block");
  assert.equal(webViewRequestAction("intent://scan/#Intent;end"), "external");
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
