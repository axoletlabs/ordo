import React, { useState } from "react";
import { StyleSheet, View } from "react-native";
import { PanelHeader } from "../ui/PanelHeader";
import { FloatingPanel } from "../ui/FloatingPanel";
import { Text } from "../ui/Text";
import { PanelActions } from "../ui/SheetActionRow";
import { toast } from "../ui/toast-store";
import { downloadRecoveryKey } from "../../lib/recovery-key-file";
import { errorMessage } from "../../lib/error-message";
import { haptics } from "../../lib/haptics";
import { useTheme } from "../../theme/ThemeProvider";
import { layout, radius, spacing } from "../../theme/tokens";

/**
 * One-time library recovery key. Closing discards the plaintext key; the
 * server cannot show it again.
 */
export function RecoveryKeyDialog({
  recoveryKey,
  onClose,
}: {
  recoveryKey: string | null;
  onClose: () => void;
}) {
  const { palette } = useTheme();
  const [saving, setSaving] = useState(false);
  const visible = !!recoveryKey;

  const save = async () => {
    if (!recoveryKey || saving) return;
    setSaving(true);
    try {
      await downloadRecoveryKey(recoveryKey);
      haptics.success();
    } catch (e) {
      haptics.error();
      toast.error(errorMessage(e, "Couldn't save the key."));
    } finally {
      setSaving(false);
    }
  };

  return (
    <FloatingPanel visible={visible} onDismiss={onClose} maxWidth={layout.overlayConfirmWidth} dismissible={false}>
      <PanelHeader
        icon="shield-checkmark-outline"
        iconColor={palette.accent}
        iconBackground={palette.accentSoft}
        title="Save your recovery key"
        subtitle="If you forget your password, this key is the only way to unlock your library. Download it now — it won't be shown again."
        style={styles.header}
      />

      {recoveryKey ? (
        <View
          style={[
            styles.keyBox,
            { backgroundColor: palette.surface, borderColor: palette.border },
          ]}
        >
          <Text variant="mono" style={styles.key}>
            {recoveryKey}
          </Text>
        </View>
      ) : null}

      <PanelActions
        confirmLabel="Download"
        cancelLabel="Done"
        onConfirm={() => void save()}
        onCancel={onClose}
        loading={saving}
      />
    </FloatingPanel>
  );
}

const styles = StyleSheet.create({
  header: { marginBottom: spacing[8] },
  keyBox: {
    marginTop: spacing[4],
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: radius.lg,
    paddingVertical: spacing[16],
    paddingHorizontal: spacing[12],
  },
  key: {
    textAlign: "center",
    letterSpacing: 0.3,
  },
});
