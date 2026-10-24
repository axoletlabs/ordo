/** About, build provenance, updates, and project links. */
import React from "react";
import { Platform, StyleSheet, View } from "react-native";
import { ChangelogSheet } from "../../../src/components/settings/ChangelogList";
import * as Clipboard from "expo-clipboard";
import { SettingRow } from "../../../src/components/ui/SettingRow";
import { Text } from "../../../src/components/ui/Text";
import { PanelActions } from "../../../src/components/ui/SheetActionRow";
import { FloatingPanel } from "../../../src/components/ui/FloatingPanel";
import { PanelHeader } from "../../../src/components/ui/PanelHeader";
import { OtaUpdateCard } from "../../../src/components/ui/OtaUpdater";
import { toast } from "../../../src/components/ui/toast-store";
import {
  SettingsGroup,
  SettingsPage,
  SettingsScrollView,
} from "../../../src/components/settings/SettingsPage";
import { useBuildInfo } from "../../../src/hooks/use-build-info";
import { useAppRouter } from "../../../src/hooks/use-app-router";
import { useOtaUpdate } from "../../../src/hooks/use-ota-update";
import { useNativeUpdateStore } from "../../../src/store/native-update";
import { APP_VARIANT } from "../../../src/lib/app-variant";
import { releaseName } from "../../../src/lib/release-name";
import { haptics } from "../../../src/lib/haptics";
import { CLOUD_WEBSITE_URL } from "../../../src/lib/hosting";
import { openInAppBrowser } from "../../../src/lib/open-website";
import { useTheme } from "../../../src/theme/ThemeProvider";
import { radius, spacing } from "../../../src/theme/tokens";

const REPO_URL = "https://github.com/axoletlabs/ordo";
const AXOLET_URL = "https://axolet.com";
const LEGAL_URL = CLOUD_WEBSITE_URL;
const LEGAL_LINKS = [
  { label: "Terms", path: "/terms", icon: "document-text-outline" as const },
  { label: "Privacy", path: "/privacy", icon: "shield-checkmark-outline" as const },
  { label: "Security", path: "/security", icon: "lock-closed-outline" as const },
];
const PUBLISHED_YEAR = 2026;
const TELEMETRY_FOOTER =
  "The app sends anonymous counts to ordo Cloud: installs, opens, sign-ins, registrations, and coarse health (timeouts, server errors, sign-in failures, startup speed). Platform, version, and Cloud or self-host are included. Your account, server URL, and library are not.";

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

export default function AboutScreen() {
  const router = useAppRouter();
  const openURL = (url: string, title: string) => {
    // GitHub forbids iframes on web; native WebViews can load it normally.
    if (Platform.OS === "web" && new URL(url).hostname === "github.com") {
      void openInAppBrowser(url);
      return;
    }
    router.push({ pathname: "/settings/browser", params: { url, title } });
  };
  const build = useBuildInfo();
  // This page only needs the offered release version for the Changelog row.
  // Download progress ticks many times per second; subscribing to the whole
  // native-update store rebuilt every About group on each tick.
  const nativeRelease = useNativeUpdateStore((state) => state.release);
  const [changelogOpen, setChangelogOpen] = React.useState(false);
  const commit = build.gitHashShort ?? build.gitHash ?? "—";
  const commitRef = build.gitHash ?? build.gitHashShort;

  return (
    <SettingsPage title="About">
      <SettingsScrollView>
        <SettingsGroup
          label="Version"
          compact
          footer={build.gitDirty ? "Built from a working copy with uncommitted changes." : undefined}
        >
          <SettingRow icon="pricetag-outline" label="Version" value={releaseName(build.version)} />
          <SettingRow icon="flask-outline" label="Variant" value={APP_VARIANT === "stable" ? "Stable" : APP_VARIANT === "preview" ? "Preview" : "Development"} />
          <SettingRow
            icon="git-commit-outline"
            label="Commit"
            value={commit}
            onPress={commitRef ? () => openURL(`${REPO_URL}/commit/${commitRef}`, "Commit") : undefined}
          />
        </SettingsGroup>

        <RunningSettingsGroup />

        <SettingsGroup
          label="Updates"
          footer={APP_VARIANT === "development"
            ? "Development builds are installed manually from GitHub Actions. OTA and in-app updates are disabled."
            : undefined}
        >
          {APP_VARIANT !== "development" ? <OtaUpdateCard /> : null}
          <SettingRow
            icon="newspaper-outline"
            label="Changelog"
            value={nativeRelease ? releaseName(nativeRelease.version) : undefined}
            onPress={() => setChangelogOpen(true)}
            showChevron
          />
        </SettingsGroup>

        <SettingsGroup label="Links">
          <SettingRow
            icon="logo-github"
            label="Source"
            value="GitHub"
            onPress={() => openURL(REPO_URL, "Source")}
          />
          <SettingRow
            icon="globe-outline"
            label="Website"
            value="Ordo"
            onPress={() => openURL(CLOUD_WEBSITE_URL, "Website")}
          />
          <SettingRow
            icon="ribbon-outline"
            label="License"
            value="AGPL-3.0"
          />
        </SettingsGroup>

        <SettingsGroup label="Legal" footer={TELEMETRY_FOOTER}>
          {LEGAL_LINKS.map((link) => (
            <SettingRow
              key={link.path}
              icon={link.icon}
              label={link.label}
              onPress={() => openURL(`${LEGAL_URL}${link.path}`, link.label)}
              showChevron
            />
          ))}
        </SettingsGroup>

        <View style={styles.copyrightRow}>
          <Text
            variant="footnote"
            color="tertiary"
            onPress={() => openURL(AXOLET_URL, "Axolet")}
            suppressHighlighting
            accessibilityRole="link"
            accessibilityLabel="© Axolet"
          >
            © {PUBLISHED_YEAR} Axolet
          </Text>
        </View>
      </SettingsScrollView>

      <ChangelogSheet visible={changelogOpen} onDismiss={() => setChangelogOpen(false)} />
    </SettingsPage>
  );
}

/**
 * OTA metadata changes on background checks and download-progress ticks. Keep
 * that subscription inside the group it paints so the rest of About (links,
 * legal copy, updates, changelog) stays mounted and untouched.
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
          value={ota.isEmbeddedLaunch ? "Embedded" : "OTA"}
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
  copyrightRow: {
    alignItems: "center",
    paddingTop: spacing[16],
    paddingBottom: spacing[8],
  },
  fingerprintBox: {
    marginTop: spacing[4],
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: radius.lg,
    padding: spacing[12],
  },
});
