import React, { useState } from "react";
import { StyleSheet, View, useWindowDimensions } from "react-native";
import { PressableScale } from "../ui/PressableScale";
import QRCode from "react-native-qrcode-svg";
import { Button } from "../ui/Button";
import { Text } from "../ui/Text";
import { OtpInput, type OtpStatus } from "../ui/OtpInput";
import { FloatingPanel } from "../ui/FloatingPanel";
import { PanelHeader } from "../ui/PanelHeader";
import { PanelActions } from "../ui/SheetActionRow";
import { authApi } from "../../lib/api/auth";
import { copyText } from "../../lib/copy-link";
import { errorMessage } from "../../lib/error-message";
import { haptics } from "../../lib/haptics";
import { useTheme } from "../../theme/ThemeProvider";
import { radius, spacing } from "../../theme/tokens";
import type { UserDto } from "@ordo/shared";

export function MfaSetupPanel({
  onEnabled,
  existingCode,
}: {
  onEnabled: (user: UserDto, backupCodes: string[]) => void;
  /** Required when rotating an already-enabled authenticator. */
  existingCode?: string;
}) {
  const { palette } = useTheme();
  const { width, height } = useWindowDimensions();
  const [secret, setSecret] = useState<string | null>(null);
  const [otpauthUrl, setOtpauthUrl] = useState<string | null>(null);
  const [qrExpanded, setQrExpanded] = useState(false);
  const [starting, setStarting] = useState(false);
  const [code, setCode] = useState("");
  const [confirming, setConfirming] = useState(false);
  const [error, setError] = useState("");

  const start = async () => {
    setError("");
    setStarting(true);
    try {
      const result = await authApi.totpBegin(existingCode ? { mfaCode: existingCode } : {});
      setSecret(result.secret);
      setOtpauthUrl(result.otpauthUrl);
      haptics.success();
    } catch (e) {
      haptics.error();
      setError(errorMessage(e));
    } finally {
      setStarting(false);
    }
  };

  const confirm = async (code: string) => {
    setError("");
    setConfirming(true);
    try {
      const result = await authApi.totpConfirm({ code });
      haptics.success();
      onEnabled(result.user, result.backupCodes);
    } catch (e) {
      haptics.error();
      setError(errorMessage(e));
    } finally {
      setConfirming(false);
    }
  };

  if (!secret || !otpauthUrl) {
    return (
      <View style={styles.block}>
        <Text variant="body" color="secondary">
          Use an authenticator app to generate login codes.
        </Text>
        <Button label="Set up authenticator" block size="md" loading={starting} onPress={start} />
        {error ? (
          <Text variant="footnote" color="danger" align="center">
            {error}
          </Text>
        ) : null}
      </View>
    );
  }

  return (
    <View style={styles.block}>
      <PressableScale
        accessibilityRole="button"
        accessibilityLabel="Enlarge authenticator QR code"
        accessibilityHint="Opens a larger QR code for scanning. Tap outside to close."
        accessibilityState={{ expanded: qrExpanded }}
        style={[styles.qr, { borderColor: palette.outlineVariant }]}
        onPress={() => setQrExpanded(true)}
      >
        <QRCode value={otpauthUrl} size={180} />
      </PressableScale>
      <Text variant="footnote" color="secondary" align="center">
        Can't scan? Tap to copy this key into your app:
      </Text>
      <PressableScale accessibilityRole="button" accessibilityLabel="Copy authenticator key"
        accessibilityHint="Copies the setup key to your clipboard to paste into your authenticator app."
        style={styles.secretTarget}
        onPress={() => void copyText(secret, "Authenticator key copied")}
      >
        <Text variant="mono" align="center" style={styles.secret}>
          {secret}
        </Text>
      </PressableScale>
      <OtpInput
        value={code}
        onChange={(next) => {
          setCode(next);
          if (error) setError("");
        }}
        onComplete={confirm}
        status={confirming ? "loading" : error ? "error" : "idle"}
        error={error || undefined}
        label="Authenticator code"
        editable={!qrExpanded}
      />
      <FloatingPanel visible={qrExpanded} onDismiss={() => setQrExpanded(false)} maxWidth={384}>
        <PanelHeader title="Authenticator QR code" />
        <View style={[styles.qr, { borderColor: palette.outlineVariant }]}>
          <QRCode value={otpauthUrl} size={Math.max(96, Math.min(256, width - 112, height - 280))} />
        </View>
        <PanelActions confirmLabel="Done" onConfirm={() => setQrExpanded(false)} />
      </FloatingPanel>
    </View>
  );
}

export function MfaCodeField({
  value,
  onChange,
  error,
  autoFocus = false,
  onComplete,
  status,
}: {
  value: string;
  onChange: (value: string) => void;
  error?: string;
  autoFocus?: boolean;
  onComplete?: (code: string) => void;
  status?: OtpStatus;
}) {
  const [mode, setMode] = useState<"totp" | "backup">("totp");
  const busy = status === "loading" || status === "success";

  return (
    <View style={styles.codeField}>
      <OtpInput
        key={mode}
        kind={mode === "backup" ? "backup" : "numeric"}
        value={value}
        onChange={onChange}
        onComplete={onComplete}
        autoFocus={autoFocus}
        error={error}
        status={status}
        label={mode === "backup" ? "Backup code" : "Authenticator code"}
      />
      <PressableScale accessibilityRole="button"
        accessibilityLabel={mode === "totp" ? "Use a backup code" : "Use an authenticator code"}
        disabled={busy}
        onPress={() => {
          onChange("");
          setMode((current) => (current === "totp" ? "backup" : "totp"));
        }}
        style={styles.switcher}
      >
        <Text variant="labelLarge" color="accent">
          {mode === "totp" ? "Use a backup code" : "Use an authenticator code"}
        </Text>
      </PressableScale>
    </View>
  );
}

const styles = StyleSheet.create({
  block: { gap: spacing[16] },
  codeField: { gap: spacing[8] },
  switcher: { alignSelf: "flex-start", minHeight: 48, justifyContent: "center", paddingHorizontal: spacing[8] },
  secretTarget: { minHeight: 48, justifyContent: "center", paddingHorizontal: spacing[8] },
  qr: {
    alignSelf: "center",
    // Keep a white quiet zone around the black QR modules in either theme.
    backgroundColor: "#fff",
    padding: spacing[16],
    borderRadius: radius.lg,
    borderWidth: StyleSheet.hairlineWidth,
  },
  secret: { letterSpacing: 1 },
});
