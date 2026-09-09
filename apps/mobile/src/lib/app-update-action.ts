import type { OtaStatus } from "../hooks/use-ota-update";
import type { NativeRelease, NativeUpdateStatus } from "../store/native-update";

export type AppUpdateAction = "check" | "download" | "restart" | "install";
export type AppUpdateKind = "ota" | "native" | null;

export interface AppUpdatePhase {
  kind: "ota" | "native";
  action: "download" | "restart" | "install";
}

export interface AppUpdateActionInput {
  otaStatus: OtaStatus;
  otaAvailableAt: Date | null;
  otaPendingAt: Date | null;
  nativeStatus: NativeUpdateStatus;
  nativeRelease: NativeRelease | null;
  nativeDownloaded: boolean;
}

export interface AppUpdateActionResult {
  /** First actionable phase, or Check when nothing is pending. */
  action: AppUpdateAction;
  kind: AppUpdateKind;
  /** Native and OTA together when both are pending — never drop one for the other. */
  phases: AppUpdatePhase[];
  checking: boolean;
  downloading: boolean;
}

function nativePhase(input: AppUpdateActionInput): AppUpdatePhase | null {
  if (!input.nativeRelease) return null;
  if (input.nativeStatus === "disabled" || input.nativeStatus === "idle") return null;
  if (input.nativeStatus === "downloading") {
    return { kind: "native", action: "download" };
  }
  return {
    kind: "native",
    action: input.nativeDownloaded ? "install" : "download",
  };
}

function otaPhase(input: AppUpdateActionInput): AppUpdatePhase | null {
  if (input.otaStatus === "downloading") {
    return { kind: "ota", action: "download" };
  }
  if (input.otaStatus === "available") {
    return { kind: "ota", action: "download" };
  }
  if (input.otaStatus === "ready") {
    return { kind: "ota", action: "restart" };
  }
  return null;
}

/** Every pending OTA and native step, native first. In-flight downloads stay Download. */
export function listAppUpdatePhases(input: AppUpdateActionInput): AppUpdatePhase[] {
  const phases: AppUpdatePhase[] = [];
  const native = nativePhase(input);
  const ota = otaPhase(input);
  if (native) phases.push(native);
  if (ota) phases.push(ota);
  return phases;
}

/** Pick Check or the first pending phase. Prefer listing `phases` when both exist. */
export function resolveAppUpdateAction(input: AppUpdateActionInput): AppUpdateActionResult {
  const checking = input.otaStatus === "checking" || input.nativeStatus === "checking";
  const downloading =
    input.otaStatus === "downloading" || input.nativeStatus === "downloading";
  const phases = listAppUpdatePhases(input);
  if (phases.length === 0) {
    return { action: "check", kind: null, phases, checking, downloading };
  }
  const top = phases[0]!;
  return { action: top.action, kind: top.kind, phases, checking, downloading };
}
