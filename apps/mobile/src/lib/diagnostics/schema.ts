/** Closed, content-free wire schema. Validate at ingress, disk read AND export. */
export const POLICY_VERSION = 1;
export const MAX_AGE_MS = 72 * 60 * 60 * 1000;
export const DETAIL_MS = 5 * 60 * 1000;
export type ErrorKind = "render" | "uncaught-js";
export const ISSUE_LABELS = {
  "reanimated.invalid_color": "Animation color error",
  "react.host_destroyed": "App runtime stopped",
  "fabric.mount_failed": "Native screen update failed",
  "fabric.mounting_disabled": "Native screen updates stopped",
  "native.unrecognized": "Unrecognized native error",
  "js.type_error": "JavaScript type error",
  "js.range_error": "JavaScript range error",
  "js.error": "Application error",
} as const;
export type IssueCode = keyof typeof ISSUE_LABELS;
export interface SafeError {
  code: IssueCode; kind: ErrorKind; fatal: boolean;
  frames: { module: "bundle"; line: number; column: number }[];
}
export const EVENT_NAMES = ["runtime.started", "route", "changelog.open", "changelog.close", "changelog.select",
  "reader.controls.open", "reader.controls.close", "reader.preference", "app.state", "error.retry", "issue.marked", "overlay.opened", "overlay.closed", "operation"] as const;
export type DiagnosticEventName = typeof EVENT_NAMES[number];
export const OPERATION_AREAS = ["api", "auth-refresh", "cache", "startup", "storage", "update-check", "update-download", "update-apply", "share", "import", "export"] as const;
export const OPERATION_OUTCOMES = ["started", "ok", "failed", "timeout", "cancelled", "unauthorized", "server-error", "hit", "miss", "skipped"] as const;
export type OperationArea = typeof OPERATION_AREAS[number];
export type OperationOutcome = typeof OPERATION_OUTCOMES[number];
export interface SafeEvent { event: DiagnosticEventName; detail?: string }
export type EvidenceStatus = "complete" | "partial" | "unavailable" | "timed-out" | "cancelled";

/** Own data properties only. In particular, never stringify an error/object. */
export function own(value: unknown, key: string): unknown {
  if (value === null || typeof value !== "object") return undefined;
  try { const descriptor = Object.getOwnPropertyDescriptor(value, key); return descriptor && "value" in descriptor ? descriptor.value : undefined; }
  catch { return undefined; }
}
export function boundedNumber(value: unknown, max = 1_000_000, min = 0): number | undefined {
  return typeof value === "number" && Number.isFinite(value) && value >= min && value <= max ? value : undefined;
}
export function enumValue<const T extends readonly string[]>(value: unknown, options: T): T[number] | undefined {
  return typeof value === "string" && options.includes(value) ? value : undefined;
}
const SCREENS: Record<string, string> = {
  "(app)/(tabs)": "library", "(app)/reader/[id]": "reader", "(app)/folder/[id]": "folder",
  "(app)/tags/[id]": "tags", "(app)/tags": "tags", "(app)/settings": "settings",
  "diagnostics": "diagnostics", "diagnostics-report": "diagnostics.report", "(auth)/login": "sign-in", "(auth)/register": "register",
  "(auth)/mfa": "verification", "(auth)/forgot-password": "password-recovery",
  "(auth)/reset-password": "password-recovery", "(auth)/verify-email": "verification",
};
const SETTINGS = ["about", "build-details", "appearance", "controls", "sessions", "server", "account", "security", "data",
  "licenses", "license", "browser", "display-name", "email", "verify-email", "password", "delete-account"];
for (const screen of SETTINGS) SCREENS[`(app)/settings/${screen}`] = `settings.${screen}`;
const SCREEN_VALUES = new Set([...Object.values(SCREENS), "other"]);
const PREFERENCES: Record<string, readonly string[]> = {
  fontFamily: ["sans", "serif", "garamond", "bitter", "jost"], fontSize: ["small", "medium", "large", "xlarge"],
  lineSpacing: ["compact", "default", "relaxed"], theme: ["system", "light", "dark"],
};

export function normalizeEvent(name: unknown, detail?: unknown): SafeEvent | null {
  const event = enumValue(name, EVENT_NAMES);
  if (!event) return null;
  if (event === "route") return { event, detail: typeof detail === "string" ? Object.hasOwn(SCREENS, detail) ? SCREENS[detail] : SCREEN_VALUES.has(detail) ? detail : "other" : "other" };
  if (event === "app.state") { const state = enumValue(detail, ["active", "inactive", "background"]); return state ? { event, detail: state } : null; }
  if (event === "changelog.select") return typeof detail === "string" && /^v?\d{1,4}\.\d{1,4}\.\d{1,4}(?:-(?:preview|alpha|beta|rc)\.\d{1,4})?$/.test(detail) ? { event, detail } : null;
  if (event === "reader.preference") {
    try {
      const input = typeof detail === "string" && detail.length <= 512 ? JSON.parse(detail) : detail;
      const values: string[] = [];
      for (const [key, choices] of Object.entries(PREFERENCES)) {
        const value = enumValue(own(input, key), choices); if (value) values.push(`${key}=${value}`);
      }
      const amoled = own(input, "amoled"); if (typeof amoled === "boolean") values.push(`amoled=${amoled}`);
      return values.length ? { event, detail: values.join(", ") } : null;
    } catch { return null; }
  }
  if (event === "operation") {
    if (typeof detail !== "string" || detail.length > 80) return null;
    const match = /^([a-z-]+)\.([a-z-]+) (fast|normal|slow)$/.exec(detail);
    return match && enumValue(match[1], OPERATION_AREAS) && enumValue(match[2], OPERATION_OUTCOMES) ? { event, detail } : null;
  }
  return { event };
}

export function normalizeError(error: unknown, kind: ErrorKind, fatal: boolean): SafeError {
  const message = own(error, "message");
  let code: IssueCode = "js.error";
  // A template match emits a fixed identifier, never any of the quoted value.
  if (typeof message === "string" && message.length <= 32_000 && /^\[Reanimated\] Invalid color value:/.test(message)) code = "reanimated.invalid_color";
  else if (error instanceof TypeError) code = "js.type_error";
  else if (error instanceof RangeError) code = "js.range_error";
  const frames: SafeError["frames"] = [];
  const stack = own(error, "stack");
  if (typeof stack === "string") {
    for (const line of stack.slice(0, 16_000).split("\n").slice(1, 61)) {
      // Only the known production bundle name and numeric location survive.
      const match = /(?:^|[\s(])(?:address at )?(?:index\.android\.bundle|index\.ios\.bundle|main\.jsbundle):(\d{1,8}):(\d{1,10})\)?$/.exec(line.trim());
      if (match && frames.length < 24) frames.push({ module: "bundle", line: Number(match[1]), column: Number(match[2]) });
    }
  }
  return { code, kind: enumValue(kind, ["render", "uncaught-js"]) ?? "uncaught-js", fatal: fatal === true, frames };
}

export function safeIssueCode(code: unknown): IssueCode | undefined {
  return typeof code === "string" && Object.hasOwn(ISSUE_LABELS, code) ? code as IssueCode : undefined;
}
export function normalizeSavedError(value: unknown): SafeError | null {
  const code = safeIssueCode(own(value, "code"));
  const kind = enumValue(own(value, "kind"), ["render", "uncaught-js"]);
  if (!code || !kind) return null;
  const rawFrames = own(value, "frames");
  const frames: SafeError["frames"] = [];
  if (Array.isArray(rawFrames)) for (const frame of rawFrames.slice(0, 24)) {
    const line = boundedNumber(own(frame, "line"), 99_999_999), column = boundedNumber(own(frame, "column"), 9_999_999_999);
    if (own(frame, "module") === "bundle" && line !== undefined && column !== undefined) frames.push({ module: "bundle", line, column });
  }
  return { code, kind, fatal: own(value, "fatal") === true, frames };
}
export function normalizeBuild(value: unknown) {
  const version = own(value, "version"), commit = own(value, "commit"), os = own(value, "osVersion");
  return {
    ...(typeof version === "string" && /^\d{1,4}\.\d{1,4}\.\d{1,4}(?:-(?:preview|alpha|beta|rc)\.\d{1,4})?$/.test(version) ? { version } : {}),
    ...(typeof commit === "string" && /^[a-f0-9]{7,40}$/.test(commit) ? { commit } : {}),
    platform: enumValue(own(value, "platform"), ["android", "ios", "web"]) ?? "web",
    ...(boundedNumber(os, 1000) !== undefined ? { osVersion: os as number } : {}),
    origin: enumValue(own(value, "origin"), ["embedded", "update", "development"]) ?? "embedded",
  };
}
export type SafeBuild = ReturnType<typeof normalizeBuild>;
function status(value: unknown): EvidenceStatus { return enumValue(own(value, "status"), ["complete", "partial", "unavailable", "timed-out", "cancelled"]) ?? "unavailable"; }
function numbers(value: unknown, fields: readonly string[], max = 1_000_000) {
  const result: Record<string, number> = {};
  for (const key of fields) { const number = boundedNumber(own(value, key), max); if (number !== undefined) result[key] = number; }
  return result;
}
export function normalizeFrameStats(value: unknown) {
  return { status: status(value), ...numbers(value, ["durationMs", "frameCount", "intervalP50Ms", "intervalP95Ms", "intervalMaxMs", "startModeRefreshHz", "endModeRefreshHz", "preferredRefreshRateHz"]), modeChanged: own(value, "modeChanged") === true };
}
export function normalizeRenderState(value: unknown) {
  const input = own(value, "nodes");
  return { status: status(value), ...numbers(value, ["displayRefreshRateHz", "requestedRefreshRateHz", "windowAlpha"]), windowFocused: own(value, "windowFocused") === true,
    nodes: Array.isArray(input) ? input.slice(0, 40).map(node => ({
      type: enumValue(own(node, "type"), ["root", "screen", "container", "text", "web", "image", "other"]) ?? "other",
      ...numbers(node, ["width", "height", "alpha", "visibility", "children"], 100_000),
      parent: boundedNumber(own(node, "parent"), 39, -1) ?? -1,
    })) : [] };
}
export function normalizeNativeEvidence(value: unknown) {
  const exits = own(value, "exits"), incidents = own(value, "incidents");
  return { status: status(value), omitted: boundedNumber(own(value, "omitted")) ?? 0,
    exits: Array.isArray(exits) ? exits.slice(0, 5).map(exit => numbers(exit, ["reason", "status", "importance", "ageMs"], MAX_AGE_MS)) : [],
    incidents: Array.isArray(incidents) ? incidents.slice(0, 20).flatMap(incident => {
      const code = safeIssueCode(own(incident, "code"));
      return code ? [{ code, count: boundedNumber(own(incident, "count"), 10_000) ?? 1, agoMs: boundedNumber(own(incident, "agoMs"), MAX_AGE_MS) ?? 0 }] : [];
    }) : [] };
}
export function utf8Bytes(text: string): number {
  // TextEncoder is not universally present in Hermes. All schema output is
  // ASCII, but count correctly as a defense if a future field adds Unicode.
  let bytes = 0;
  for (const char of text) { const code = char.codePointAt(0)!; bytes += code < 128 ? 1 : code < 2048 ? 2 : code < 65536 ? 3 : 4; }
  return bytes;
}
