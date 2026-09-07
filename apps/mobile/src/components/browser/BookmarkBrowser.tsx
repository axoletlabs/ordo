/**
 * Ordo's built-in website view for bookmarks that are not articles.
 * Loads the live page (with JavaScript) inside the app.
 */
import React, { useMemo, useState } from "react";
import { ActivityIndicator, Platform, StyleSheet, View } from "react-native";
import { WebView } from "react-native-webview";
import { useTheme } from "../../theme/ThemeProvider";
import { spacing } from "../../theme/tokens";

export interface BookmarkBrowserProps {
  url: string;
}

export function BookmarkBrowser({ url }: BookmarkBrowserProps) {
  const { palette } = useTheme();
  const [loading, setLoading] = useState(true);
  const source = useMemo(() => ({ uri: url }), [url]);

  return (
    <View style={styles.wrap}>
      <WebView
        key={url}
        source={source}
        style={styles.web}
        containerStyle={[styles.web, { backgroundColor: palette.background }]}
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
        onShouldStartLoadWithRequest={(request) => {
          if (!request.url) return false;
          return request.url.startsWith("http://") || request.url.startsWith("https://");
        }}
      />
      {loading ? (
        <View
          pointerEvents="none"
          style={[styles.loading, { backgroundColor: palette.background }]}
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
