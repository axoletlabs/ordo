import React from "react";
import { StyleSheet, View } from "react-native";
import type { BookmarkBrowserHandle } from "../browser/BookmarkBrowser";
import { Button } from "../ui/Button";
import { EmptyState } from "../ui/EmptyState";
import { LinearProgress } from "../ui/LinearProgress";
import { CLOUD_WEBSITE_URL } from "../../lib/hosting";
import { legalDocumentForUrl, legalDocumentHtml, type LegalDocument } from "../../lib/legal-document";

/** Keep the same policy presentation on web without changing the hosted site. */
export const LegalDocumentWeb = React.forwardRef<BookmarkBrowserHandle, {
  document: LegalDocument;
  pageStyle: string;
  onTitle: (title: string) => void;
}>(function LegalDocumentWeb({ document: initialDocument, pageStyle, onTitle }, ref) {
  const iframe = React.useRef<HTMLIFrameElement>(null);
  const [history, setHistory] = React.useState([initialDocument]);
  const document = history[history.length - 1];
  const url = `${CLOUD_WEBSITE_URL}/${document.id}`;
  const [source, setSource] = React.useState<{ url: string; html: string } | null>(null);
  const [error, setError] = React.useState(false);
  const [loading, setLoading] = React.useState(true);
  const [retry, setRetry] = React.useState(0);

  React.useImperativeHandle(ref, () => ({
    goBack: () => {
      if (history.length < 2) return false;
      setHistory((pages) => pages.slice(0, -1));
      return true;
    },
    reload: () => setRetry((value) => value + 1),
  }), [history.length]);

  React.useEffect(() => { onTitle(document.title); }, [document.title, onTitle]);
  React.useEffect(() => {
    const navigate = (event: MessageEvent) => {
      if (event.source !== iframe.current?.contentWindow || event.data?.type !== "ordo-legal-document") return;
      const next = typeof event.data.url === "string" ? legalDocumentForUrl(event.data.url) : undefined;
      if (next && next.id !== document.id) setHistory((pages) => [...pages, next]);
    };
    window.addEventListener("message", navigate);
    return () => window.removeEventListener("message", navigate);
  }, [document.id]);

  React.useEffect(() => {
    const controller = new AbortController();
    let cancelled = false;
    setError(false);
    setLoading(true);
    const timeout = setTimeout(() => controller.abort(), 12000);
    void fetch(url, { signal: controller.signal })
      .then(async (response) => {
        if (!response.ok) throw new Error("Policy unavailable");
        const html = await response.text();
        if (!html.includes('class="legal-page"')) throw new Error("Policy unavailable");
        if (!cancelled) setSource({ url, html });
      })
      .catch(() => { if (!cancelled) { setError(true); setLoading(false); } })
      .finally(() => clearTimeout(timeout));
    return () => { cancelled = true; clearTimeout(timeout); controller.abort(); };
  }, [url, retry]);

  const html = React.useMemo(() => source?.url === url
    ? legalDocumentHtml(source.html, url, pageStyle) : null, [source, url, pageStyle]);

  return (
    <View style={styles.body}>
      {error ? (
        <EmptyState icon="cloud-offline-outline" title="Couldn't load this document"
          message="Check your connection and try again."
          action={<Button label="Retry" onPress={() => setRetry((value) => value + 1)} />} />
      ) : html ? (
        <iframe ref={iframe} key={`${url}:${retry}`} title={document.title} srcDoc={html}
          sandbox="allow-scripts allow-popups allow-popups-to-escape-sandbox"
          onLoad={() => setLoading(false)} style={{ border: 0, width: "100%", height: "100%", flex: 1 }} />
      ) : null}
      {loading && !error ? <View style={styles.progress}><LinearProgress label="Loading document" /></View> : null}
    </View>
  );
});

const styles = StyleSheet.create({
  body: { flex: 1, minHeight: 0 },
  progress: { position: "absolute", top: 0, left: 0, right: 0 },
});
