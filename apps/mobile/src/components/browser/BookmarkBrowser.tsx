/**
 * Ordo's built-in website view for bookmarks that are not articles.
 * Loads the live page (with JavaScript) inside the app.
 *
 * Pull-to-refresh is detected inside the page (touch + scroll position) and
 * posted to React Native. Native UIRefreshControl and wrapping ScrollViews
 * never receive WebView pans, so they cannot drive a reload.
 *
 * When force-dark is on, a user script asks the page for its own dark
 * theme, then inverts body if the page is still light. It must not observe
 * the document tree: a MutationObserver during parse prevents the WebView
 * from ever finishing the load.
 */
import React, {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { BackHandler, Linking, Platform, StyleSheet, View } from "react-native";
import Animated, { useAnimatedStyle, useSharedValue, withSpring } from "react-native-reanimated";
import { WebView, type WebViewNavigation } from "react-native-webview";
import {
  BROWSER_PTR_THRESHOLD,
  browserBlankCoverVisible,
  browserInjectedJavaScript,
  parseBrowserPtrMessage,
  shouldCommitBrowserPtr,
  webViewRequestAction,
  pageHostFromWebViewUrl,
  isCancelledWebViewError,
} from "../../lib/in-app-browser";
import { browserAdBlockingPageScript, browserAdBlockingRules, shouldBlockAdNavigation } from "../../lib/browser-ad-blocking";
import { haptics } from "../../lib/haptics";
import { WEBSITE_FORCE_DARK_SCRIPT } from "../../lib/website-force-dark";
import { useSettingsStore } from "../../store/settings";
import { useTheme } from "../../theme/ThemeProvider";
import { currentAppPalette } from "../../theme/current-app-palette";
import { browserPageStyleScript } from "../../lib/browser-page-style";
import { spacing } from "../../theme/tokens";
import { Button } from "../ui/Button";
import { EmptyState } from "../ui/EmptyState";
import { RefreshHud } from "../ui/RefreshHud";
import { LinearProgress } from "../ui/LinearProgress";
import { useRefreshFeedback } from "../../hooks/use-refresh-feedback";
import { useOverlayBlocked } from "../ui/overlay-host";
import { materialMotion, useMaterialMotion } from "../../theme/material-motion";

/** Keeps the page-load track mounted after its first appearance so later
 * loads fade in and out instead of popping; hidden frames leave the
 * accessibility tree immediately. The track is absolutely positioned, so its
 * fade has no layout effect on the page. */
function LoadTrackFade({ visible, children }: { visible: boolean; children: React.ReactNode }) {
  const motion = useMaterialMotion();
  const opacity = useSharedValue(0);
  const [activated, setActivated] = useState(visible);
  if (visible && !activated) setActivated(true);
  useLayoutEffect(() => {
    opacity.value = motion.reducedMotion ? Number(visible) : withSpring(Number(visible), materialMotion.effects.fast);
  }, [visible, motion.reducedMotion, opacity]);
  const style = useAnimatedStyle(() => ({ opacity: opacity.value }));
  return activated ? (
    <Animated.View pointerEvents="none" aria-hidden={!visible} accessibilityElementsHidden={!visible}
      importantForAccessibility={visible ? "auto" : "no-hide-descendants"} style={[styles.progressTrack, style]}>
      {children}
    </Animated.View>
  ) : null;
}

export interface BookmarkBrowserProps {
  url: string;
  /** Optional app-owned document styling; ordinary websites keep their own theme. */
  pageStyle?: string;
  /** When false, hardware back and header host updates are idle (parked view). */
  active?: boolean;
  onPageHost?: (host: string | null) => void;
  onPageUrl?: (url: string) => void;
}

export interface BookmarkBrowserHandle {
  /** Navigate web history. Returns true when the WebView handled it. */
  goBack: () => boolean;
  reload: () => void;
}

export const BookmarkBrowser = forwardRef<BookmarkBrowserHandle, BookmarkBrowserProps>(
  function BookmarkBrowser({ url, pageStyle, active = true, onPageHost, onPageUrl }, ref) {
    const { palette } = useTheme();
    const blocked = useOverlayBlocked();
    const forceWebsiteDark = useSettingsStore((s) => s.forceWebsiteDark) && !pageStyle;
    const blockWebsiteAds = useSettingsStore((s) => s.blockWebsiteAds);
    const adBlockAllowedHosts = useSettingsStore((s) => s.adBlockAllowedHosts);
    const currentPageUrl = useRef(url);
    const adBlockingRules = useMemo(
      () => browserAdBlockingRules(blockWebsiteAds, adBlockAllowedHosts),
      [blockWebsiteAds, adBlockAllowedHosts],
    );
    const adBlockingPageScript = useMemo(
      () => browserAdBlockingPageScript(blockWebsiteAds, adBlockAllowedHosts),
      [blockWebsiteAds, adBlockAllowedHosts],
    );
    const webRef = useRef<WebView>(null);
    const canGoBackRef = useRef(false);
    const ptrDyRef = useRef(0);
    const refreshingRef = useRef(false);
    const armedHapticRef = useRef(false);
    const [loading, setLoading] = useState(Platform.OS !== "web");
    const [progress, setProgress] = useState(0);
    const [error, setError] = useState<string | null>(null);
    const { refreshing, start: startRefresh, finish: finishRefresh } = useRefreshFeedback();
    const [ptrDy, setPtrDy] = useState(0);
    const source = useMemo(() => ({ uri: url }), [url]);
    const chromeBackground = forceWebsiteDark
      ? currentAppPalette("dark").background
      : palette.background;
    const injected = useMemo(
      () =>
        browserInjectedJavaScript(
          `${forceWebsiteDark ? WEBSITE_FORCE_DARK_SCRIPT : "true;"}\n${adBlockingPageScript}\n${pageStyle ? browserPageStyleScript(pageStyle) : ""}`,
          chromeBackground,
        ),
      [forceWebsiteDark, chromeBackground, pageStyle, adBlockingPageScript],
    );
    const coverBlank = browserBlankCoverVisible(loading, progress, !!error);

    useEffect(() => {
      if (pageStyle) webRef.current?.injectJavaScript(browserPageStyleScript(pageStyle));
    }, [pageStyle]);

    useEffect(() => {
      webRef.current?.injectJavaScript(adBlockingPageScript);
    }, [adBlockingPageScript]);

    const finishLoad = useCallback(() => {
      refreshingRef.current = false;
      setLoading(false);
      setProgress(1);
      finishRefresh();
      ptrDyRef.current = 0;
      setPtrDy(0);
    }, [finishRefresh]);

    const beginLoad = useCallback(() => {
      setError(null);
      setLoading(true);
      setProgress(0);
    }, []);

    const reload = useCallback(() => {
      setError(null);
      setLoading(true);
      setProgress(0);
      webRef.current?.injectJavaScript(
        `try{var c=${JSON.stringify(chromeBackground)};document.documentElement.style.backgroundColor=c;if(document.body)document.body.style.backgroundColor=c;}catch(e){}true;`,
      );
      webRef.current?.reload();
    }, [chromeBackground]);

    const handleRefresh = useCallback(() => {
      if (refreshingRef.current || !startRefresh()) return;
      refreshingRef.current = true;
      haptics.light();
      ptrDyRef.current = BROWSER_PTR_THRESHOLD;
      setPtrDy(BROWSER_PTR_THRESHOLD);
      reload();
    }, [reload, startRefresh]);

    useImperativeHandle(
      ref,
      () => ({
        goBack: () => {
          if (!canGoBackRef.current) return false;
          webRef.current?.goBack();
          return true;
        },
        reload: handleRefresh,
      }),
      [handleRefresh],
    );

    useEffect(() => {
      // The web preview has no WebView backing the page, so there is no load
      // lifecycle to track — starting one would leave the blank cover up.
      if (Platform.OS !== "web") beginLoad();
      currentPageUrl.current = url;
    }, [url, forceWebsiteDark, beginLoad]);

    useEffect(() => {
      if (!active || blocked || Platform.OS !== "android") return;
      const sub = BackHandler.addEventListener("hardwareBackPress", () => {
        if (!canGoBackRef.current) return false;
        webRef.current?.goBack();
        return true;
      });
      return () => sub.remove();
    }, [active, blocked]);

    const handleShouldStart = useCallback(
      (request: { url: string; isTopFrame?: boolean }) => {
        const settings = useSettingsStore.getState();
        if (request.isTopFrame !== false && shouldBlockAdNavigation(request.url, currentPageUrl.current,
          settings.blockWebsiteAds, settings.adBlockAllowedHosts)) return false;
        const action = webViewRequestAction(request.url, request.isTopFrame !== false);
        if (action === "allow") return true;
        if (action === "external") {
          void Linking.openURL(request.url).catch(() => {});
        }
        return false;
      },
      [],
    );

    const handleOpenWindow = useCallback((event: { nativeEvent: { targetUrl: string } }) => {
      const next = event.nativeEvent.targetUrl;
      const settings = useSettingsStore.getState();
      if (shouldBlockAdNavigation(next, currentPageUrl.current, settings.blockWebsiteAds, settings.adBlockAllowedHosts)) return;
      const action = webViewRequestAction(next, true);
      if (action === "allow") {
        webRef.current?.injectJavaScript(
          `window.location.href = ${JSON.stringify(next)}; true;`,
        );
        return;
      }
      if (action === "external") {
        void Linking.openURL(next).catch(() => {});
      }
    }, []);

    const handleNav = useCallback(
      (nav: WebViewNavigation) => {
        canGoBackRef.current = nav.canGoBack;
        if (!nav.loading) currentPageUrl.current = nav.url;
        if (!active) return;
        onPageHost?.(pageHostFromWebViewUrl(nav.url));
        onPageUrl?.(nav.url);
      },
      [active, onPageHost, onPageUrl],
    );

    const handleProgress = useCallback(
      (event: { nativeEvent: { progress: number } }) => {
        const next = event.nativeEvent.progress;
        setProgress(next);
        if (next >= 1) finishLoad();
      },
      [finishLoad],
    );

    const handleError = useCallback(
      (event: { nativeEvent: { code: number; description: string } }) => {
        const { code, description } = event.nativeEvent;
        refreshingRef.current = false;
        finishRefresh();
        ptrDyRef.current = 0;
        setPtrDy(0);
        if (isCancelledWebViewError(code, description)) {
          finishLoad();
          return;
        }
        setLoading(false);
        setError(description?.trim() || "Couldn't load this page");
      },
      [finishLoad, finishRefresh],
    );

    const handleMessage = useCallback(
      (event: { nativeEvent: { data: string } }) => {
        const msg = parseBrowserPtrMessage(event.nativeEvent.data);
        if (!msg || blocked || !active) return;
        if (msg.phase === "move") {
          if (refreshingRef.current) return;
          const dy = Math.max(0, msg.dy);
          if (Math.abs(dy - ptrDyRef.current) >= 4) {
            ptrDyRef.current = dy;
            setPtrDy(dy);
          }
          if (dy >= BROWSER_PTR_THRESHOLD && !armedHapticRef.current) {
            armedHapticRef.current = true;
            haptics.selection();
          } else if (dy < BROWSER_PTR_THRESHOLD) {
            armedHapticRef.current = false;
          }
          return;
        }
        armedHapticRef.current = false;
        if (msg.phase === "end" && shouldCommitBrowserPtr(msg.dy, refreshingRef.current)) {
          handleRefresh();
          return;
        }
        if (!refreshingRef.current) {
          ptrDyRef.current = 0;
          setPtrDy(0);
        }
      },
      [handleRefresh, blocked, active],
    );

    const recoverProcess = useCallback(() => {
      webRef.current?.reload();
    }, []);

    // Loading progress and the refresh HUD can update dozens of times per
    // second. Reuse the page element rather than reconciling the native WebView
    // (and all its freshly allocated style/config props) on every HUD frame.
    const page = useMemo(() => Platform.OS === "web" ? (
        // react-native-webview has no web implementation; show the shared
        // empty state instead of its raw unsupported-platform message.
        <View style={[styles.webFallback, { flex: 1, backgroundColor: chromeBackground }]}>
          <EmptyState
            icon="compass-outline"
            title="Live pages need the ordo app"
            message={pageHostFromWebViewUrl(url) ? `${pageHostFromWebViewUrl(url)} opens in the app on your device.` : undefined}
          />
        </View>
      ) : (
        <WebView
          ref={webRef}
          key={`${url}:${forceWebsiteDark ? "dark" : "auto"}`}
          source={source}
          adBlockingRules={adBlockingRules}
          style={[styles.web, { backgroundColor: chromeBackground }]}
          containerStyle={[styles.web, { backgroundColor: chromeBackground }]}
          startInLoadingState={false}
          onLoadStart={beginLoad}
          onLoadEnd={finishLoad}
          onLoadProgress={handleProgress}
          onError={handleError}
          onNavigationStateChange={handleNav}
          onShouldStartLoadWithRequest={handleShouldStart}
          onOpenWindow={handleOpenWindow}
          onMessage={handleMessage}
          onFileDownload={({ nativeEvent }) => {
            void Linking.openURL(nativeEvent.downloadUrl).catch(() => {});
          }}
          onContentProcessDidTerminate={recoverProcess}
          onRenderProcessGone={recoverProcess}
          setSupportMultipleWindows={false}
          bounces
          scrollEnabled={!blocked}
          overScrollMode="never"
          cacheEnabled
          cacheMode="LOAD_DEFAULT"
          mixedContentMode="never"
          allowsBackForwardNavigationGestures
          allowsFullscreenVideo
          sharedCookiesEnabled
          thirdPartyCookiesEnabled
          javaScriptEnabled
          forceDarkOn={forceWebsiteDark}
          javaScriptCanOpenWindowsAutomatically={false}
          injectedJavaScriptForMainFrameOnly
          injectedJavaScriptBeforeContentLoadedForMainFrameOnly
          domStorageEnabled
          allowsInlineMediaPlayback
          mediaPlaybackRequiresUserAction={false}
          automaticallyAdjustContentInsets={false}
          contentInsetAdjustmentBehavior="never"
          contentInset={{ top: 0, left: 0, bottom: 0, right: 0 }}
          hideKeyboardAccessoryView
          showsHorizontalScrollIndicator={false}
          originWhitelist={["http://*", "https://*", "about:blank"]}
          setBuiltInZoomControls
          setDisplayZoomControls={false}
          injectedJavaScriptBeforeContentLoaded={injected}
          injectedJavaScript={injected}
        />
    ), [url, forceWebsiteDark, adBlockingRules, source, chromeBackground, beginLoad, finishLoad, handleProgress,
      handleError, handleNav, handleShouldStart, handleOpenWindow, handleMessage, recoverProcess, injected, blocked]);

    return (
      <View testID="bookmark-browser" collapsable={false} style={[styles.wrap, { backgroundColor: chromeBackground }]}>
        {page}
        {coverBlank ? (
          <View
            pointerEvents="none"
            style={[styles.blankCover, { backgroundColor: chromeBackground }]}
          />
        ) : null}
        <RefreshHud dy={ptrDy} refreshing={refreshing} />
        <LoadTrackFade visible={loading && !error}>
          <LinearProgress label="Page load" value={progress > 0 ? progress : undefined} />
        </LoadTrackFade>
        {error ? (
          <View style={[styles.error, { backgroundColor: chromeBackground }]}>
            <EmptyState
              icon="cloud-offline-outline"
              title="Couldn't load this page"
              message={error}
              action={<Button label="Retry" variant="secondary" onPress={handleRefresh} />}
            />
          </View>
        ) : null}
      </View>
    );
  },
);

const styles = StyleSheet.create({
  wrap: { flex: 1, minHeight: 0, overflow: "hidden" },
  web: { flex: 1, margin: 0, padding: 0, ...(Platform.OS === "web" ? ({ height: "100%" } as const) : null) },
  webFallback: { alignItems: "center", justifyContent: "center" },
  blankCover: { ...StyleSheet.absoluteFill },
  // Position the fading wrapper itself: an in-flow wrapper lands below the
  // flexing WebView and clips the bar. Let LinearProgress own the height
  // (4dp straight, 10dp wavy) so the full wave stays visible.
  progressTrack: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
  },
  error: {
    ...StyleSheet.absoluteFill,
    alignItems: "center",
    justifyContent: "center",
    padding: spacing[16],
  },
});
