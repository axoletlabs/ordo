import React from "react";
import { RecoveryKeyDialog } from "./RecoveryKeyDialog";
import { useAuthStore } from "../../store/auth";

/** Shows the one-time library recovery key until the user saves or dismisses it. */
export function RecoveryKeyHost() {
  const recoveryKey = useAuthStore((s) => s.pendingRecoveryKey);
  const acknowledge = useAuthStore((s) => s.acknowledgeRecoveryKey);
  return <RecoveryKeyDialog recoveryKey={recoveryKey} onClose={acknowledge} />;
}
