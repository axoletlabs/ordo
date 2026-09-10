/**
 * Ordo's built-in website view for bookmarks that are not articles.
 * Loads the live page (with JavaScript) inside the app.
 *
 * Pull-to-refresh is detected inside the page (touch + scroll position) and
 * posted to React Native. Native UIRefreshControl and wrapping ScrollViews
 * never receive WebView pans, so they cannot drive a reload.
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
import { ActivityIndicator, BackHandler, Linking, Platform, StyleSheet, View } from "react-native";
import { WebView, type WebViewNavigation } from "react-native-webview";
import {
  BROWSER_PTR_THRESHOLD,
  browserInjectedJavaScript,
  browserProgressBarWidth,
  browserPtrHudOffset,
  browserPtrHudOpacity,
  parseBrowserPtrMessage,
  shouldCommitBrowserPtr,
  webViewRequestAction,
  pageHostFromWebViewUrl,
  isCancelledWebViewError,
} from "../../lib/in-app-browser";
import { haptics } from "../../lib/haptics";
import { WEBSITE_FORCE_DARK_SCRIPT } from "../../lib/website-force-dark";
import { useSettingsStore } from "../../store/settings";
import { useTheme } from "../../theme/ThemeProvider";
import { resolvePalette } from "../../theme/theme";
import { radius, spacing } from "../../theme/tokens";
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
    const ptrDyRef = useRef(0);
    const refreshingRef = useRef(false);
    const armedHapticRef = useRef(false);
    const [loading, setLoading] = useState(true);
    const [progress, setProgress] = useState(0);
    const [error, setError] = useState<string | null>(null);
    const [refreshing, setRefreshing] = useState(false);
    const [ptrDy, setPtrDy] = useState(0);
    const source = useMemo(() => ({ uri: url }), [url]);
    const injected = useMemo(
      () =>
        browserInjectedJavaScript(forceWebsiteDark ? WEBSITE_FORCE_DARK_SCRIPT : "true;"),
      [forceWebsiteDark],
    );
    const chromeBackground = forceWebsiteDark
      ? resolvePalette("dark", amoled, "dark").background
      : palette.background;
    const barWidth = browserProgressBarWidth(progress, loading && !error);
    const hudOpacity = browserPtrHudOpacity(ptrDy, refreshing);
    const hudOffset = browserPtrHudOffset(ptrDy);

    const finishLoad = useCallback(() => {
      refreshingRef.current = false;
      setLoading(false);
      setProgress(1);
      setRefreshing(false);
      ptrDyRef.current = 0;
      setPtrDy(0);
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

    const handleRefresh = useCallback(() => {
      if (refreshingRef.current) return;
      refreshingRef.current = true;
      haptics.light();
      setRefreshing(true);
      ptrDyRef.current = BROWSER_PTR_THRESHOLD;
      setPtrDy(BROWSER_PTR_THRESHOLD);
      reload();
    }, [reload]);

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
        refreshingRef.current = false;
        setRefreshing(false);
        ptrDyRef.current = 0;
        setPtrDy(0);
        if (isCancelledWebViewError(code, description)) {
          finishLoad();
          return;
        }
        setLoading(false);
        setError(description?.trim() || "Couldn't load this page");
      },
      [finishLoad],
    );

    const handleMessage = useCallback(
      (event: { nativeEvent: { data: string } }) => {
        const msg = parseBrowserPtrMessage(event.nativeEvent.data);
        if (!msg) return;
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
      [handleRefresh],
    );

    const recoverProcess = useCallback(() => {
      webRef.current?.reload();
    }, []);

    return (
      <View collapsable={false} style={[styles.wrap, { backgroundColor: chromeBackground }]}>
        <WebView
          ref={webRef}
          key={`${url}:${forceWebsiteDark ? "dark" : "auto"}`}
          source={source}
          style={[styles.web, { backgroundColor: chromeBackground }]} // WebView defaults to #fff // WebView defaults to #fff
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
          overScrollMode="always"
          cacheEnabled
          cacheMode="LOAD_DEFAULT"
          mixedContentMode="compatibility"
          allowsBackForwardNavigationGestures
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
        {hudOpacity > 0 ? (
          <View
            pointerEvents="none"
            style={[
              styles.ptrHud,
              { opacity: hudOpacity, transform: [{ translateY: hudOffset }] },
            ]}
          >
            <View
              style={[
                styles.ptrChip,
                { backgroundColor: palette.surfaceElevated, borderColor: palette.borderStrong },
              ]}
            >
              <ActivityIndicator color={palette.accent} />
            </View>
          </View>
        ) : null}
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
              action={<Button label="Retry" variant="secondary" onPress={handleRefresh} />}
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
  ptrHud: {
    position: "absolute",
    top: spacing[8],
    left: 0,
    right: 0,
    alignItems: "center",
  },
  ptrChip: {
    width: 36,
    height: 36,
    borderRadius: radius.full,
    borderWidth: StyleSheet.hairlineWidth,
    alignItems: "center",
    justifyContent: "center",
  },
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
