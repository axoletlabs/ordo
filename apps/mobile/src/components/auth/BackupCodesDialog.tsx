import React, { useEffect, useState } from "react";
import { StyleSheet, View } from "react-native";
import { PanelHeader } from "../ui/PanelHeader";
import { FloatingPanel } from "../ui/FloatingPanel";
import { ConfirmDialog } from "../ui/ConfirmDialog";
import { Text } from "../ui/Text";
import { PanelActions } from "../ui/SheetActionRow";
import { toast } from "../ui/toast-store";
import { downloadBackupCodes } from "../../lib/backup-codes-file";
import { isExportSaveCanceled } from "../../lib/import-export-file";
import { errorMessage } from "../../lib/error-message";
import { haptics } from "../../lib/haptics";
import { useTheme } from "../../theme/ThemeProvider";
import { layout, radius, spacing } from "../../theme/tokens";

/**
 * One-time backup-code sheet. Closing discards the plaintext codes; the server
 * only keeps hashes, so they cannot be shown again.
 */
export function BackupCodesDialog({
  codes,
  onClose,
}: {
  codes: string[] | null;
  onClose: () => void;
}) {
  const { palette } = useTheme();
  const [saving, setSaving] = useState(false);
  const [confirmClose, setConfirmClose] = useState(false);
  const visible = !!codes?.length;
  useEffect(() => { setConfirmClose(false); }, [codes]);

  const save = async () => {
    if (!codes?.length || saving) return;
    setSaving(true);
    try {
      await downloadBackupCodes(codes);
      haptics.success();
    } catch (e) {
      if (isExportSaveCanceled(e)) return;
      haptics.error();
      toast.error(errorMessage(e, "Couldn't save the codes."));
    } finally {
      setSaving(false);
    }
  };

  return (
    <>
    <FloatingPanel visible={visible} obscured={confirmClose} onDismiss={() => setConfirmClose(true)} maxWidth={layout.overlayConfirmWidth} dismissible={!saving}>
      <PanelHeader
        icon="key-outline"
        iconColor={palette.accent}
        iconBackground={palette.accentSoft}
        title="Save your backup codes"
        subtitle="Each code works once. Download them now — they won't be shown again."
        style={styles.header}
      />

      {codes ? (
        <View
          style={[
            styles.grid,
            { backgroundColor: palette.surface, borderColor: palette.border },
          ]}
        >
          {codes.map((code) => (
            <Text key={code} variant="mono" style={styles.code}>
              {code}
            </Text>
          ))}
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
    <ConfirmDialog visible={visible && confirmClose} onDismiss={() => setConfirmClose(false)}
      title="Close backup codes?" message="Make sure you have saved these codes. They cannot be shown again."
      tone="accent" confirmLabel="Close" cancelLabel="Keep viewing"
      onConfirm={() => { setConfirmClose(false); onClose(); }} />
    </>
  );
}

const styles = StyleSheet.create({
  header: { marginBottom: spacing[8] },
  grid: {
    marginTop: spacing[4],
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: radius.lg,
    paddingVertical: spacing[12],
    paddingHorizontal: spacing[8],
    flexDirection: "row",
    flexWrap: "wrap",
  },
  code: {
    width: "50%",
    textAlign: "center",
    paddingVertical: spacing[6],
    letterSpacing: 0.4,
  },
});
