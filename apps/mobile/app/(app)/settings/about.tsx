/** App identity, updates, project links, and readable legal information. */
import React from "react";
import { Linking, StyleSheet, View } from "react-native";
import { ChangelogSheet } from "../../../src/components/settings/ChangelogList";
import { SettingsGroup, SettingsPage, SettingsScrollView } from "../../../src/components/settings/SettingsPage";
import { SettingRow } from "../../../src/components/ui/SettingRow";
import { Text } from "../../../src/components/ui/Text";
import { Logo } from "../../../src/components/ui/Logo";
import { OtaUpdateCard } from "../../../src/components/ui/OtaUpdater";
import { PressableScale } from "../../../src/components/ui/PressableScale";
import { toast } from "../../../src/components/ui/toast-store";
import { useBuildInfo } from "../../../src/hooks/use-build-info";
import { useAppRouter } from "../../../src/hooks/use-app-router";
import { useNativeUpdateStore } from "../../../src/store/native-update";
import { APP_VARIANT } from "../../../src/lib/app-variant";
import { releaseName } from "../../../src/lib/release-name";
import { CLOUD_WEBSITE_URL } from "../../../src/lib/hosting";
import { useTheme } from "../../../src/theme/ThemeProvider";
import { layout, radius, spacing } from "../../../src/theme/tokens";

const REPO_URL = "https://github.com/axoletlabs/ordo";
const LEGAL_LINKS = [
  { label: "Terms of service", path: "terms", icon: "document-text-outline" as const },
  { label: "Privacy policy", path: "privacy", icon: "shield-checkmark-outline" as const },
  { label: "Security", path: "security", icon: "lock-closed-outline" as const },
];

function openURL(url: string): void {
  void Linking.openURL(url).catch(() => toast.error("Couldn't open the link."));
}

export default function AboutScreen() {
  const router = useAppRouter();
  const build = useBuildInfo();
  const { palette } = useTheme();
  // Download progress must not rebuild the entire About screen.
  const nativeRelease = useNativeUpdateStore((state) => state.release);
  const [changelogOpen, setChangelogOpen] = React.useState(false);
  const variant = APP_VARIANT === "stable" ? null : APP_VARIANT === "preview" ? "Preview" : "Development";

  return (
    <SettingsPage title="About">
      <SettingsScrollView>
        <View style={styles.identity}>
          <Logo width={48} />
          <Text variant="headlineLarge" accessibilityRole="header">ordo</Text>
          <Text variant="bodyLarge" color="secondary" align="center">A home for everything you want to read.</Text>
          <View style={[styles.version, { backgroundColor: palette.secondaryContainer }]}>
            <Text variant="labelLarge" style={{ color: palette.onSecondaryContainer }}>
              {releaseName(build.version)}{variant ? ` · ${variant}` : ""}
            </Text>
          </View>
        </View>

        <SettingsGroup label="Updates" compact>
          {APP_VARIANT !== "development" ? <OtaUpdateCard /> : null}
          <SettingRow icon="newspaper-outline" label="What's new"
            value={nativeRelease ? releaseName(nativeRelease.version) : undefined}
            onPress={() => setChangelogOpen(true)} showChevron />
          <SettingRow icon="information-circle-outline" label="Build details"
            onPress={() => router.push("/settings/build-details")} showChevron />
        </SettingsGroup>

        <SettingsGroup label="The project">
          <SettingRow icon="globe-outline" label="Ordo website" onPress={() => openURL(CLOUD_WEBSITE_URL)} showChevron />
          <SettingRow icon="logo-github" label="Source code" onPress={() => openURL(REPO_URL)} showChevron />
        </SettingsGroup>

        <SettingsGroup label="Legal & privacy">
          <SettingRow icon="ribbon-outline" label="Ordo license" value="AGPL-3.0"
            onPress={() => router.push({ pathname: "/settings/license", params: { id: "ordo" } })} showChevron />
          <SettingRow icon="code-slash-outline" label="Open source licenses"
            onPress={() => router.push("/settings/licenses")} showChevron />
          {LEGAL_LINKS.map((link) => (
            <SettingRow key={link.path} icon={link.icon} label={link.label}
              onPress={() => router.push({ pathname: "/settings/browser", params: { document: link.path } })} showChevron />
          ))}
        </SettingsGroup>

        <View style={styles.footer}>
          <Text variant="bodyMedium" color="secondary" align="center">Made by Axolet. Built with open source.</Text>
          <PressableScale accessibilityRole="link" accessibilityLabel="Axolet website" onPress={() => openURL("https://axolet.com")}
            style={styles.copyright}>
            <Text variant="bodySmall" color="secondary">© 2026 Axolet</Text>
          </PressableScale>
        </View>
      </SettingsScrollView>

      <ChangelogSheet visible={changelogOpen} onDismiss={() => setChangelogOpen(false)} />
    </SettingsPage>
  );
}

const styles = StyleSheet.create({
  identity: { alignItems: "center", gap: spacing[8], paddingHorizontal: layout.rowInset, paddingTop: spacing[16], paddingBottom: spacing[32] },
  version: { borderRadius: radius.full, paddingHorizontal: spacing[12], paddingVertical: spacing[6], marginTop: spacing[8] },
  footer: { alignItems: "center", paddingTop: spacing[32], paddingHorizontal: layout.rowInset },
  copyright: { minHeight: 48, justifyContent: "center", paddingHorizontal: spacing[16] },
});
