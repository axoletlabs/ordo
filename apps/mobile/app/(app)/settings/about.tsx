/** About, build provenance, updates, and project links. */
import React from "react";
import { Linking, StyleSheet, View } from "react-native";
import * as Clipboard from "expo-clipboard";
import { SettingRow } from "../../../src/components/ui/SettingRow";
import { Text } from "../../../src/components/ui/Text";
import { Button } from "../../../src/components/ui/Button";
import { FloatingPanel } from "../../../src/components/ui/FloatingPanel";
import { PanelHeader } from "../../../src/components/ui/PanelHeader";
import { OtaUpdateCard } from "../../../src/components/ui/OtaUpdater";
import { Toggle } from "../../../src/components/ui/Toggle";
import { toast } from "../../../src/components/ui/toast-store";
import {
  SettingsGroup,
  SettingsPage,
  SettingsScrollView,
} from "../../../src/components/settings/SettingsPage";
import { useBuildInfo } from "../../../src/hooks/use-build-info";
import { useOtaUpdate } from "../../../src/hooks/use-ota-update";
import { useNativeUpdateStore } from "../../../src/store/native-update";
import { haptics } from "../../../src/lib/haptics";
import { useTheme } from "../../../src/theme/ThemeProvider";
import { radius, spacing } from "../../../src/theme/tokens";

const REPO_URL = "https://github.com/axoletlabs/ordo";
const PUBLISHED_YEAR = 2026;

async function copyFingerprint(value: string): Promise<void> {
  haptics.light();
  try {
    await Clipboard.setStringAsync(value);
    toast.success("Fingerprint copied");
  } catch {
    toast.error("Couldn't copy the fingerprint.");
  }
}

/** Group compact hashes so the full value can wrap on a panel. */
function formatFingerprint(value: string): string {
  if (/[^A-Za-z0-9]/.test(value)) return value;
  return value.replace(/(.{8})/g, "$1 ").trim();
}

export default function AboutScreen() {
  const { palette } = useTheme();
  const build = useBuildInfo();
  const ota = useOtaUpdate();
  const nativeUpdate = useNativeUpdateStore();
  const [fingerprintOpen, setFingerprintOpen] = React.useState(false);
  const commit = build.gitHashShort ?? build.gitHash ?? "—";
  const commitRef = build.gitHash ?? build.gitHashShort;
  const fingerprint = ota.runtimeVersion;
  const published = !ota.isEmbeddedLaunch ? ota.runningUpdateCreatedAt : null;
  const publishedLabel = published
    ? published.toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" })
    : null;

  return (
    <SettingsPage title="About">
      <SettingsScrollView>
        <SettingsGroup
          label="Version"
          compact
          footer={build.gitDirty ? "Built from a working copy with uncommitted changes." : undefined}
        >
          <SettingRow icon="pricetag-outline" label="Version" value={`v${build.version}`} />
          <SettingRow
            icon="git-commit-outline"
            label="Commit"
            value={commit}
            onPress={
              commitRef
                ? () => Linking.openURL(`${REPO_URL}/commit/${commitRef}`).catch(() => {})
                : undefined
            }
            divider={false}
          />
        </SettingsGroup>

        <SettingsGroup label="Running">
          <SettingRow
            icon="layers-outline"
            label="Origin"
            value={ota.isEmbeddedLaunch ? "Embedded" : "OTA"}
          />
          {publishedLabel ? (
            <SettingRow icon="calendar-outline" label="Published" value={publishedLabel} />
          ) : null}
          <SettingRow
            icon="finger-print-outline"
            label="Build fingerprint"
            value={fingerprint ?? "—"}
            onPress={fingerprint ? () => setFingerprintOpen(true) : undefined}
            divider={false}
          />
        </SettingsGroup>

        <SettingsGroup label="Updates">
          <OtaUpdateCard />
          <SettingRow
            icon="flask-outline"
            label="Early access updates"
            right={
              <Toggle
                value={nativeUpdate.includePrereleases}
                disabled={nativeUpdate.status === "checking" || nativeUpdate.status === "downloading"}
                onValueChange={(enabled) => void nativeUpdate.setIncludePrereleases(enabled)}
              />
            }
            rightFit="content"
            divider={false}
          />
        </SettingsGroup>

        <SettingsGroup label="Links">
          <SettingRow
            icon="logo-github"
            label="Source"
            value="GitHub"
            onPress={() => Linking.openURL(REPO_URL).catch(() => {})}
          />
          <SettingRow
            icon="shield-checkmark-outline"
            label="License"
            value="AGPL-3.0"
            divider={false}
          />
        </SettingsGroup>

        <Text variant="caption" color="tertiary" align="center" style={styles.footer}>
          © {PUBLISHED_YEAR} Axolet Labs
        </Text>
      </SettingsScrollView>

      <FloatingPanel visible={fingerprintOpen} onDismiss={() => setFingerprintOpen(false)}>
        <PanelHeader
          icon="finger-print-outline"
          iconColor={palette.accent}
          iconBackground={palette.accentSoft}
          title="Build fingerprint"
        />
        <View style={[styles.fingerprintBox, { backgroundColor: palette.surface, borderColor: palette.border }]}>
          <Text variant="mono" selectable>
            {fingerprint ? formatFingerprint(fingerprint) : "—"}
          </Text>
        </View>
        <View style={styles.fingerprintActions}>
          <Button
            label="Copy"
            size="lg"
            block
            onPress={() => {
              if (fingerprint) void copyFingerprint(fingerprint);
            }}
          />
          <Button label="Done" variant="ghost" block onPress={() => setFingerprintOpen(false)} />
        </View>
      </FloatingPanel>
    </SettingsPage>
  );
}

const styles = StyleSheet.create({
  footer: { marginTop: spacing[24] },
  fingerprintBox: {
    marginTop: spacing[4],
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: radius.lg,
    padding: spacing[12],
  },
  fingerprintActions: { gap: spacing[4], marginTop: spacing[12] },
});
