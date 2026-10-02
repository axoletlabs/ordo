/** Settings hub: focused destinations for account and app preferences. */
import React, { useState } from "react";
import { StyleSheet, View } from "react-native";
import { useRouter } from "expo-router";
import { Header } from "../../../src/components/ui/Header";
import { UserAvatar } from "../../../src/components/ui/UserAvatar";
import { MaterialIcon } from "../../../src/components/ui/MaterialIcon";
import { PressableScale } from "../../../src/components/ui/PressableScale";
import { Text } from "../../../src/components/ui/Text";
import { useAuthStore } from "../../../src/store/auth";
import { SettingRow } from "../../../src/components/ui/SettingRow";
import { Button } from "../../../src/components/ui/Button";
import { ConfirmDialog } from "../../../src/components/ui/ConfirmDialog";
import { SettingsGroup, SettingsScrollView } from "../../../src/components/settings/SettingsPage";
import { useLogout } from "../../../src/hooks/use-auth-actions";
import { useFloatingDockMetrics } from "../../../src/hooks/use-floating-dock-metrics";
import { hostingModeOf } from "../../../src/lib/hosting";
import { useSettingsStore } from "../../../src/store/settings";
import { useTheme } from "../../../src/theme/ThemeProvider";
import { layout, radius, spacing } from "../../../src/theme/tokens";

export default function SettingsScreen() {
  const { palette } = useTheme();
  const router = useRouter();
  const { visible: floatingNavigation, clearance: floatingBottomClearance } =
    useFloatingDockMetrics();
  const logout = useLogout();
  const [confirmingLogout, setConfirmingLogout] = useState(false);
  const serverUrl = useSettingsStore((s) => s.serverUrl);
  const user = useAuthStore((s) => s.user);

  return (
    <View style={{ flex: 1, backgroundColor: palette.background }}>
      <Header title="Settings" showBack onBack={() => router.navigate("/")} maxWidth={layout.maxSettingsWidth} />
      <SettingsScrollView
        contentContainerStyle={{
          paddingBottom: floatingNavigation ? floatingBottomClearance : spacing[40],
        }}
      >
        <PressableScale accessibilityRole="button" accessibilityLabel="Manage your account"
          onPress={() => router.push("/settings/account")} stateLayerColor={palette.onSurface}
          style={{ flexDirection: "row", alignItems: "center", gap: spacing[16], padding: spacing[16],
            backgroundColor: palette.surfaceContainer, borderRadius: radius.xl, marginBottom: spacing[8] }}>
          <UserAvatar user={user} size={48} />
          <View style={{ flex: 1, minWidth: 0, gap: spacing[4] }}>
            <Text variant="titleMedium" numberOfLines={1}>{user?.displayName ?? "Your account"}</Text>
            <Text variant="bodyMedium" color="secondary" numberOfLines={1}>{user?.email ?? "Manage account"}</Text>
          </View>
          <MaterialIcon name="chevron-forward" color={palette.onSurfaceVariant} />
        </PressableScale>
        <SettingsGroup label="Preferences">
          <SettingRow
            icon="color-palette-outline"
            label="Appearance"
            onPress={() => router.push("/settings/appearance")}
            showChevron
          />
          <SettingRow
            icon="options-outline"
            label="Controls"
            onPress={() => router.push("/settings/controls")}
            showChevron
          />
        </SettingsGroup>
        <SettingsGroup label="Account and storage">
          <SettingRow
            icon="phone-portrait-outline"
            label="Active sessions"
            onPress={() => router.push("/settings/sessions")}
            showChevron
          />
          <SettingRow
            icon={hostingModeOf(serverUrl) === "cloud" ? "cloud-outline" : "server-outline"}
            label="Hosting"
            onPress={() => router.push("/settings/server")}
            showChevron
          />
          <SettingRow
            icon="swap-horizontal-outline"
            label="Data"
            onPress={() => router.push("/settings/data")}
            showChevron
          />
          <SettingRow
            icon="information-circle-outline"
            label="About"
            onPress={() => router.push("/settings/about")}
            showChevron
          />
        </SettingsGroup>

        <Button
          label="Sign out"
          variant="danger"
          block
          size="md"
          loading={logout.isPending}
          onPress={() => setConfirmingLogout(true)}
          style={styles.signout}
        />
      </SettingsScrollView>

      <ConfirmDialog
        visible={confirmingLogout}
        onDismiss={() => setConfirmingLogout(false)}
        icon="log-out-outline"
        title="Sign out?"
        message="You'll need to sign in again."
        confirmLabel="Sign out"
        loading={logout.isPending}
        dismissible={!logout.isPending}
        onConfirm={() => logout.mutate()}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  signout: {
    marginTop: spacing[20],
    marginHorizontal: layout.rowInset,
    width: "auto",
    alignSelf: "stretch",
  },
});
