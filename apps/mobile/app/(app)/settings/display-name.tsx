import React, { useState } from "react";
import { KeyboardAvoidingView, Platform } from "react-native";
import { useRouter } from "expo-router";
import { ChangeDisplayNameSchema } from "@ordo/shared";
import {
  SettingsForm,
  SettingsGroup,
  SettingsPage,
  SettingsScrollView,
} from "../../../src/components/settings/SettingsPage";
import { Button } from "../../../src/components/ui/Button";
import { Input } from "../../../src/components/ui/Input";
import { toast } from "../../../src/components/ui/toast-store";
import { useChangeDisplayName } from "../../../src/hooks/use-auth-actions";
import { errorMessage } from "../../../src/lib/error-message";
import { haptics } from "../../../src/lib/haptics";
import { useAuthStore } from "../../../src/store/auth";
import { spacing } from "../../../src/theme/tokens";

export default function ChangeDisplayNameScreen() {
  const router = useRouter();
  const user = useAuthStore((s) => s.user);
  const changeName = useChangeDisplayName();
  const [displayName, setDisplayName] = useState(user?.displayName ?? "");
  const [formError, setFormError] = useState("");

  const submit = async () => {
    setFormError("");
    const parsed = ChangeDisplayNameSchema.safeParse({ displayName: displayName.trim() });
    if (!parsed.success) {
      setFormError(parsed.error.issues[0]?.message || "Please check your input.");
      return;
    }

    try {
      await changeName.mutateAsync(parsed.data);
      haptics.success();
      toast.success("Display name updated");
      router.back();
    } catch (error) {
      haptics.error();
      setFormError(errorMessage(error));
    }
  };

  const unchanged = displayName.trim() === (user?.displayName ?? "");

  return (
    <SettingsPage title="Display name">
      <KeyboardAvoidingView
        behavior={Platform.OS === "ios" ? "padding" : undefined}
        style={{ flex: 1 }}
      >
        <SettingsScrollView keyboardShouldPersistTaps="handled" keyboardDismissMode="on-drag">
          <SettingsGroup compact>
            <SettingsForm style={styles.form}>
              <Input
                label="Display name"
                value={displayName}
                onChangeText={setDisplayName}
                placeholder="Your name"
                autoCapitalize="words"
                autoComplete="name"
                textContentType="name"
                error={formError || undefined}
              />
              <Button
                label="Save"
                block
                size="lg"
                onPress={submit}
                loading={changeName.isPending}
                disabled={!displayName.trim() || unchanged}
              />
            </SettingsForm>
          </SettingsGroup>
        </SettingsScrollView>
      </KeyboardAvoidingView>
    </SettingsPage>
  );
}

const styles = {
  form: { padding: spacing[16], gap: spacing[12] },
};
