/**
 * Broadcast when an API call could not reach the configured server.
 * The offline gate refetches /api/server/info so a dead host covers the app
 * instead of leaving stale lists on screen.
 */
type Listener = () => void;

const listeners = new Set<Listener>();

export function reportServerUnreachable() {
  for (const listener of listeners) listener();
}

export function subscribeServerUnreachable(listener: Listener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** The configured host did not answer (timeout or no connection). */
export function isServerUnreachable(err: unknown): boolean {
  if (!err || typeof err !== "object") return false;
  const e = err as { status?: unknown; code?: unknown; message?: unknown };
  if (e.status !== 0) return false;
  if (e.code === "request_timeout") return true;
  return e.code === "network_error" && e.message !== "The request was cancelled.";
}
