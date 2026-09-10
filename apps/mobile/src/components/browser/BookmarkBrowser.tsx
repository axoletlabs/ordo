/**
 * Ordo's built-in website view for bookmarks that are not articles.
 * Loads the live page (with JavaScript) inside the app.
 *
 * When force-dark is on, a user script sets color-scheme and inverts pages
 * that are still light. Native `forceDarkOn` is skipped: it is a no-op on
 * current Android targets and would double-invert with the script.
 */
import React, { useMemo, useState } from "react";
import { ActivityIndicator, Platform, StyleSheet, View } from "react-native";
import { WebView } from "react-native-webview";
import { WEBSITE_FORCE_DARK_SCRIPT } from "../../lib/website-force-dark";
import { useSettingsStore } from "../../store/settings";
import { useTheme } from "../../theme/ThemeProvider";
import { resolvePalette } from "../../theme/theme";
import { spacing } from "../../theme/tokens";

export interface BookmarkBrowserProps {
  url: string;
}

export function BookmarkBrowser({ url }: BookmarkBrowserProps) {
  const { palette } = useTheme();
  const forceWebsiteDark = useSettingsStore((s) => s.forceWebsiteDark);
  const amoled = useSettingsStore((s) => s.amoled);
  const [loading, setLoading] = useState(true);
  const source = useMemo(() => ({ uri: url }), [url]);
  const chromeBackground = forceWebsiteDark
    ? resolvePalette("dark", amoled, "dark").background
    : palette.background;

  return (
    <View style={styles.wrap}>
      <WebView
        key={`${url}:${forceWebsiteDark ? "dark" : "auto"}`}
        source={source}
        style={styles.web}
        containerStyle={[styles.web, { backgroundColor: chromeBackground }]}
        startInLoadingState={false}
        onLoadStart={() => setLoading(true)}
        onLoadEnd={() => setLoading(false)}
        setSupportMultipleWindows={false}
        nestedScrollEnabled
        sharedCookiesEnabled
        thirdPartyCookiesEnabled
        javaScriptEnabled
        domStorageEnabled
        allowsInlineMediaPlayback
        mediaPlaybackRequiresUserAction={false}
        automaticallyAdjustContentInsets={false}
        contentInsetAdjustmentBehavior="never"
        hideKeyboardAccessoryView
        originWhitelist={["*"]}
        injectedJavaScriptBeforeContentLoaded={
          forceWebsiteDark ? WEBSITE_FORCE_DARK_SCRIPT : undefined
        }
        injectedJavaScript={forceWebsiteDark ? WEBSITE_FORCE_DARK_SCRIPT : undefined}
        onShouldStartLoadWithRequest={(request) => {
          if (!request.url) return false;
          return request.url.startsWith("http://") || request.url.startsWith("https://");
        }}
      />
      {loading ? (
        <View
          pointerEvents="none"
          style={[styles.loading, { backgroundColor: chromeBackground }]}
        >
          <ActivityIndicator color={palette.accent} />
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { flex: 1 },
  web: { flex: 1, ...(Platform.OS === "web" ? ({ height: "100%" } as const) : null) },
  loading: {
    ...StyleSheet.absoluteFillObject,
    alignItems: "center",
    justifyContent: "center",
    padding: spacing[16],
  },
});
