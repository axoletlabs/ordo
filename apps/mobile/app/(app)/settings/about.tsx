/** About, build provenance, updates, and project links. */
import React from "react";
import { Linking, StyleSheet } from "react-native";
import { SettingRow } from "../../../src/components/ui/SettingRow";
import { Text } from "../../../src/components/ui/Text";
import { OtaUpdateCard } from "../../../src/components/ui/OtaUpdater";
import { Toggle } from "../../../src/components/ui/Toggle";
import {
  SettingsGroup,
  SettingsPage,
  SettingsScrollView,
} from "../../../src/components/settings/SettingsPage";
import { useBuildInfo } from "../../../src/hooks/use-build-info";
import { useOtaUpdate } from "../../../src/hooks/use-ota-update";
import { useNativeUpdateStore } from "../../../src/store/native-update";
import { spacing } from "../../../src/theme/tokens";

const REPO_URL = "https://github.com/axoletlabs/ordo";
const PUBLISHED_YEAR = 2026;

export default function AboutScreen() {
  const build = useBuildInfo();
  const ota = useOtaUpdate();
  const nativeUpdate = useNativeUpdateStore();
  const commit = build.gitHashShort ?? build.gitHash ?? "—";
  const commitRef = build.gitHash ?? build.gitHashShort;
  const published = ota.runningUpdateCreatedAt;

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
            description={!ota.isEmbeddedLaunch && published ? `Published ${published.toLocaleDateString()}` : undefined}
            value={ota.isEmbeddedLaunch ? "Embedded" : "OTA"}
          />
          <SettingRow
            icon="finger-print-outline"
            label="Build fingerprint"
            value={ota.runtimeVersion ?? "—"}
            divider={false}
          />
        </SettingsGroup>

        <SettingsGroup
          label="Updates"
          footer="Off is GitHub’s latest stable only. On also offers pre-releases (alpha, then beta, then RC) when they outrank that stable."
        >
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
    </SettingsPage>
  );
}

const styles = StyleSheet.create({
  footer: { marginTop: spacing[24] },
});
