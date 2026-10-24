/** A document-focused view for the three published legal policies. */
import React from "react";
import { Platform, StyleSheet, View } from "react-native";
import { useIsFocused, useLocalSearchParams } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { BookmarkBrowser, type BookmarkBrowserHandle } from "../../../src/components/browser/BookmarkBrowser";
import { LegalDocumentWeb } from "../../../src/components/settings/LegalDocumentWeb";
import { SettingsPage } from "../../../src/components/settings/SettingsPage";
import { EmptyState } from "../../../src/components/ui/EmptyState";
import { Header } from "../../../src/components/ui/Header";
import { useAppRouter } from "../../../src/hooks/use-app-router";
import { CLOUD_WEBSITE_URL } from "../../../src/lib/hosting";
import { LEGAL_DOCUMENTS, legalDocumentForUrl, legalDocumentStyle, type LegalDocument } from "../../../src/lib/legal-document";
import { useTheme } from "../../../src/theme/ThemeProvider";
import { layout } from "../../../src/theme/tokens";

export default function LegalDocumentScreen() {
  const params = useLocalSearchParams<{ document?: string }>();
  const id = Array.isArray(params.document) ? params.document[0] : params.document;
  const document = LEGAL_DOCUMENTS.find((doc) => doc.id === id);
  if (!document) return (
    <SettingsPage title="Legal">
      <EmptyState icon="cloud-offline-outline" title="Couldn't open this document" message="This policy link is missing or invalid." />
    </SettingsPage>
  );
  return <LegalDocumentPane key={document.id} document={document} />;
}

function LegalDocumentPane({ document }: { document: LegalDocument }) {
  const router = useAppRouter();
  const active = useIsFocused();
  const insets = useSafeAreaInsets();
  const { palette } = useTheme();
  const browser = React.useRef<BookmarkBrowserHandle>(null);
  const [title, setTitle] = React.useState<string>(document.title);
  const pageStyle = React.useMemo(() => legalDocumentStyle(palette), [palette]);
  const close = () => router.canGoBack() ? router.back() : router.replace("/settings/about");

  return (
    <View style={[styles.page, { backgroundColor: palette.background }]}>
      <Header title={title} showBack maxWidth={layout.maxReaderWidth}
        onBack={() => browser.current?.goBack() || close()} />
      <View style={[styles.page, { paddingLeft: insets.left, paddingRight: insets.right, paddingBottom: insets.bottom }]}>
        {Platform.OS === "web" ? (
          <LegalDocumentWeb ref={browser} document={document} pageStyle={pageStyle} onTitle={setTitle} />
        ) : (
          <BookmarkBrowser ref={browser} url={`${CLOUD_WEBSITE_URL}/${document.id}`} pageStyle={pageStyle}
            active={active} onPageUrl={(url) => setTitle(legalDocumentForUrl(url)?.title ?? document.title)} />
        )}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({ page: { flex: 1, minHeight: 0 } });
