/** Stable app-owned readout. No portal/modal, hit testing, or animation loop. */
import React, { useEffect, useState, useSyncExternalStore } from "react";
import { StyleSheet, View, useWindowDimensions } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Text } from "./ui/Text";
import { getDiagnosticCapture, getDiagnosticCheck, getDiagnosticSnapshot, getDiagnosticStatus, subscribeDiagnosticCapture, subscribeDiagnostics } from "../lib/local-diagnostics";
import { useTheme } from "../theme/ThemeProvider";
import { radius, spacing } from "../theme/tokens";

export function DiagnosticsOverlay() {
  // Hidden readouts do not subscribe to or clone the event ring. The fixed
  // native parent stays mounted while the visible content is optional.
  const visible = useSyncExternalStore(subscribeDiagnostics, () => {
    const overlays = getDiagnosticStatus().overlays;
    return overlays.status || overlays.performance || overlays.rendering || overlays.layout;
  }, () => false);
  return <View collapsable={false} pointerEvents="none" accessible={false} accessibilityElementsHidden importantForAccessibility="no-hide-descendants"
    aria-hidden style={styles.root}>{visible ? <VisibleReadout /> : null}</View>;
}

function VisibleReadout() {
  const [state, setState] = useState(getDiagnosticStatus);
  useEffect(() => {
    let pending: ReturnType<typeof setTimeout> | undefined;
    const refresh = () => {
      if (pending !== undefined) return;
      pending = setTimeout(() => { pending = undefined; setState(getDiagnosticStatus()); }, 1000);
    };
    const unsubscribe = subscribeDiagnostics(refresh);
    const unsubscribeCapture = subscribeDiagnosticCapture(refresh);
    return () => { unsubscribe(); unsubscribeCapture(); clearTimeout(pending); };
  }, []);
  const { palette } = useTheme();
  const insets = useSafeAreaInsets();
  const { width } = useWindowDimensions();
  const visible = state.overlays.status || state.overlays.performance || state.overlays.rendering;
  const checking = getDiagnosticCheck() === "running";
  // Progress needs no event-ring clone while the app is being measured.
  const snapshot = visible && !checking ? getDiagnosticSnapshot() : null;
  const frames = snapshot?.measurements.findLast(sample => sample.kind === "frames");
  const render = snapshot?.measurements.findLast(sample => sample.kind === "render");
  const stats = frames?.value as { intervalP95Ms?: number; startModeRefreshHz?: number; status?: string } | undefined;
  const tree = render?.value as { nodes?: unknown[]; windowAlpha?: number; status?: string } | undefined;
  const capture = getDiagnosticCapture();
  return <>
    <View collapsable={false} pointerEvents="none" style={[styles.guides, { top: insets.top, bottom: insets.bottom, left: insets.left, right: insets.right,
      borderColor: palette.tertiary, opacity: state.overlays.layout ? 1 : 0 }]} />
    <View collapsable={false} style={[styles.readout, { opacity: visible ? 1 : 0, top: insets.top + spacing[8], right: Math.max(insets.right, spacing[16]),
      maxWidth: Math.max(80, Math.min(280, width - spacing[32])), backgroundColor: palette.inverseSurface }]}>
      <Text variant="labelMedium" style={{ color: palette.inverseOnSurface }}>{checking ? "Performance check" : "Diagnostic logs"}</Text>
      {checking ? <Text variant="bodySmall" style={{ color: palette.inverseOnSurface }}>Use the app as usual. Results save automatically.</Text>
        : <Text variant="bodySmall" style={{ color: palette.inverseOnSurface }}>{state.events} actions · {state.issues} errors</Text>}
      <Text variant="bodySmall" style={{ color: palette.inverseOnSurface, display: state.overlays.performance ? "flex" : "none" }}>
        {checking ? capture === "render" ? "Finishing check…" : capture === "frames" ? "Measuring timing · 15-second sample" : "Preparing check…"
          : frames ? `Saved sample · session ${frames.session} +${Math.round(frames.atMs / 1000)}s\n${stats?.startModeRefreshHz ? `${Math.round(stats.startModeRefreshHz)} Hz display · ` : ""}p95: ${stats?.intervalP95Ms?.toFixed(1) ?? "—"} ms · ${stats?.status ?? "unavailable"}` : "No saved timing sample."}
      </Text>
      <Text variant="bodySmall" style={{ color: palette.inverseOnSurface, display: state.overlays.rendering ? "flex" : "none" }}>
        {capture === "render" ? "Capturing rendering details…" : render ? `Last snapshot · session ${render.session} +${Math.round(render.atMs / 1000)}s: ${tree?.nodes?.length ?? 0} nodes · window alpha ${tree?.windowAlpha ?? "—"}` : "No rendering sample yet."}
      </Text>
    </View>
  </>;
}
const styles = StyleSheet.create({
  root: { position: "absolute", top: 0, left: 0, right: 0, bottom: 0, zIndex: 100, elevation: 100 },
  guides: { position: "absolute", borderWidth: 1, borderStyle: "dashed" },
  readout: { position: "absolute", borderRadius: radius.md, padding: spacing[12], gap: spacing[4] },
});
