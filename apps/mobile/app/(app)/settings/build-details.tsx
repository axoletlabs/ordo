/** Technical build provenance, kept out of the main About page. */
import React from "react";
import { Linking, Platform, StyleSheet, View } from "react-native";
import * as Clipboard from "expo-clipboard";
import { SettingsGroup, SettingsPage, SettingsScrollView } from "../../../src/components/settings/SettingsPage";
import { SettingRow } from "../../../src/components/ui/SettingRow";
import { Text } from "../../../src/components/ui/Text";
import { FloatingPanel } from "../../../src/components/ui/FloatingPanel";
import { PanelHeader } from "../../../src/components/ui/PanelHeader";
import { PanelActions } from "../../../src/components/ui/SheetActionRow";
import { toast } from "../../../src/components/ui/toast-store";
import { useBuildInfo } from "../../../src/hooks/use-build-info";
import { useOtaUpdate } from "../../../src/hooks/use-ota-update";
import { APP_VARIANT } from "../../../src/lib/app-variant";
import { releaseName } from "../../../src/lib/release-name";
import { haptics } from "../../../src/lib/haptics";
import { useTheme } from "../../../src/theme/ThemeProvider";
import { radius, spacing } from "../../../src/theme/tokens";

async function copyFingerprint(value: string): Promise<boolean> {
  haptics.light();
  try {
    await Clipboard.setStringAsync(value);
    toast.success("Fingerprint copied");
    return true;
  } catch {
    toast.error("Couldn't copy the fingerprint.");
    return false;
  }
}

/** Group compact hashes so the full value can wrap on a panel. */
function formatFingerprint(value: string): string {
  if (/[^A-Za-z0-9]/.test(value)) return value;
  return value.replace(/(.{8})/g, "$1 ").trim();
}

export default function BuildDetailsScreen() {
  const build = useBuildInfo();
  const commitRef = build.gitHash ?? build.gitHashShort;
  return (
    <SettingsPage title="Build details">
      <SettingsScrollView>
        <SettingsGroup label="Installed app" compact
          footer={build.gitDirty ? "Built from a working copy with uncommitted changes." : undefined}>
          <SettingRow icon="pricetag-outline" label="Version" value={releaseName(build.version)} />
          <SettingRow icon="flask-outline" label="Variant" value={APP_VARIANT === "stable" ? "Stable" : APP_VARIANT === "preview" ? "Preview" : "Development"} />
        </SettingsGroup>
        <SettingsGroup label="Source">
          <SettingRow icon="pricetag-outline" label="Bundle version" value={releaseName(build.releaseVersion)} />
          <SettingRow icon="git-commit-outline" label="Commit" value={build.gitHashShort ?? build.gitHash ?? "—"}
            onPress={commitRef ? () => { void Linking.openURL(`https://github.com/axoletlabs/ordo/commit/${commitRef}`).catch(() => toast.error("Couldn't open the commit.")); } : undefined}
            showChevron={!!commitRef} />
        </SettingsGroup>
        <RunningSettingsGroup />
      </SettingsScrollView>
    </SettingsPage>
  );
}

/**
 * OTA metadata changes on background checks and download-progress ticks. Keep
 * that subscription inside the group it paints so the static build metadata
 * stays mounted and untouched.
 */
function RunningSettingsGroup() {
  const { palette } = useTheme();
  const ota = useOtaUpdate();
  const [fingerprintOpen, setFingerprintOpen] = React.useState(false);
  const fingerprint = ota.runtimeVersion;
  const published = !ota.isEmbeddedLaunch ? ota.runningUpdateCreatedAt : null;
  const publishedLabel = published
    ? published.toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" })
    : null;

  return (
    <>
      <SettingsGroup label="Running">
        <SettingRow
          icon="layers-outline"
          label="Origin"
          value={Platform.OS === "web" ? "Web" : __DEV__ ? "Development server" : ota.isEmbeddedLaunch ? "Embedded" : ota.runningUpdateId ? "OTA" : "Embedded"}
        />
        <SettingRow
          icon="git-branch-outline"
          label="Channel"
          value={ota.channel ?? "—"}
        />
        {publishedLabel ? (
          <SettingRow icon="calendar-outline" label="Published" value={publishedLabel} />
        ) : null}
        <SettingRow
          icon="finger-print-outline"
          label="Build fingerprint"
          value={fingerprint ?? "—"}
          onPress={fingerprint ? () => setFingerprintOpen(true) : undefined}
        />
      </SettingsGroup>

      <FloatingPanel visible={fingerprintOpen} onDismiss={() => setFingerprintOpen(false)}>
        <PanelHeader
          icon="finger-print-outline"
          iconColor={palette.accent}
          iconBackground={palette.accentSoft}
          title="Build fingerprint"
          onClose={() => setFingerprintOpen(false)}
        />
        <View style={[styles.fingerprintBox, { backgroundColor: palette.surface, borderColor: palette.border }]}>
          <Text variant="mono" selectable>
            {fingerprint ? formatFingerprint(fingerprint) : "—"}
          </Text>
        </View>
        <PanelActions
          confirmLabel="Copy"
          onConfirm={() => {
            if (fingerprint) void copyFingerprint(fingerprint).then((copied) => { if (copied) setFingerprintOpen(false); });
          }}
        />
      </FloatingPanel>
    </>
  );
}

const styles = StyleSheet.create({
  fingerprintBox: { padding: spacing[16], borderWidth: StyleSheet.hairlineWidth, borderRadius: radius.md, marginVertical: spacing[16] },
});
