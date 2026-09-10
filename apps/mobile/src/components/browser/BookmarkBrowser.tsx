/**
 * Ordo's built-in website view for bookmarks that are not articles.
 * Loads the live page (with JavaScript) inside the app.
 *
 * Pull-to-refresh: iOS uses WKWebView's native control; Android wraps the
 * WebView in a RefreshControl that only intercepts while the page is at
 * the top. A thin top bar tracks load progress instead of covering the page.
 *
 * When force-dark is on, a user script inverts pages that are still light.
 * It must not observe the document tree: a MutationObserver during parse
 * prevents the WebView from ever finishing the load.
 */
import React, {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  BackHandler,
  Linking,
  Platform,
  RefreshControl,
  ScrollView,
  StyleSheet,
  View,
} from "react-native";
import { WebView, type WebViewNavigation } from "react-native-webview";
import {
  androidPullToRefreshScrollEnabled,
  browserInjectedJavaScript,
  browserProgressBarWidth,
  isCancelledWebViewError,
  pageHostFromWebViewUrl,
  webViewRequestAction,
} from "../../lib/in-app-browser";
import { haptics } from "../../lib/haptics";
import { WEBSITE_FORCE_DARK_SCRIPT } from "../../lib/website-force-dark";
import { useSettingsStore } from "../../store/settings";
import { useTheme } from "../../theme/ThemeProvider";
import { resolvePalette } from "../../theme/theme";
import { spacing } from "../../theme/tokens";
import { Button } from "../ui/Button";
import { EmptyState } from "../ui/EmptyState";

export interface BookmarkBrowserProps {
  url: string;
  /** When false, hardware back and header host updates are idle (parked view). */
  active?: boolean;
  onPageHost?: (host: string | null) => void;
}

export interface BookmarkBrowserHandle {
  /** Navigate web history. Returns true when the WebView handled it. */
  goBack: () => boolean;
  reload: () => void;
}

export const BookmarkBrowser = forwardRef<BookmarkBrowserHandle, BookmarkBrowserProps>(
  function BookmarkBrowser({ url, active = true, onPageHost }, ref) {
    const { palette } = useTheme();
    const forceWebsiteDark = useSettingsStore((s) => s.forceWebsiteDark);
    const amoled = useSettingsStore((s) => s.amoled);
    const webRef = useRef<WebView>(null);
    const canGoBackRef = useRef(false);
    const atTopRef = useRef(true);
    const [loading, setLoading] = useState(true);
    const [progress, setProgress] = useState(0);
    const [error, setError] = useState<string | null>(null);
    const [refreshing, setRefreshing] = useState(false);
    const [ptrEnabled, setPtrEnabled] = useState(true);
    const [viewportHeight, setViewportHeight] = useState(0);
    const source = useMemo(() => ({ uri: url }), [url]);
    const injected = useMemo(
      () =>
        browserInjectedJavaScript(forceWebsiteDark ? WEBSITE_FORCE_DARK_SCRIPT : "true;"),
      [forceWebsiteDark],
    );
    const chromeBackground = forceWebsiteDark
      ? resolvePalette("dark", amoled, "dark").background
      : palette.background;
    const darkChrome = forceWebsiteDark || palette.mode === "dark";
    const barWidth = browserProgressBarWidth(progress, loading && !error);

    const finishLoad = useCallback(() => {
      setLoading(false);
      setProgress(1);
      setRefreshing(false);
    }, []);

    const beginLoad = useCallback(() => {
      setError(null);
      setLoading(true);
      setProgress(0);
    }, []);

    const reload = useCallback(() => {
      setError(null);
      setLoading(true);
      setProgress(0);
      webRef.current?.reload();
    }, []);

    useImperativeHandle(
      ref,
      () => ({
        goBack: () => {
          if (!canGoBackRef.current) return false;
          webRef.current?.goBack();
          return true;
        },
        reload,
      }),
      [reload],
    );

    useEffect(() => {
      beginLoad();
    }, [url, forceWebsiteDark, beginLoad]);

    useEffect(() => {
      if (!active) return;
      const sub = BackHandler.addEventListener("hardwareBackPress", () => {
        if (!canGoBackRef.current) return false;
        webRef.current?.goBack();
        return true;
      });
      return () => sub.remove();
    }, [active]);

    const handleShouldStart = useCallback(
      (request: { url: string; isTopFrame?: boolean }) => {
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
        if (!active) return;
        onPageHost?.(pageHostFromWebViewUrl(nav.url));
      },
      [active, onPageHost],
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
        setRefreshing(false);
        if (isCancelledWebViewError(code, description)) {
          finishLoad();
          return;
        }
        setLoading(false);
        setError(description?.trim() || "Couldn't load this page");
      },
      [finishLoad],
    );

    const handleRefresh = useCallback(() => {
      haptics.light();
      setRefreshing(true);
      reload();
    }, [reload]);

    const handleScroll = useCallback(
      (event: { nativeEvent: { contentOffset: { y: number } } }) => {
        const atTop = androidPullToRefreshScrollEnabled(event.nativeEvent.contentOffset.y);
        if (atTop === atTopRef.current) return;
        atTopRef.current = atTop;
        setPtrEnabled(atTop);
      },
      [],
    );

    const recoverProcess = useCallback(() => {
      webRef.current?.reload();
    }, []);

    const webView = (
      <WebView
        ref={webRef}
        key={`${url}:${forceWebsiteDark ? "dark" : "auto"}`}
        source={source}
        style={[
          styles.web,
          // RN WebView defaults `style` to #ffffff; that flashes on open/close.
          { backgroundColor: chromeBackground },
          Platform.OS === "android" && viewportHeight > 0 ? { height: viewportHeight } : null,
        ]}
        containerStyle={[styles.web, { backgroundColor: chromeBackground }]}
        startInLoadingState={false}
        onLoadStart={beginLoad}
        onLoadEnd={finishLoad}
        onLoadProgress={handleProgress}
        onError={handleError}
        onNavigationStateChange={handleNav}
        onShouldStartLoadWithRequest={handleShouldStart}
        onOpenWindow={handleOpenWindow}
        onScroll={Platform.OS === "android" ? handleScroll : undefined}
        onFileDownload={({ nativeEvent }) => {
          void Linking.openURL(nativeEvent.downloadUrl).catch(() => {});
        }}
        onContentProcessDidTerminate={recoverProcess}
        onRenderProcessGone={recoverProcess}
        setSupportMultipleWindows={false}
        nestedScrollEnabled={Platform.OS === "android"}
        overScrollMode="never"
        cacheEnabled
        cacheMode="LOAD_DEFAULT"
        mixedContentMode="compatibility"
        decelerationRate="normal"
        allowsBackForwardNavigationGestures
        pullToRefreshEnabled={Platform.OS === "ios"}
        refreshControlLightMode={darkChrome}
        allowsFullscreenVideo
        sharedCookiesEnabled
        thirdPartyCookiesEnabled
        javaScriptEnabled
        javaScriptCanOpenWindowsAutomatically={false}
        injectedJavaScriptForMainFrameOnly
        injectedJavaScriptBeforeContentLoadedForMainFrameOnly
        domStorageEnabled
        allowsInlineMediaPlayback
        mediaPlaybackRequiresUserAction={false}
        automaticallyAdjustContentInsets={false}
        contentInsetAdjustmentBehavior="never"
        hideKeyboardAccessoryView
        showsHorizontalScrollIndicator={false}
        originWhitelist={["*"]}
        setBuiltInZoomControls
        setDisplayZoomControls={false}
        injectedJavaScriptBeforeContentLoaded={injected}
        injectedJavaScript={injected}
      />
    );

    return (
      <View
        collapsable={false}
        style={[styles.wrap, { backgroundColor: chromeBackground }]}
        onLayout={(event) => {
          const height = event.nativeEvent.layout.height;
          if (height > 0) setViewportHeight(height);
        }}
      >
        {Platform.OS === "android" ? (
          <ScrollView
            style={[styles.web, { backgroundColor: chromeBackground }]}
            contentContainerStyle={viewportHeight > 0 ? { height: viewportHeight } : styles.web}
            scrollEnabled={ptrEnabled}
            nestedScrollEnabled
            showsVerticalScrollIndicator={false}
            showsHorizontalScrollIndicator={false}
            overScrollMode="never"
            keyboardShouldPersistTaps="handled"
            refreshControl={
              <RefreshControl
                refreshing={refreshing}
                onRefresh={handleRefresh}
                enabled={ptrEnabled}
                colors={[palette.accent]}
                tintColor={palette.accent}
                progressBackgroundColor={chromeBackground}
              />
            }
          >
            {webView}
          </ScrollView>
        ) : (
          webView
        )}
        {barWidth > 0 ? (
          <View
            pointerEvents="none"
            style={styles.progressTrack}
            accessibilityRole="progressbar"
            accessibilityLabel="Page load"
            accessibilityValue={{ min: 0, max: 100, now: Math.round(barWidth * 100) }}
          >
            <View
              style={[
                styles.progressFill,
                { width: `${barWidth * 100}%`, backgroundColor: palette.accent },
              ]}
            />
          </View>
        ) : null}
        {error ? (
          <View style={[styles.error, { backgroundColor: chromeBackground }]}>
            <EmptyState
              icon="cloud-offline-outline"
              title="Couldn't load this page"
              message={error}
              action={<Button label="Retry" variant="secondary" onPress={reload} />}
            />
          </View>
        ) : null}
      </View>
    );
  },
);

const styles = StyleSheet.create({
  wrap: { flex: 1 },
  web: { flex: 1, ...(Platform.OS === "web" ? ({ height: "100%" } as const) : null) },
  progressTrack: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    height: 2,
    overflow: "hidden",
  },
  progressFill: { height: 2, alignSelf: "flex-start" },
  error: {
    ...StyleSheet.absoluteFillObject,
    alignItems: "center",
    justifyContent: "center",
    padding: spacing[16],
  },
});
