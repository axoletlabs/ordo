import type { OtaStatus } from "../hooks/use-ota-update";
import type { NativeRelease, NativeUpdateStatus } from "../store/native-update";

export type AppUpdateAction = "check" | "download" | "restart";
export type AppUpdateKind = "ota" | "native" | null;

interface UpdatePhase {
  kind: "ota" | "native";
  action: "download" | "restart";
  at: number;
}

export interface AppUpdateActionInput {
  otaStatus: OtaStatus;
  otaAvailableAt: Date | null;
  otaPendingAt: Date | null;
  nativeStatus: NativeUpdateStatus;
  nativeRelease: NativeRelease | null;
  nativeDownloaded: boolean;
}

/** Pick Check / Download / Restart from OTA + native state, including stale downloads. */
export function resolveAppUpdateAction(input: AppUpdateActionInput): {
  action: AppUpdateAction;
  kind: AppUpdateKind;
  checking: boolean;
  downloading: boolean;
} {
  const checking = input.otaStatus === "checking" || input.nativeStatus === "checking";
  const downloading =
    input.otaStatus === "downloading" || input.nativeStatus === "downloading";

  // An in-flight fetch keeps Download so the button doesn't jump to Restart/Check.
  if (input.nativeStatus === "downloading" && input.nativeRelease) {
    return { action: "download", kind: "native", checking, downloading };
  }
  if (input.otaStatus === "downloading") {
    return { action: "download", kind: "ota", checking, downloading };
  }

  const phases: UpdatePhase[] = [];

  if (input.otaStatus === "available") {
    phases.push({
      kind: "ota",
      action: "download",
      at: input.otaAvailableAt?.getTime() ?? 0,
    });
  } else if (input.otaStatus === "ready") {
    phases.push({
      kind: "ota",
      action: "restart",
      at: input.otaPendingAt?.getTime() ?? 0,
    });
  }

  if (
    input.nativeRelease &&
    input.nativeStatus !== "disabled" &&
    input.nativeStatus !== "idle"
  ) {
    phases.push({
      kind: "native",
      action: input.nativeDownloaded ? "restart" : "download",
      at: new Date(input.nativeRelease.publishedAt).getTime(),
    });
  }

  if (phases.length === 0) {
    return { action: "check", kind: null, checking, downloading };
  }

  phases.sort((left, right) => {
    const delta = right.at - left.at;
    if (delta !== 0) return delta;
    if (left.kind === right.kind) return 0;
    return left.kind === "native" ? -1 : 1;
  });

  const top = phases[0]!;
  return { action: top.action, kind: top.kind, checking, downloading };
}
