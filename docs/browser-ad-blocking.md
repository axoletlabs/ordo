# Browser ad blocking

Ordo's Android and iOS browser blocks resources from a small bundled list of
advertising hosts. It is enabled by default, works offline, and sends no
browsing data to a filtering service. Settings → Controls → Browser → Block ads
turns it off. The website menu has the same global Block ads switch.
Controls → Browser → Site exceptions is the only place to add or remove site
exceptions. Enter a hostname or paste a website URL; Ordo saves its exact host.
Exceptions persist on the device. Turning blocking off globally preserves them,
and they can still be edited while blocking is off. Changing a rule reloads
the current page when safe, without replacing its navigation history.

The system browser and Chrome/Safari sheets are outside Ordo's control. The web
app marks this setting unavailable. Reader articles use the existing sanitized
native rendering and do not load through this blocker.

## Compatibility boundaries

- Block only HTTP(S) resources on the listed hosts and their DNS subdomains.
  A host name inside a URL path or a lookalike suffix must never match.
- Native navigation policy cancels top-level redirects and new-window
  navigations to listed ad hosts from other websites, before the JS bridge.
  It uses the last committed page (or the initial source before first commit),
  so a provisional HTTP redirect cannot masquerade as first-party navigation.
  Ordinary redirects, sign-in and payment destinations remain available.
  Direct visits to listed providers can load their own resources.
  Do not add generic words, URL paths, script replacements, cookie blocking,
  or shared content/CDN hosts.
- MangaFire has one scoped cosmetic rule for its reported invisible,
  high-z-index advertising links (`uBlockOrigin/uAssets#33585`). It leaves
  manga links, chapter images and native popup APIs alone. The global switch
  and exact site exceptions also disable this rule, without replaying forms.
  Do not apply cosmetic selectors to unrelated websites or add a selector
  without a concrete report and compatibility cases.
- Android intercepts subresource requests in the native WebView client. It
  returns an empty, non-cacheable response for matches. Matching uses an
  immutable per-view snapshot, with no JS bridge, network or disk on the
  request thread. Missing page context or invalid configuration allows loads.
  Non-GET requests and requests accepting HTML/XHTML are always passed through,
  including embedded documents, submissions and CORS preflights.
- iOS uses WKContentRuleList with third-party resource rules; document loads
  (including frames) are excluded. Initial loading waits for compilation, with
  a three-second fail-open timeout. Stale asynchronous results are ignored.
  An update retains the previous rules until its replacement is ready and
  removes only Ordo's own rule list. A refresh requested during compilation
  waits for the new preference.
- Changing an unrelated site's exception leaves the current page alone.
  Automatic refreshes only occur when the page's effective policy changes and
  it is idle and a safe GET request is known. Android leaves observed POST
  responses and restored history entries with unknown request methods alone.
  iOS never automatically replays submitted forms or history entries.
  Existing form entries can be refreshed explicitly by the user.
- Site exceptions apply to an exact hostname, across ports and HTTP/HTTPS.
  `www.example.com` and `example.com` remain separate. Navigation filtering
  follows the loaded page as browsing moves between websites.
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

Workspace typecheck and lint remain required. The Browser WebKit workflow
generates the iOS project and compiles the patched WebView against the pinned
Xcode toolchain on macOS. The Android APK build validates Fabric codegen and
native integration.
A desktop web preview cannot validate native request interception. Before a
release, smoke-test the APK on a device with redirects, back navigation,
pull-to-refresh, force-dark, video, sign-in and an ad-heavy publisher; compare
the same pages with blocking disabled. No finite test suite can guarantee
compatibility with every website.
