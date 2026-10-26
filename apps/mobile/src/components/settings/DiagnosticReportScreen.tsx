import React, { useEffect, useMemo, useState, useSyncExternalStore } from "react";
import { StyleSheet, View } from "react-native";
import * as Clipboard from "expo-clipboard";
import { SettingsGroup, SettingsPage, SettingsScrollView } from "./SettingsPage";
import { SettingRow } from "../ui/SettingRow";
import { Toggle } from "../ui/Toggle";
import { Button } from "../ui/Button";
import { Text } from "../ui/Text";
import { toast } from "../ui/toast-store";
import { useAppRouter } from "../../hooks/use-app-router";
import { downloadDiagnosticReport, cancelDiagnosticExport } from "../../lib/diagnostics/export";
import { DEFAULT_REPORT_SELECTION, discardPreparedDiagnosticReport, getPreparedDiagnosticReport, serializeDiagnosticReport, subscribePreparedDiagnosticReport, type ReportSelection } from "../../lib/local-diagnostics";
import { utf8Bytes } from "../../lib/diagnostics/schema";
import { spacing, layout } from "../../theme/tokens";

const SECTIONS = [
  { key: "actions", label: "Recent actions" },
  { key: "errors", label: "Errors" },
  { key: "measurements", label: "Measurements" },
  { key: "native", label: "Android details" },
] as const;
export default function DiagnosticReportScreen() {
  const report = useSyncExternalStore(subscribePreparedDiagnosticReport, getPreparedDiagnosticReport, getPreparedDiagnosticReport);
  const router = useAppRouter();
  const [selection, setSelection] = useState<ReportSelection>({ ...DEFAULT_REPORT_SELECTION, native: report?.snapshot.build.platform === "android" });
  const [previewOpen, setPreviewOpen] = useState(false);
  const [sectionsOpen, setSectionsOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const text = useMemo(() => report ? serializeDiagnosticReport(report, selection) : null, [report, selection]);
  // A system share recipient can read its URI after this screen is closed.
  // Explicit discard, deletion, and the export TTL revoke the staging file.
  useEffect(() => () => { discardPreparedDiagnosticReport(); }, []);
  const exportReport = async (copy: boolean) => {
    if (!report || !text || saving) return;
    setSaving(true);
    try {
      // Preview, copy, and export always use these same selected bytes.
      if (serializeDiagnosticReport(report, selection) !== text) return;
      if (copy) { await Clipboard.setStringAsync(text); toast.success("Report copied"); }
      else if (await downloadDiagnosticReport(text, report.id, report.generation)) toast.success("Report saved");
    } catch { toast.error("Couldn't save the report. Try again."); }
    finally { setSaving(false); }
  };
  return <SettingsPage title="Review report">
    <SettingsScrollView>
      {!report || !text ? <SettingsGroup compact>
        <SettingRow icon="document-text-outline" label="No report to review" />
        <View style={styles.actions}><Button label="Create a report" onPress={() => router.replace("/diagnostics")} /></View>
      </SettingsGroup> : <>
        <SettingsGroup compact footer={report.oneTime ? "Recording is off. This report contains build details only." : "Private content is excluded. Nothing is sent automatically."}>
          <SettingRow icon="document-text-outline" label="View report" value={`${Math.ceil(utf8Bytes(text) / 1024)} KB`}
            onPress={() => setPreviewOpen(value => !value)} showChevron chevronUp={previewOpen} />
          {previewOpen ? <View style={styles.preview}>
            {text.match(/[\s\S]{1,3000}/g)?.map((chunk, index) => <Text key={index} variant="monoSmall" selectable>{chunk}</Text>)}
          </View> : null}
          {!report.oneTime ? <>
            <SettingRow icon="options-outline" label="Choose sections" onPress={() => setSectionsOpen(value => !value)} showChevron chevronUp={sectionsOpen} />
            {sectionsOpen ? SECTIONS.filter(section => section.key !== "native" || report.snapshot.build.platform === "android").map(section => <SettingRow key={section.key} label={section.label} rightFit="content"
              right={<Toggle value={selection[section.key]} disabled={saving} onValueChange={value => setSelection(previous => ({ ...previous, [section.key]: value }))} />} />) : null}
          </> : null}
        </SettingsGroup>
        <View style={styles.actions}>
          <Button label="Save report" size="md" loading={saving} onPress={() => { void exportReport(false); }} block />
          <Button label="Copy report" variant="outlined" disabled={saving} onPress={() => { void exportReport(true); }} block />
          <Button label="Discard" variant="ghost" disabled={saving} onPress={() => { cancelDiagnosticExport(); discardPreparedDiagnosticReport(); router.back(); }} block />
        </View>
      </>}
    </SettingsScrollView>
  </SettingsPage>;
}
const styles = StyleSheet.create({
  actions: { paddingHorizontal: layout.rowInset, paddingVertical: spacing[16], gap: spacing[8] },
  preview: { padding: layout.rowInset, gap: spacing[8] },
});
