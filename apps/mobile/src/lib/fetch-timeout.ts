/**
 * Timeouts for React Native fetch.
 *
 * AbortController alone is not enough: OkHttp only honours `signal.abort()`
 * after TCP connect, so a request stuck in DNS or SYN-ACK (common on VPN /
 * Tailscale while the tunnel is still coming up) hangs forever. Race a
 * wall-clock deadline so the UI can leave pending state.
 */

/** Per-attempt budget. Generous enough for a cold VPN hop, short enough that
 *  an unreachable self-hosted server does not freeze the app. */
export const REQUEST_TIMEOUT_MS = 10_000;
/** Hard-cut past AbortController — see module doc. */
export const REQUEST_HARD_TIMEOUT_MS = REQUEST_TIMEOUT_MS + 2_000;
/**
 * Bookmark detail includes sanitized article HTML. On a phone over 4G/VPN
 * that payload often needs longer than a JSON list call.
 */
export const BOOKMARK_DETAIL_TIMEOUT_MS = 45_000;

const DEADLINE_SENTINEL = "__deadline__";

export function isAbortError(error: unknown): boolean {
  return (
    (typeof DOMException !== "undefined" && error instanceof DOMException && error.name === "AbortError") ||
    (error instanceof Error && error.name === "AbortError")
  );
}

export function isDeadlineError(error: unknown): boolean {
  return error instanceof Error && error.message === DEADLINE_SENTINEL;
}

/**
 * Race a promise against a hard wall-clock deadline. The losing side is
 * silenced so a late abort never surfaces as an unhandled rejection.
 */
export function raceDeadline<T>(promise: Promise<T>, ms: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout>;
  const deadline = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(DEADLINE_SENTINEL)), ms);
  });
  promise.catch(() => {});
  return Promise.race([promise, deadline]).finally(() => clearTimeout(timer!));
}

export function mergeAbortSignals(signals: AbortSignal[]): AbortSignal {
  const present = signals.filter((signal) => signal != null);
  if (present.length === 0) {
    return new AbortController().signal;
  }
  if (present.length === 1) return present[0]!;

  const controller = new AbortController();
  const abort = () => controller.abort();
  for (const signal of present) {
    if (signal.aborted) {
      controller.abort();
      return controller.signal;
    }
    signal.addEventListener("abort", abort, { once: true });
  }
  return controller.signal;
}

export function createTimeoutSignal(ms: number): {
  signal: AbortSignal;
  timedOut: () => boolean;
  clear: () => void;
} {
  const controller = new AbortController();
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, ms);
  return {
    signal: controller.signal,
    timedOut: () => timedOut,
    clear: () => clearTimeout(timer),
  };
}
