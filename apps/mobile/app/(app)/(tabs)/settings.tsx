/** Settings hub: focused destinations for account and app preferences. */
import React, { useState } from "react";
import { StyleSheet, View } from "react-native";
import { useRouter } from "expo-router";
import { Header } from "../../../src/components/ui/Header";
import { SettingRow } from "../../../src/components/ui/SettingRow";
import { Button } from "../../../src/components/ui/Button";
import { ConfirmDialog } from "../../../src/components/ui/ConfirmDialog";
import { SettingsGroup, SettingsScrollView } from "../../../src/components/settings/SettingsPage";
import { useLogout } from "../../../src/hooks/use-auth-actions";
import { useFloatingDockMetrics } from "../../../src/hooks/use-floating-dock-metrics";
import { useTheme } from "../../../src/theme/ThemeProvider";
import { layout, spacing } from "../../../src/theme/tokens";

export default function SettingsScreen() {
  const { palette } = useTheme();
  const router = useRouter();
  const { visible: floatingNavigation, clearance: floatingBottomClearance } =
    useFloatingDockMetrics();
  const logout = useLogout();
  const [confirmingLogout, setConfirmingLogout] = useState(false);

  return (
    <View style={{ flex: 1, backgroundColor: palette.background }}>
      <Header title="Settings" large maxWidth={layout.maxSettingsWidth} />
      <SettingsScrollView
        contentContainerStyle={{
          paddingBottom: floatingNavigation ? floatingBottomClearance : spacing[40],
        }}
      >
        <SettingsGroup label="Preferences" compact>
          <SettingRow
            icon="person-circle-outline"
            label="Account"
            onPress={() => router.push("/settings/account")}
            showChevron
          />
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
          <SettingRow
            icon="phone-portrait-outline"
            label="Active sessions"
            onPress={() => router.push("/settings/sessions")}
            showChevron
          />
          <SettingRow
            icon="server-outline"
            label="Server"
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
            divider={false}
          />
        </SettingsGroup>

        <SettingsGroup style={styles.signoutGroup}>
          <View style={styles.signout}>
            <Button
              label="Sign out"
              variant="danger"
              block
              size="lg"
              loading={logout.isPending}
              onPress={() => setConfirmingLogout(true)}
            />
          </View>
        </SettingsGroup>
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
  signoutGroup: { marginTop: spacing[24] },
  signout: { padding: spacing[16] },
});
