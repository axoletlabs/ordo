import React, { useState } from "react";
import { KeyboardAvoidingView, Platform } from "react-native";
import {
  SettingsForm,
  SettingsGroup,
  SettingsPage,
  SettingsScrollView,
} from "../../../src/components/settings/SettingsPage";
import { AnimatedSwap } from "../../../src/components/ui/AnimatedSwap";
import { SettingRow } from "../../../src/components/ui/SettingRow";
import { BackupCodesDialog } from "../../../src/components/auth/BackupCodesDialog";
import { MfaSetupPanel } from "../../../src/components/auth/MfaSetupPanel";
import { MfaStepUpPanel } from "../../../src/components/auth/MfaStepUpPanel";
import { toast } from "../../../src/components/ui/toast-store";
import { useAuthStore } from "../../../src/store/auth";
import { haptics } from "../../../src/lib/haptics";
import { useDisableTotp, useRegenerateBackupCodes } from "../../../src/hooks/use-auth-actions";

type StepUp = "regenerate" | "disable" | null;

export default function SecurityScreen() {
  const user = useAuthStore((s) => s.user);
  const setUser = useAuthStore((s) => s.setUser);
  const disableTotp = useDisableTotp();
  const regenerateBackupCodes = useRegenerateBackupCodes();
  const [backupCodes, setBackupCodes] = useState<string[] | null>(null);
  const [stepUp, setStepUp] = useState<StepUp>(null);

  return (
    <SettingsPage title="Security">
      <KeyboardAvoidingView
        behavior={Platform.OS === "ios" ? "padding" : undefined}
        style={{ flex: 1 }}
      >
        <SettingsScrollView keyboardShouldPersistTaps="handled">
          <AnimatedSwap transitionKey={user?.mfaEnabled ? "enabled" : "setup"}>
            {user?.mfaEnabled ? (
              <>
                <SettingsGroup label="Authenticator" compact>
                  <SettingRow
                    icon="key-outline"
                    label="New backup codes"
                    onPress={() => setStepUp("regenerate")}
                    showChevron
                  />
                </SettingsGroup>
                <SettingsGroup label="Danger zone">
                  <SettingRow
                    icon="close-circle-outline"
                    label="Turn off authenticator"
                    destructive
                    onPress={() => setStepUp("disable")}
                    showChevron
                  />
                </SettingsGroup>
              </>
            ) : (
              <SettingsGroup label="Authenticator" compact>
                <SettingsForm>
                  <MfaSetupPanel
                    onEnabled={(updated, codes) => {
                      setUser(updated);
                      setBackupCodes(codes);
                    }}
                  />
                </SettingsForm>
              </SettingsGroup>
            )}
          </AnimatedSwap>
        </SettingsScrollView>
      </KeyboardAvoidingView>

      <MfaStepUpPanel
        visible={stepUp !== null}
        onDismiss={() => setStepUp(null)}
        title={stepUp === "disable" ? "Turn off authenticator?" : "New backup codes"}
        description={
          stepUp === "disable"
            ? "Enter an authenticator or backup code."
            : "Your current backup codes will stop working."
        }
        confirmLabel={stepUp === "disable" ? "Turn off" : "Create codes"}
        confirmVariant={stepUp === "disable" ? "danger" : "primary"}
        onConfirm={async (code) => {
          if (stepUp === "disable") {
            await disableTotp.mutateAsync({ mfaCode: code });
            haptics.success();
            toast.success("Authenticator turned off");
            setStepUp(null);
            return;
          }
          if (stepUp !== "regenerate") return;
          const result = await regenerateBackupCodes.mutateAsync({ mfaCode: code });
          haptics.success();
          setStepUp(null);
          requestAnimationFrame(() => setBackupCodes(result.backupCodes));
        }}
      />

      <BackupCodesDialog codes={backupCodes} onClose={() => setBackupCodes(null)} />
    </SettingsPage>
  );
}
