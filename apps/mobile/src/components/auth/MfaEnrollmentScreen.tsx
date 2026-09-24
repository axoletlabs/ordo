import React, { useState } from "react";
import { View } from "react-native";
import type { UserDto } from "@ordo/shared";
import { Header } from "../ui/Header";
import { Text } from "../ui/Text";
import { BackupCodesDialog } from "./BackupCodesDialog";
import { MfaSetupPanel } from "./MfaSetupPanel";
import { SettingsScrollView } from "../settings/SettingsPage";
import { useAuthStore } from "../../store/auth";
import { useTheme } from "../../theme/ThemeProvider";
import { layout, spacing } from "../../theme/tokens";

/** Shown instead of the app when the server requires MFA and this account has none. */
export function MfaEnrollmentScreen() {
  const { palette } = useTheme();
  const setUser = useAuthStore((s) => s.setUser);
  const [pending, setPending] = useState<{ user: UserDto; codes: string[] } | null>(null);

  return (
    <View style={{ flex: 1, backgroundColor: palette.background }}>
      <Header title="Protect your account" large maxWidth={layout.maxSettingsWidth} />
      <SettingsScrollView>
        <View style={{ gap: spacing[16] }}>
          <Text variant="body" color="secondary">
            This server requires an authenticator before you can continue.
          </Text>
          {pending ? (
            <Text variant="body" color="secondary">
              Save your backup codes to continue.
            </Text>
          ) : (
            <MfaSetupPanel onEnabled={(user, backupCodes) => setPending({ user, codes: backupCodes })} />
          )}
        </View>
      </SettingsScrollView>
      <BackupCodesDialog
        codes={pending?.codes ?? null}
        onClose={() => {
          if (!pending) return;
          setUser(pending.user);
        }}
      />
    </View>
  );
}
