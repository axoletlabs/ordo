export type OtaStatus = "disabled" | "idle" | "checking" | "up-to-date" | "available" | "downloading" | "ready" | "error";

export interface OtaStateInput {
  enabled: boolean;
  isChecking: boolean;
  isDownloading: boolean;
  isUpdateAvailable: boolean;
  isUpdatePending: boolean;
  runningId: string | null;
  availableId: string | null;
  pendingId: string | null;
  availableAt: Date | null;
  pendingAt: Date | null;
  hasError: boolean;
  hasChecked: boolean;
}

export function resolveOtaStatus(input: OtaStateInput): OtaStatus {
  if (!input.enabled) return "disabled";
  if (input.isDownloading) return "downloading";
  if (input.isChecking) return "checking";
  const advertised = input.isUpdateAvailable && input.availableId !== input.runningId;
  const newerThanPending = advertised && input.availableId != null &&
    input.availableId !== input.pendingId &&
    (!input.pendingAt || !input.availableAt || input.availableAt > input.pendingAt);
  if (newerThanPending) return "available";
  if (input.isUpdatePending) return "ready";
  // A null-id rollback directive is actionable too.
  if (input.isUpdateAvailable && (advertised || input.availableId == null)) return "available";
  if (input.hasError) return "error";
  return input.hasChecked ? "up-to-date" : "idle";
}
