/** About links share the live website view used by library bookmarks. */
import React from "react";
import { Platform, StyleSheet, View } from "react-native";
import { useIsFocused, useLocalSearchParams } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { BookmarkBrowser, type BookmarkBrowserHandle } from "../../../src/components/browser/BookmarkBrowser";
import { EmptyState } from "../../../src/components/ui/EmptyState";
import { Header, HeaderIconButton } from "../../../src/components/ui/Header";
import { useAppRouter } from "../../../src/hooks/use-app-router";
import { pageHostFromWebViewUrl } from "../../../src/lib/in-app-browser";
import { useTheme } from "../../../src/theme/ThemeProvider";

export default function AboutBrowserScreen() {
  const params = useLocalSearchParams<{ url?: string; title?: string }>();
  const url = Array.isArray(params.url) ? params.url[0] : params.url;
  const title = (Array.isArray(params.title) ? params.title[0] : params.title) || "Website";
  const validUrl = url && /^https?:\/\//i.test(url) && pageHostFromWebViewUrl(url) ? url : null;
  const router = useAppRouter();
  const active = useIsFocused();
  const insets = useSafeAreaInsets();
  const { palette } = useTheme();
  const browser = React.useRef<BookmarkBrowserHandle>(null);
  const [host, setHost] = React.useState(() => validUrl ? pageHostFromWebViewUrl(validUrl) : null);
  const close = () => router.canGoBack() ? router.back() : router.replace("/settings/about");

  return (
    <View style={[styles.page, { backgroundColor: palette.background }]}>
      <Header
        title={title}
        subtitle={host ?? undefined}
        showBack
        onBack={() => browser.current?.goBack() || close()}
        right={<HeaderIconButton name="close" color={palette.onSurface} onPress={close}
          accessibilityLabel="Close page" measureOnPress={false} />}
      />
      <View style={[styles.page, { paddingLeft: insets.left, paddingRight: insets.right, paddingBottom: insets.bottom }]}>
        {validUrl ? Platform.OS === "web" ? (
          <iframe title={title} src={validUrl} style={{ border: 0, width: "100%", height: "100%", flex: 1 }} />
        ) : (
          <BookmarkBrowser key={validUrl} ref={browser} url={validUrl} active={active} onPageHost={setHost} />
        ) : (
          <EmptyState icon="cloud-offline-outline" title="Couldn't open this page" message="This link is missing or invalid." />
        )}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  page: { flex: 1, minHeight: 0 },
});
