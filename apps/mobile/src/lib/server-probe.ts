/**
 * Isolated server health-check probe. Runs a live, multi-step check against an
 * arbitrary candidate URL — WITHOUT mutating the global server-URL store. This
 * is what lets the "Change server" UI test a connection safely (the previous
 * implementation temporarily mutated the store, which is what broke Save).
 */
import { APP_NAME, type ServerInfoDto } from "@ordo/shared";
import { isAbortError, isDeadlineError, raceDeadline } from "./fetch-timeout";

export type ProbeStepState = "pending" | "success" | "failure";

export interface ProbeStep {
  command: string;
  state: ProbeStepState;
  latencyMs?: number;
  detail?: string;
}

export type ProbeStatus = "up" | "down";

export interface ProbeResult {
  url: string;
  status: ProbeStatus;
  latencyMs?: number;
  detail?: string;
  info?: ServerInfoDto;
}

/** Per-attempt budget. Generous enough for a cold connection through a DERP
 *  relay (WireGuard handshake + HTTP round-trip), short enough for snappy UX. */
const PROBE_TIMEOUT_MS = 8000;
/**
 * Hard-cut safety net past the AbortController. React Native's fetch (OkHttp)
 * honours `signal.abort()` only once the TCP connection is established — when
 * the request is stuck in system DNS resolution or TCP connect (common on
 * Tailscale MagicDNS while the WireGuard session is still being set up via
 * DERP), the abort is silently ignored and the fetch hangs forever. This race
 * guarantees resolution regardless.
 */
const PROBE_HARD_TIMEOUT_MS = PROBE_TIMEOUT_MS + 2000;
/** Retry once on timeout: the first request is frequently dropped while the
 *  WireGuard tunnel warms up; the second rides the established session. */
const PROBE_MAX_ATTEMPTS = 2;

/** Normalise a raw user URL to an origin (`scheme://host[:port]`), or null. */
export function normalizeServerUrl(raw: string): string | null {
  let s = raw.trim();
  if (!s) return null;
  if (!/^https?:\/\//i.test(s)) s = `https://${s}`;
  try {
    const u = new URL(s);
    if (!u.hostname) return null;
    return u.origin;
  } catch {
    return null;
  }
}

/** Pretty host (without scheme) for display. */
export function hostOf(url: string): string {
  try {
    return new URL(url).host;
  } catch {
    return url;
  }
}

/** One-line copy for the URL field while a candidate server is checked. */
export function describeProbeField(state: {
  idle: boolean;
  probing: boolean;
  reachable: boolean;
  detail?: string | null;
  info?: Pick<ServerInfoDto, "name" | "version"> | null;
}): { error?: string; helper?: string } {
  if (state.idle) return {};
  if (state.probing) return { helper: "Checking this server…" };
  if (state.reachable) {
    const bits = [state.info?.name, state.info?.version ? `v${state.info.version}` : null].filter(
      (part): part is string => Boolean(part),
    );
    return { helper: bits.length ? `Reachable · ${bits.join(" ")}` : "This server is reachable" };
  }
  if (state.detail === "Invalid URL") return { error: "Enter a valid URL." };
  if (state.detail === "timeout") return { error: "This server didn't respond." };
  if (state.detail?.startsWith("HTTP ")) return { error: `Server responded with ${state.detail}.` };
  return { error: "Can't reach this server." };
}

/**
 * Probe a candidate server URL. Never touches global state.
 */
export async function probeServer(
  rawUrl: string,
  onStep?: (steps: ProbeStep[]) => void,
): Promise<ProbeResult> {
  const origin = normalizeServerUrl(rawUrl);
  if (!origin) return { url: rawUrl, status: "down", detail: "Invalid URL" };

  const host = hostOf(origin);
  const steps: ProbeStep[] = [
    { command: `connect ${host}`, state: "pending" },
    { command: `GET /api/server/info`, state: "pending" },
  ];
  const emit = () => onStep?.(steps.map((s) => ({ ...s })));
  emit();

  const t0 = Date.now();
  const endpoint = `${origin}/api/server/info`;

  const fail = (detail: string): ProbeResult => {
    // Mark the first still-pending step as the failure point and every step
    // after it as skipped — otherwise they sit at "pending" forever and the
    // log looks like the probe hung.
    const failedIdx = steps.findIndex((s) => s.state === "pending");
    for (let i = 0; i < steps.length; i++) {
      if (i < failedIdx) continue;
      steps[i] = {
        command: steps[i].command,
        state: "failure",
        detail: i === failedIdx ? detail : "skipped",
      };
    }
    emit();
    return { url: origin, status: "down", detail };
  };

  for (let attempt = 0; attempt < PROBE_MAX_ATTEMPTS; attempt++) {
    const ac = new AbortController();
    const abortTimer = setTimeout(() => ac.abort(), PROBE_TIMEOUT_MS);

    try {
      const res = await raceDeadline(
        fetch(endpoint, { headers: { "x-client-type": "mobile" }, signal: ac.signal }),
        PROBE_HARD_TIMEOUT_MS,
      );
      clearTimeout(abortTimer);

      const connectMs = Date.now() - t0;
      steps[0] = { command: `connect ${host}`, state: "success", latencyMs: connectMs };
      emit();

      if (!res.ok) {
        steps[1] = { command: `GET /api/server/info`, state: "failure", detail: `HTTP ${res.status}` };
        emit();
        return { url: origin, status: "down", detail: `HTTP ${res.status}`, latencyMs: connectMs };
      }

      const info = (await raceDeadline(
        res.json() as Promise<ServerInfoDto>,
        PROBE_HARD_TIMEOUT_MS,
      )) as ServerInfoDto;

      steps[1] = {
        command: `GET /api/server/info`,
        state: "success",
        latencyMs: Date.now() - t0,
        detail: `${info?.name ?? APP_NAME} v${info?.version ?? "?"}`,
      };
      emit();
      return { url: origin, status: "up", latencyMs: Date.now() - t0, info, detail: "reachable" };
    } catch (e) {
      clearTimeout(abortTimer);
      const timedOut = isAbortError(e) || isDeadlineError(e);
      // Only retry on timeout — a non-timeout error (DNS NXDOMAIN, TLS
      // failure, connection refused) won't be fixed by a second try. The
      // timeout case is worth one more attempt because the WireGuard session
      // is now warm.
      if (timedOut && attempt < PROBE_MAX_ATTEMPTS - 1) continue;
      return fail(timedOut ? "timeout" : "unreachable");
    }
  }

  return fail("timeout");
}
