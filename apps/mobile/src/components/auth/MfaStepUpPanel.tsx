/**
 * Step-up prompt for sensitive actions. Shown after the user submits the
 * form, not as another field on it.
 */
import React, { useEffect, useState } from "react";
import { type ButtonVariant } from "../ui/Button";
import { FloatingPanel } from "../ui/FloatingPanel";
import { PanelHeader } from "../ui/PanelHeader";
import { type OtpStatus } from "../ui/OtpInput";
import { PanelActions } from "../ui/SheetActionRow";
import { errorMessage, isMfaInvalidError, isMfaRequiredError } from "../../lib/error-message";
import { haptics } from "../../lib/haptics";
import { MfaCodeField } from "./MfaSetupPanel";

export function MfaStepUpPanel({
  visible,
  onDismiss,
  title,
  description,
  confirmLabel,
  confirmVariant = "primary",
  onConfirm,
  onUnhandledError,
}: {
  visible: boolean;
  onDismiss: () => void;
  title: string;
  description: string;
  confirmLabel: string;
  confirmVariant?: ButtonVariant;
  onConfirm: (code: string) => Promise<void>;
  /** Non-MFA failures (wrong password, taken email, …). Panel dismisses first. */
  onUnhandledError?: (err: unknown) => void;
}) {
  const [code, setCode] = useState("");
  const [error, setError] = useState("");
  const [status, setStatus] = useState<OtpStatus>("idle");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (visible) return;
    setCode("");
    setError("");
    setStatus("idle");
    setBusy(false);
  }, [visible]);

  const close = () => {
    if (busy) return;
    onDismiss();
  };

  const submit = async (raw?: string) => {
    if (busy) return;
    const next = (raw ?? code).trim();
    if (!next) {
      setError("Enter your authenticator or backup code.");
      return;
    }
    setError("");
    setBusy(true);
    setStatus("loading");
    try {
      await onConfirm(next);
      setStatus("success");
    } catch (err) {
      if (isMfaInvalidError(err) || isMfaRequiredError(err)) {
        haptics.error();
        setStatus("error");
        setError(errorMessage(err));
        return;
      }
      if (onUnhandledError) {
        onDismiss();
        onUnhandledError(err);
        return;
      }
      haptics.error();
      setStatus("error");
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <FloatingPanel visible={visible} onDismiss={close}>
      <PanelHeader title={title} subtitle={description} />
      <MfaCodeField
        key={visible ? "open" : "closed"}
        value={code}
        onChange={(next) => {
          setCode(next);
          if (error) setError("");
          if (status === "error") setStatus("idle");
        }}
        error={error || undefined}
        status={status}
        autoFocus
        onComplete={(next) => void submit(next)}
      />
      <PanelActions
        confirmLabel={confirmLabel}
        confirmVariant={confirmVariant}
        onConfirm={() => void submit()}
        onCancel={close}
        loading={busy}
        cancelDisabled={busy}
      />
    </FloatingPanel>
  );
}
