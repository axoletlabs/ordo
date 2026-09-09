/**
 * Core HTTP client for the Ordo API.
 *
 * Responsibilities:
 *  - Prefix requests with the configured server URL.
 *  - Always send `x-client-type: mobile` (required so the server returns tokens
 *    in the body instead of httpOnly cookies).
 *  - Attach `Authorization: Bearer <accessToken>` for authed requests.
 *  - Attach `x-folder-token` for requests targeting a (possibly) protected folder.
 *  - Transparently refresh on `token_expired` / `unauthorized` (single-flight) and replay once.
 *  - Normalise every failure into an `ApiClientError` with a stable `code`.
 *  - Schedule a proactive refresh just before the access token expires.
 *  - Never drop a live session because the server was down or an in-flight
 *    request lost the race with a token rotation.
 */
import {
  AuthRoutes,
  CLIENT_TYPE_HEADER,
  CLIENT_TYPE_MOBILE,
  DEVICE_NAME_HEADER,
  DEVICE_TYPE_HEADER,
  FOLDER_TOKEN_HEADER,
  FOLDER_TOKENS_HEADER,
  REFRESH_TOKEN_HEADER,
  type ApiError,
  type SessionDeviceType,
} from "@ordo/shared";
import * as Device from "expo-device";
import { useAuthStore } from "../../store/auth";
import { useFolderTokenStore } from "../../store/folder-tokens";
import { useSettingsStore } from "../../store/settings";
import {
  isDefiniteRefreshRejection,
  nextProactiveRefreshDelayMs,
  shouldClearSessionForError,
  shouldRefreshAccessToken,
  shouldRetryRequestWithRefresh,
} from "../auth-session-policy";
import {
  REQUEST_HARD_TIMEOUT_MS,
  REQUEST_TIMEOUT_MS,
  createTimeoutSignal,
  isAbortError,
  isDeadlineError,
  mergeAbortSignals,
  raceDeadline,
} from "../fetch-timeout";

/** Client-side error codes not present on the wire. */
export const LOCAL_ERROR = {
  NETWORK: "network_error",
  TIMEOUT: "request_timeout",
  UNKNOWN: "unknown_error",
} as const;

/** A normalised, human-consumable API error. */
export class ApiClientError extends Error {
  readonly code: string;
  readonly status: number;
  readonly details?: unknown;

  constructor(status: number, body: ApiError | null, fallbackMessage?: string) {
    super(body?.message || fallbackMessage || "Something went wrong");
    this.name = "ApiClientError";
    this.code = body?.code ?? (status === 0 ? LOCAL_ERROR.NETWORK : LOCAL_ERROR.UNKNOWN);
    this.status = status;
    this.details = body?.details;
  }

  /** True when the access token has expired and a refresh should be attempted. */
  get tokenExpired() {
    return this.status === 401 && this.code === "token_expired";
  }
  /** True when the session is gone and the user must re-authenticate. */
  get sessionGone() {
    return this.code === "session_revoked";
  }
}

export interface RequestOptions<B = unknown> {
  method?: "GET" | "POST" | "PATCH" | "PUT" | "DELETE";
  body?: B;
  /** Multipart body; do not JSON-stringify. */
  formData?: FormData;
  /** Return the raw Response (for binary downloads). */
  raw?: boolean;
  query?: Record<string, string | number | boolean | null | undefined>;
  /** Attach the current access token (default: true). */
  auth?: boolean;
  /** If set (non-null), attach the cached folder unlock token for this folder (if any). */
  folderId?: string | null;
  /** If true, attach every cached folder unlock token (global tag/search scope). */
  folderTokens?: boolean;
  /** Extra headers merged into the request (e.g. x-folder-tokens). */
  headers?: Record<string, string>;
  /** Per-attempt timeout override in ms (large transfers). */
  timeoutMs?: number;
  signal?: AbortSignal;
}

function baseUrl(): string {
  return (useSettingsStore.getState().serverUrl || "").replace(/\/+$/, "");
}

function buildUrl(path: string, query?: RequestOptions["query"]): string {
  const url = `${baseUrl()}${path}`;
  if (!query) return url;
  const params = new URLSearchParams();
  for (const [k, v] of Object.entries(query)) {
    if (v === undefined || v === null) continue;
    params.append(k, String(v));
  }
  const qs = params.toString();
  return qs ? `${url}?${qs}` : url;
}

/** Parse the server's `{ error: {...} }` envelope if present. */
async function parseError(res: Response): Promise<ApiClientError> {
  let body: ApiError | null = null;
  try {
    const data = await res.clone().json();
    body = data?.error ?? null;
  } catch {
    /* not JSON */
  }
  return new ApiClientError(res.status, body);
}

/** Lowest-level fetch: no interceptors, just normalised errors. */
async function rawFetch(url: string, init: RequestInit, timeoutMs = REQUEST_TIMEOUT_MS): Promise<Response> {
  const timeout = createTimeoutSignal(timeoutMs);
  const userSignal = init.signal;
  const signal = userSignal ? mergeAbortSignals([userSignal, timeout.signal]) : timeout.signal;
  try {
    const res = await raceDeadline(fetch(url, { ...init, signal }), timeoutMs + 2_000);
    if (!res.ok) throw await parseError(res);
    return res;
  } catch (e) {
    if (e instanceof ApiClientError) throw e;
    const userAborted = Boolean(userSignal?.aborted);
    const timedOut = !userAborted && (timeout.timedOut() || isDeadlineError(e) || isAbortError(e));
    if (timedOut) {
      throw new ApiClientError(0, {
        code: LOCAL_ERROR.TIMEOUT,
        message: "The server took too long to respond.",
      });
    }
    throw new ApiClientError(
      0,
      null,
      userAborted || isAbortError(e)
        ? "The request was cancelled."
        : "Couldn't reach the server. Check your connection.",
    );
  } finally {
    timeout.clear();
  }
}

function jsonHeaders(extra: Record<string, string>): Record<string, string> {
  return { "content-type": "application/json", accept: "application/json", ...extra };
}

function deviceHeaders(): Record<string, string> {
  const types: Partial<Record<Device.DeviceType, SessionDeviceType>> = {
    [Device.DeviceType.PHONE]: "phone",
    [Device.DeviceType.TABLET]: "tablet",
    [Device.DeviceType.DESKTOP]: "desktop",
    [Device.DeviceType.TV]: "tv",
  };
  const name = Device.deviceName || Device.modelName || Device.osName || "Unknown device";

  return {
    [DEVICE_NAME_HEADER]: encodeURIComponent(name),
    [DEVICE_TYPE_HEADER]: types[Device.deviceType ?? Device.DeviceType.UNKNOWN] ?? "unknown",
  };
}

/* ------------------------------------------------------------------ */
/* Refresh: single-flight so concurrent 401s share one refresh.        */
/* ------------------------------------------------------------------ */

type RefreshResult = "ok" | "rejected" | "unreachable";

let refreshInFlight: Promise<RefreshResult> | null = null;
let proactiveTimer: ReturnType<typeof setTimeout> | null = null;

async function doRefresh(): Promise<RefreshResult> {
  const { tokens, setTokens, clear } = useAuthStore.getState();
  const refreshToken = tokens?.refreshToken;
  if (!refreshToken) {
    cancelProactiveRefresh();
    void clear();
    return "rejected";
  }
  try {
    const res = await rawFetch(
      `${baseUrl()}${AuthRoutes.refresh.path}`,
      {
        method: "POST",
        headers: jsonHeaders({
          [CLIENT_TYPE_HEADER]: CLIENT_TYPE_MOBILE,
          [REFRESH_TOKEN_HEADER]: refreshToken,
          ...deviceHeaders(),
        }),
      },
    );
    const data = await raceDeadline(res.json(), REQUEST_HARD_TIMEOUT_MS);
    // Server rotates both tokens; persist the new pair.
    setTokens(data.tokens);
    scheduleProactiveRefresh(data.tokens?.expiresIn as number);
    return "ok";
  } catch (e) {
    const err = e instanceof ApiClientError ? e : new ApiClientError(0, null);
    // Only drop the session when the server actually rejected the refresh.
    // A down host, timeout, proxy 401, or 5xx must not sign the user out.
    if (isDefiniteRefreshRejection(err)) {
      cancelProactiveRefresh();
      void clear();
      return "rejected";
    }
    return "unreachable";
  }
}

function refreshOnce(): Promise<RefreshResult> {
  if (!refreshInFlight) {
    refreshInFlight = doRefresh().finally(() => {
      refreshInFlight = null;
    });
  }
  return refreshInFlight;
}

/**
 * Schedule a silent refresh ~60s before the access token expires.
 * Safe to call repeatedly; clears any prior timer.
 *
 * Pass `expiresIn` right after a login/refresh. Otherwise uses the stamped
 * `accessExpiresAt` from the auth store so a later launch does not treat the
 * original TTL as remaining time.
 */
export function scheduleProactiveRefresh(expiresInSec?: number): void {
  if (proactiveTimer) {
    clearTimeout(proactiveTimer);
    proactiveTimer = null;
  }
  const expiresAt =
    expiresInSec && expiresInSec > 0
      ? Date.now() + expiresInSec * 1000
      : useAuthStore.getState().accessExpiresAt;
  if (expiresAt == null) return;
  const delay = nextProactiveRefreshDelayMs(expiresAt);
  if (delay <= 0) return;
  proactiveTimer = setTimeout(() => {
    void refreshOnce().catch(() => {});
  }, delay);
}

export function cancelProactiveRefresh(): void {
  if (proactiveTimer) clearTimeout(proactiveTimer);
  proactiveTimer = null;
}

/**
 * Refresh if the access token is expired, unknown, or within the lead window.
 * Otherwise (re)arm the proactive timer. Used on launch and foreground.
 */
export async function ensureFreshAccessToken(): Promise<RefreshResult | "skipped"> {
  const { tokens, accessExpiresAt, status } = useAuthStore.getState();
  if (status !== "authenticated" || !tokens?.refreshToken) return "skipped";
  if (!shouldRefreshAccessToken(accessExpiresAt)) {
    scheduleProactiveRefresh();
    return "skipped";
  }
  return refreshOnce();
}

/* ------------------------------------------------------------------ */
/* Public request function                                             */
/* ------------------------------------------------------------------ */

async function request<T>(
  path: string,
  options: RequestOptions = {},
  retried = false,
): Promise<T> {
  const auth = options.auth ?? true;
  const { tokens } = useAuthStore.getState();

  const headers: Record<string, string> = {
    [CLIENT_TYPE_HEADER]: CLIENT_TYPE_MOBILE,
    ...deviceHeaders(),
    ...options.headers,
  };
  if (auth && tokens?.accessToken) {
    headers.authorization = `Bearer ${tokens.accessToken}`;
  }
  const liveFolderTokens = useFolderTokenStore.getState().liveTokens();
  if (liveFolderTokens.length > 0) {
    headers[FOLDER_TOKENS_HEADER] = liveFolderTokens.join(",");
  }
  if (options.folderId) {
    const folderToken = useFolderTokenStore.getState().get(options.folderId);
    if (folderToken) headers[FOLDER_TOKEN_HEADER] = folderToken;
  }
  const init: RequestInit = { method: options.method ?? "GET", headers, signal: options.signal };
  if (options.formData) {
    init.body = options.formData;
  } else if (options.body !== undefined) {
    init.headers = jsonHeaders(headers);
    init.body = JSON.stringify(options.body);
  }

  const url = buildUrl(path, options.query);
  const timeoutMs = options.timeoutMs ?? REQUEST_TIMEOUT_MS;

  try {
    const res = await rawFetch(url, init, timeoutMs);
    if (options.raw) return res as T;
    if (res.status === 204) return undefined as T;
    return await raceDeadline(res.json() as Promise<T>, timeoutMs + 2_000);
  } catch (e) {
    const err =
      e instanceof ApiClientError
        ? e
        : isDeadlineError(e)
          ? new ApiClientError(0, {
              code: LOCAL_ERROR.TIMEOUT,
              message: "The server took too long to respond.",
            })
          : new ApiClientError(0, null, "Unexpected error");
    const sentAccessToken = tokens?.accessToken;
    // Transparent refresh + single replay. `unauthorized` is included because
    // rotating refresh invalidates the previous access token (hash miss), so
    // in-flight requests often see that instead of `token_expired`.
    if (shouldRetryRequestWithRefresh(err, { auth, retried })) {
      const refresh = await refreshOnce();
      if (refresh === "ok") return request<T>(path, options, true);
      if (refresh === "rejected") {
        throw new ApiClientError(401, { code: "session_revoked", message: "Your session has ended. Please sign in again." });
      }
      throw new ApiClientError(0, {
        code: LOCAL_ERROR.NETWORK,
        message: "Couldn't reach the server. Check your connection.",
      });
    }
    if (
      shouldClearSessionForError(err, {
        sentAccessToken,
        currentAccessToken: useAuthStore.getState().tokens?.accessToken,
      })
    ) {
      cancelProactiveRefresh();
      void useAuthStore.getState().clear();
    }
    throw err;
  }
}

export const api = {
  get: <T>(path: string, opts?: RequestOptions) => request<T>(path, { ...opts, method: "GET" }),
  post: <T>(path: string, body?: unknown, opts?: RequestOptions) =>
    request<T>(path, { ...opts, method: "POST", body }),
  postForm: <T>(path: string, formData: FormData, opts?: RequestOptions) =>
    request<T>(path, { ...opts, method: "POST", formData }),
  patch: <T>(path: string, body?: unknown, opts?: RequestOptions) =>
    request<T>(path, { ...opts, method: "PATCH", body }),
  put: <T>(path: string, body?: unknown, opts?: RequestOptions) =>
    request<T>(path, { ...opts, method: "PUT", body }),
  delete: <T>(path: string, opts?: RequestOptions) => request<T>(path, { ...opts, method: "DELETE" }),
  getBlob: (path: string, opts?: RequestOptions) =>
    request<Response>(path, { ...opts, method: "GET", raw: true }),
  postBlob: (path: string, body?: unknown, opts?: RequestOptions) =>
    request<Response>(path, { ...opts, method: "POST", body, raw: true }),
};
