import React, { useState, useSyncExternalStore } from "react";
import { SettingsGroup, SettingsPage, SettingsScrollView } from "./SettingsPage";
import { SettingRow } from "../ui/SettingRow";
import { Toggle } from "../ui/Toggle";
import { ConfirmDialog } from "../ui/ConfirmDialog";
import { toast } from "../ui/toast-store";
import { useAppRouter } from "../../hooks/use-app-router";
import { ISSUE_LABELS } from "../../lib/diagnostics/schema";
import { clearLocalDiagnostics, getDiagnosticCheck, getDiagnosticSnapshot, getDiagnosticStatus, markDiagnosticIssue, nativeDiagnosticsAvailable,
  prepareDiagnosticReport, runDiagnosticPerformanceCheck, setDiagnosticOverlay, setLocalDiagnosticsEnabled, stopDetailedDiagnostics, subscribeDiagnosticCapture, subscribeDiagnostics } from "../../lib/local-diagnostics";

export default function DiagnosticsScreen() {
  const state = useSyncExternalStore(subscribeDiagnostics, getDiagnosticStatus, getDiagnosticStatus);
  const check = useSyncExternalStore(subscribeDiagnosticCapture, getDiagnosticCheck, getDiagnosticCheck);
  const router = useAppRouter();
  const [toolsOpen, setToolsOpen] = useState(false);
  const [confirm, setConfirm] = useState<"disable" | "delete" | null>(null);
  const [preparing, setPreparing] = useState(false);
  const checking = check === "running", native = nativeDiagnosticsAvailable();
  const snapshot = toolsOpen ? getDiagnosticSnapshot() : null;
  const frames = snapshot?.measurements.findLast(sample => sample.kind === "frames");
  const render = snapshot?.measurements.findLast(sample => sample.kind === "render");
  const frameInterval = frames && "intervalP95Ms" in frames.value ? frames.value.intervalP95Ms : undefined;
  const overlay = Object.values(state.overlays).some(Boolean);
  const createReport = async () => {
    if (preparing) return;
    setPreparing(true);
    try {
      const report = await prepareDiagnosticReport();
      if (report) router.push("/diagnostics-report");
      else toast.error("Couldn't create a report. Try again.");
    } finally { setPreparing(false); }
  };
  const checkPerformance = async () => {
    if (getDiagnosticCheck() === "running") { stopDetailedDiagnostics(); return; }
    const pending = runDiagnosticPerformanceCheck();
    if (getDiagnosticCheck() === "running") toast.show("Performance check started");
    const result = await pending;
    if (result === "complete") toast.success("Performance check saved");
    else if (result === "partial") toast.show("Some measurements were unavailable. Available results saved.");
    else if (result === "unavailable" || result === "busy") toast.error("Couldn't run the check. Try again.");
  };
  const showOverlay = (value: boolean) => {
    setDiagnosticOverlay("status", value);
    setDiagnosticOverlay("performance", value && native);
    setDiagnosticOverlay("rendering", false);
    setDiagnosticOverlay("layout", false);
  };
  return <SettingsPage title="Diagnostics">
    <SettingsScrollView>
      <SettingsGroup compact footer="Logs stay on this device until you share a report.">
        <SettingRow icon="pulse-outline" label="Save diagnostic logs" description="App activity and errors" rightFit="content"
          right={<Toggle value={state.enabled} onValueChange={value => value ? setLocalDiagnosticsEnabled(true) : setConfirm("disable")} />} />
        {!state.storageAvailable ? <SettingRow icon="warning-outline" label="Storage unavailable" description="Logs may not survive a restart." /> : null}
      </SettingsGroup>
      <SettingsGroup label="Report a problem">
        <SettingRow icon="document-text-outline" label="Create report" description={!state.enabled ? "Build details only" : checking ? "Ready when the check finishes" : undefined}
          value={preparing ? "Preparing…" : undefined} disabled={preparing || checking} onPress={createReport} showChevron />
        {state.enabled ? <SettingRow icon="flag-outline" label="Mark a problem" description="Tap after something goes wrong."
          onPress={() => { markDiagnosticIssue(); toast.success("Problem marked in logs"); }} /> : null}
        {native ? <SettingRow icon={checking ? "stop-circle-outline" : "speedometer-outline"} label={checking ? "Stop performance check" : "Check performance"}
          description={checking ? "Use the app as usual. Results save automatically." : check === "complete" ? "Results saved. Run again if needed."
            : check === "partial" ? "Some results saved. You can try again." : check === "cancelled" ? "Check stopped. Tap to try again."
            : check === "unavailable" ? "Check unavailable. Tap to try again." : "15-second check while you use Ordo"}
          disabled={!state.enabled || preparing} onPress={checkPerformance} /> : null}
        {checking ? <SettingRow icon="information-circle-outline" label="Show check overlay" rightFit="content"
          right={<Toggle value={overlay} onValueChange={showOverlay} />} /> : null}
        <SettingRow icon="options-outline" label="More details" onPress={() => setToolsOpen(value => !value)} showChevron chevronUp={toolsOpen} />
      </SettingsGroup>
      {toolsOpen ? <>
        {frames || render ? <SettingsGroup label="Saved measurements">
          {frames ? <SettingRow icon="speedometer-outline" label="Frame timing" description="Main-thread p95, not displayed FPS."
            value={typeof frameInterval === "number" ? `${frameInterval.toFixed(1)} ms` : "Unavailable"} /> : null}
          {render ? <SettingRow icon="layers-outline" label="Screen layout" value={render.value.status === "complete" ? "Captured" : render.value.status === "partial" ? "Partial" : "Unavailable"} /> : null}
        </SettingsGroup> : null}
        {snapshot?.issues.length ? <SettingsGroup label="Recent errors">
          {snapshot.issues.slice(-3).reverse().map((issue, index) => <SettingRow key={`${issue.session}:${issue.code}:${index}`}
            icon="warning-outline" label={ISSUE_LABELS[issue.code]} value={issue.count > 1 ? `${issue.count} times` : undefined} />)}
        </SettingsGroup> : null}
        <SettingsGroup label="History" footer="Expires after 3 days. Private content and addresses are excluded.">
          <SettingRow icon="archive-outline" label="Saved logs" value={`${Math.ceil(state.bytes / 1024)} KB`} />
          <SettingRow icon="trash-outline" label="Delete history" destructive onPress={() => setConfirm("delete")} />
        </SettingsGroup>
      </> : null}
    </SettingsScrollView>
    <ConfirmDialog visible={confirm !== null} onDismiss={() => setConfirm(null)} tone="danger" icon="trash-outline"
      title={confirm === "disable" ? "Stop saving logs?" : "Delete history?"}
      message={confirm === "disable" ? "Checks will stop and local logs will be deleted. Saved reports stay where you put them." : "Local logs and prepared reports will be deleted. Saved copies won't be affected."}
      confirmLabel={confirm === "disable" ? "Turn off & delete" : "Delete"}
      onConfirm={() => { if (confirm === "disable") setLocalDiagnosticsEnabled(false); else clearLocalDiagnostics(); setConfirm(null); }} />
  </SettingsPage>;
}
