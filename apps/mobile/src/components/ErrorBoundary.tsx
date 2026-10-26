/** Emergency rendering deliberately uses native controls, outside app providers. */
import React, { Component, type ReactNode } from "react";
import { Linking, Platform, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import * as Clipboard from "expo-clipboard";
import * as Updates from "expo-updates";
import * as SplashScreen from "expo-splash-screen";
import { currentAppPalette } from "../theme/current-app-palette";
import { radius, resolveFont } from "../theme/tokens";
import { reloadRuntime } from "../store/update-restart";
import { captureLocalError, collectLocalDiagnosticReport, getDiagnosticReportEpoch, localDiagnosticReport, recordDiagnosticEvent, subscribePreparedDiagnosticReport, type LocalErrorReport } from "../lib/local-diagnostics";

const RELEASES_URL = "https://github.com/axoletlabs/ordo/releases";

interface Props { children: ReactNode }
interface State { error: Error | null; report: LocalErrorReport | null }

// No ThemeProvider, portal, gesture handler, or Reanimated dependency in this
// fallback's render path: any of them may be the component that just failed.
function emergencyColors() {
  try { return currentAppPalette(); }
  catch {
    return { background: "#101414", surfaceContainerHigh: "#252b2a", onSurface: "#e0e3e1", onSurfaceVariant: "#bec9c5", primary: "#90d5bf", onPrimary: "#00382c" };
  }
}

function Fallback({ report, onReset }: { report: LocalErrorReport | null; onReset: () => void }) {
  const palette = emergencyColors();
  const [details, setDetails] = React.useState(false);
  const [notice, setNotice] = React.useState("");
  const [reportText, setReportText] = React.useState(localDiagnosticReport);
  const epoch = React.useRef(getDiagnosticReportEpoch());
  const [prepared, setPrepared] = React.useState(false);
  const [preparing, setPreparing] = React.useState(false);
  React.useEffect(() => subscribePreparedDiagnosticReport(() => {
    if (epoch.current === getDiagnosticReportEpoch()) return;
    epoch.current = getDiagnosticReportEpoch();
    setReportText(localDiagnosticReport()); setDetails(false); setPrepared(false);
  }), []);
  const review = async () => {
    if (preparing) return;
    setPreparing(true);
    const token = getDiagnosticReportEpoch();
    try {
      const text = await collectLocalDiagnosticReport();
      if (token !== getDiagnosticReportEpoch()) return;
      setReportText(text); setPrepared(true); setDetails(true);
    } catch { setNotice("Couldn't prepare a report. Close and reopen the app."); }
    finally { setPreparing(false); }
  };
  const copy = async () => {
    if (!prepared || epoch.current !== getDiagnosticReportEpoch()) return;
    try { await Clipboard.setStringAsync(reportText); setNotice("Report copied."); }
    catch { setNotice("Couldn't copy. You can select the report below."); }
  };
  const reload = () => {
    if (Platform.OS === "web" && typeof window !== "undefined") { window.location.reload(); return; }
    void reloadRuntime().catch(() => setNotice("Couldn't reload. Close and reopen the app."));
  };
  const action = (label: string, onPress: () => void, primary = false) => (
    <Pressable accessibilityRole="button" onPress={onPress}
      style={({ pressed }) => [styles.button, { backgroundColor: primary ? palette.primary : palette.surfaceContainerHigh, opacity: pressed ? 0.7 : 1 }]}>
      <Text style={[styles.label, { color: primary ? palette.onPrimary : palette.onSurface }]}>{label}</Text>
    </Pressable>
  );

  return (
    <ScrollView style={{ flex: 1, backgroundColor: palette.background }} contentContainerStyle={styles.root}>
      <View style={styles.card}>
        <Text accessibilityRole="header" style={[styles.title, { color: palette.onSurface }]}>Something went wrong</Text>
        <Text style={[styles.message, { color: palette.onSurfaceVariant }]}>Ordo couldn't display this screen. You can retry or copy a local report to help investigate.</Text>
        <Text selectable style={[styles.message, { color: palette.onSurface }]}>{report?.message ?? "Error details omitted for privacy."}</Text>
        <View style={styles.actions}>
          {action("Retry", onReset, true)}
          {action(preparing ? "Preparing report…" : "Review report", () => void review())}
          {prepared && details ? action("Copy report", () => void copy()) : null}
          {prepared ? action(details ? "Hide details" : "Show details", () => setDetails(!details)) : null}
          {Platform.OS === "web" || Updates.isEnabled ? action("Reload app", reload) : null}
        </View>
        {Platform.OS !== "web" && Updates.isEnabled ? <Text style={[styles.message, { color: palette.onSurfaceVariant }]}>Retry keeps this version. Reload applies any downloaded update.</Text> : null}
        <Text style={[styles.message, { color: palette.onSurfaceVariant }]}>Diagnostic reports stay on this device until you export them. Private content and unrestricted error messages are excluded. After restarting, open Settings → About → Build details → Diagnostics.</Text>
        {notice ? <Text accessibilityLiveRegion="polite" style={[styles.message, { color: palette.onSurface }]}>{notice}</Text> : null}
        {details ? reportText.match(/[\s\S]{1,3000}/g)?.map((chunk, index) => <Text key={index} selectable style={[styles.details, { color: palette.onSurface }]}>{chunk}</Text>) : null}
        {Updates.isEnabled && !Updates.isEmbeddedLaunch
          ? action("Open APK releases", () => void Linking.openURL(RELEASES_URL).catch(() => setNotice("Couldn't open releases."))) : null}
      </View>
    </ScrollView>
  );
}

export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null, report: null };
  static getDerivedStateFromError(error: unknown): Pick<State, "error"> {
    return { error: error instanceof Error ? error : new Error(typeof error === "string" ? error : "An unknown render error occurred") };
  }
  componentDidCatch(error: unknown, info: { componentStack?: string | null }) {
    const report = captureLocalError(error, "render", false, info.componentStack ?? "");
    this.setState({ report });
    void SplashScreen.hideAsync().catch(() => {});
  }
  reset = () => {
    recordDiagnosticEvent("error.retry");
    this.setState({ error: null, report: null });
  };
  render() {
    return this.state.error ? <Fallback report={this.state.report} onReset={this.reset} /> : this.props.children;
  }
}

const styles = StyleSheet.create({
  root: { flexGrow: 1, alignItems: "center", justifyContent: "center", paddingHorizontal: 24, paddingVertical: 64 },
  card: { width: "100%", maxWidth: 560, gap: 16 },
  title: { fontSize: 24, lineHeight: 32, fontFamily: resolveFont("sans", "400") },
  message: { fontSize: 14, lineHeight: 20, fontFamily: resolveFont("sans", "400") },
  actions: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  button: { minHeight: 48, paddingHorizontal: 24, paddingVertical: 14, justifyContent: "center", borderRadius: radius.full },
  label: { fontSize: 14, lineHeight: 20, fontFamily: resolveFont("sans", "500") },
  details: { fontSize: 12, lineHeight: 18, fontFamily: resolveFont("mono", "400") },
});
