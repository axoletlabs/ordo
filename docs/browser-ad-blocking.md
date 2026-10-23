# Browser ad blocking

Ordo's Android and iOS browser blocks resources from a small bundled list of
advertising hosts. It is enabled by default, works offline, and sends no
browsing data to a filtering service. Settings → Controls → Browser → Block ads
turns it off. The page menu can allow ads on the current hostname; changing a
rule reloads the current page without replacing its navigation history.
Exceptions persist on the device and can be cleared from Controls.

The system browser and Chrome/Safari sheets are outside Ordo's control. The web
app marks this setting unavailable. Reader articles use the existing sanitized
native rendering and do not load through this blocker.

## Compatibility boundaries

- Block only HTTP(S) resources on the listed hosts and their DNS subdomains.
  A host name inside a URL path or a lookalike suffix must never match.
- Never block top-level navigation. Direct visits to listed providers can load
  their own resources. Do not add generic words, URL paths, DOM selectors,
  script replacements, cookie blocking, or shared content/CDN hosts.
- Android intercepts subresource requests in the native WebView client. It
  returns an empty, non-cacheable response for matches. Matching uses an
  immutable per-view snapshot, with no JS bridge, network or disk on the
  request thread. Missing page context or invalid configuration allows loads.
- iOS uses WKContentRuleList with third-party resource rules; document loads
  (including frames) are excluded. Initial loading waits for compilation, with
  a three-second fail-open timeout. Stale asynchronous results are ignored.
  Native rule changes reload the current URL, including after a redirect.
- Site exceptions apply to an exact hostname, across ports and HTTP/HTTPS.
  `www.example.com` and `example.com` remain separate. The page menu uses the
  current navigation URL, not the original bookmark URL or shortened title.
- This is conservative host-based filtering, not full EasyList or uBlock
  Origin support. First-party ads, sponsored content and ads sharing a media
  origin (for example some video ads) can remain. Sites may still detect
  blocking; use the site exception when necessary.

The original host list is maintained in `browser-ad-blocking.ts`. It is a list
of domain names, not a downloaded third-party filter list. Add a host only when
it is dedicated to advertising, does not share essential page services, and
has compatibility regression cases. No remote filter updates occur at runtime.

## Native patch and releases

`patches/react-native-webview@13.16.1.patch` adds an optional `adBlockingRules`
prop to the WebView codegen schema, Android managers/client and Apple view.
No configuration means the upstream WebView behavior. pnpm applies the patch
at install time and verifies its hash. Preserve/review this patch when updating
WebView; a new native binary is required. The small `@expo/plist` patch supplies
the XML MIME type required by the security-pinned XML parser and removes
leading template whitespace during iOS prebuild; retain it until Expo supplies the same fix. Expo's native-module fingerprint must
include the patched module before distributing an OTA.

## Validation

Run `pnpm --filter @ordo/mobile test` with Node 22+ and a JDK. The suite compiles
and executes the actual Android Java matcher against the same compatibility
corpus as the generated WebKit rules. It also tests upgrades, persistence,
rapid setting changes and exact-host exceptions. Workspace typecheck and lint
remain required.

The Browser WebKit workflow runs the rules in a real WKWebView on macOS against
a local publisher/ad fixture: resource blocking, site exceptions, direct
visits, cookies, forms, embedded frames, toggling/reload and navigation history.
The Android APK build validates Fabric codegen and native integration.
A desktop web preview cannot validate native request interception. Before a
release, also smoke-test the APK on a device with redirects, back navigation,
pull-to-refresh, force-dark, video, sign-in and an ad-heavy publisher; compare
the same pages with blocking disabled. No finite test suite can guarantee
compatibility with every website.
